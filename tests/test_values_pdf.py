"""最終値の整合チェック（all_values）と「作業入力値一覧」PDF（HTML・ブラウザ検出・フォールバック）。"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import _util  # noqa: F401  （vendor/ を sys.path に追加）
from ba import report
from ba import values as valmod
from ba.service import Service

CHROME = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("msedge") or shutil.which("microsoft-edge")


def session(values, at=None, keys=None, confirmed="2026-10-03T00:05:00.000Z"):
    keys = keys or {}
    inputs = [{"id": "i1", "label": "作業日", "type": "time"}, {"id": "i2", "label": "作業者", "type": "text"},
              {"id": "i3", "label": "インスタンスタイプ", "type": "text"}, {"id": "i4", "label": "メモ", "type": "text"}]
    for inp in inputs:
        if inp["id"] in keys:
            inp["key"] = keys[inp["id"]]
    r = {"values": values, "confirmedAt": confirmed}
    if at is not None:
        r["valuesAt"] = at
    return {"key": "sopRunner:v1:手順書.docx:abc", "docName": "手順書.docx", "docTitle": "パッチ適用手順書", "executor": "山田 太郎",
            "startedAt": "2026-10-03T00:00:00.000Z", "steps": [{"id": "s1", "title": "記録", "inputs": inputs}], "results": {"s1": r}}


class ServiceBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.S = Service(self.tmp)
        self.ps, self.xt, self.pr, self.cs = self.S.load_samples()
        self.job = self.S.store.job_save({"name": "web01 構築確認", "template_id": self.xt["id"], "param_sheet_id": self.ps["id"], "server": "web01", "inputs": {}, "compare": {}})
        self.items = {i["cell"]: i["id"] for i in self.S.store.lib_get(self.xt["id"])["items"]}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def values(self):
        v = self.S.all_values(self.S.store.job_get(self.job["id"]))
        return v, {r["id"]: r for r in v["rows"]}


class AllValuesTest(ServiceBase):
    def test_merge_judge_and_sources(self):
        self.S.update_job(self.job["id"], {"inputs": {self.items["C4"]: "2026/10/03", self.items["C5"]: "山田 太郎", self.items["D11"]: "OK"}})
        self.S.update_job(self.job["id"], {"compare": {"instance_type": {"actual": "t3.medium", "judgement": "NG"}, "memory_gib": {"actual": "8 GiB"}}})
        v, by = self.values()
        it = by["instance_type"]
        self.assertEqual((it["expected"], it["final"], it["status"], it["conflict"], it["problem"]), ("t3.large", "t3.medium", "mismatch", False, True))
        self.assertEqual(it["final_source"], "③ パラメータ比較（実測値）")
        self.assertRegex(it["final_at"], r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
        self.assertEqual(by["memory_gib"]["status"], "match")            # 8 と 8 GiB は ③ と同じ judge() で一致
        self.assertEqual(by["work_date"]["final"], "2026/10/03")
        self.assertEqual(by["work_date"]["final_source"], "① 入力チェック（C4）")
        self.assertEqual(by["item:" + self.items["D11"]]["label"], "インスタンスタイプ / 確認結果")
        self.assertEqual(by["hostname"]["status"], "missing")
        self.assertEqual((v["summary"]["mismatch"], v["summary"]["conflict"], v["summary"]["problems"]), (1, 0, 1))
        self.assertIsNone(v["sop"])

    def test_runner_values_conflict_and_latest_wins(self):
        self.S.update_job(self.job["id"], {"inputs": {self.items["C4"]: "2026/10/03", self.items["C5"]: "山田 太郎"},
                                           "compare": {"instance_type": {"actual": "t3.large"}}})
        sess = session({"i1": "2026-10-03 09:00", "i2": "佐藤 花子", "i3": "t3.medium", "i4": "メモです"},
                       at={"i2": "2030-01-01T00:00:00.000Z", "i3": "2000-01-01T00:00:00.000Z"},
                       keys={"i1": "work_date", "i2": "worker", "i3": "instance_type"})
        self.S.store.sop_put(sess["key"], sess)
        self.S.update_job(self.job["id"], {"sop_key": sess["key"]})
        v, by = self.values()
        self.assertEqual(v["sop"]["title"], "パッチ適用手順書")
        self.assertEqual((v["sop"]["done"], v["sop"]["total"]), (1, 1))
        w = by["worker"]                                  # 手順実行の値の方が新しい → 最終値。① と食い違い
        self.assertEqual((w["final"], w["final_source"], w["conflict"], w["problem"]), ("佐藤 花子", "手順 1：記録", True, True))
        self.assertEqual([e["differs"] for e in w["entries"]], [True, False])
        d = by["work_date"]                               # 2026/10/03 と 2026-10-03 09:00 は同じ日付 → 食い違いではない
        self.assertFalse(d["conflict"])
        self.assertNotEqual(d["status"], "invalid")         # 書式チェックは ① の値（2026/10/03）だけが対象
        self.assertEqual(d["errors"], [])
        t = by["instance_type"]                           # ③ の方が新しい（t3.large・一致）が、手順実行の t3.medium と食い違い
        self.assertEqual((t["final"], t["status"], t["conflict"]), ("t3.large", "match", True))
        self.assertEqual([e["judge"] for e in t["entries"]], ["match", "mismatch"])
        memo = [r for r in v["rows"] if r["label"] == "メモ（手順 1）"][0]   # キーなしの入力も一覧に含める
        self.assertEqual((memo["final"], memo["status"], memo["key"]), ("メモです", "ok", None))
        self.assertEqual(v["summary"]["conflict"], 2)

    def test_old_json_without_timestamps_or_keys(self):
        job = self.S.store.job_get(self.job["id"])
        job["inputs"] = {self.items["C5"]: "山田 太郎"}          # inputs_at なし（古い JSON）
        job["compare"] = {"instance_type": {"actual": "t3.large", "judged_at": "2026-10-03 10:00:00"}}
        self.S.store.job_save(job)
        old = session({"i2": "鈴木 一郎"}, confirmed=None, keys={"i2": "worker"})
        del old["results"]["s1"]["confirmedAt"]
        self.S.store.sop_put(old["key"], old)
        job["sop_key"] = old["key"]
        self.S.store.job_save(job)
        v, by = self.values()
        self.assertEqual(by["instance_type"]["final_at"], "2026-10-03 10:00:00")       # judged_at で代用
        w = by["worker"]                                   # 日時なし同士 → 手順実行 > 実測値 > 作業入力 の優先
        self.assertEqual((w["final"], w["final_at"], w["conflict"]), ("鈴木 一郎", "", True))
        job["sop_key"] = "存在しないキー"
        self.S.store.job_save(job)
        v, _ = self.values()
        self.assertEqual(v["sop"], {"key": "存在しないキー", "found": False})

    def test_timestamps_recorded_only_on_change(self):
        j = self.S.update_job(self.job["id"], {"inputs": {self.items["C5"]: "山田 太郎"}, "compare": {"vcpu": {"actual": "2"}}})
        t1, c1 = j["inputs_at"][self.items["C5"]], j["compare"]["vcpu"]["actual_at"]
        j = self.S.store.job_get(self.job["id"])
        j["inputs_at"][self.items["C5"]] = "2000-01-01T00:00:00"
        j["compare"]["vcpu"]["actual_at"] = "2000-01-01T00:00:00"
        self.S.store.job_save(j)
        j = self.S.update_job(self.job["id"], {"inputs": {self.items["C5"]: "山田 太郎"}, "compare": {"vcpu": {"actual": "2", "judgement": "OK"}}})
        self.assertEqual(j["inputs_at"][self.items["C5"]], "2000-01-01T00:00:00")      # 値が同じなら日時は変えない
        self.assertEqual(j["compare"]["vcpu"]["actual_at"], "2000-01-01T00:00:00")
        j = self.S.update_job(self.job["id"], {"inputs": {self.items["C5"]: "佐藤"}, "compare": {"vcpu": {"actual": "4"}}})
        self.assertNotEqual(j["inputs_at"][self.items["C5"]], "2000-01-01T00:00:00")
        self.assertNotEqual(j["compare"]["vcpu"]["actual_at"], "2000-01-01T00:00:00")
        self.assertTrue(t1 and c1)
        with self.assertRaises(ValueError):
            self.S.update_job(self.job["id"], {"sop_key": ["x"]})
        self.assertEqual(self.S.update_job(self.job["id"], {"sop_key": "k"})["sop_key"], "k")
        self.assertIsNone(self.S.update_job(self.job["id"], {"sop_key": None})["sop_key"])

    def test_validation_errors_from_template_rules(self):
        self.S.update_job(self.job["id"], {"inputs": {self.items["C4"]: "2026/13/40"}})
        _, by = self.values()
        self.assertEqual(by["work_date"]["status"], "invalid")
        self.assertFalse(by["work_date"]["problem"])


class KeyValuesTest(ServiceBase):
    """主要値一覧：パラメータシートの項目ごとに 要求値 / 入力値 / 出力値 だけ。"""

    def setUp(self):
        super().setUp()
        sess = session({"i2": "佐藤 花子", "i3": "t3.large"}, at={"i3": "2026-10-03T00:00:00.000Z"}, keys={"i2": "worker", "i3": "instance_type"})
        self.S.store.sop_put(sess["key"], sess)
        self.S.update_job(self.job["id"], {"sop_key": sess["key"], "inputs": {self.items["C5"]: "山田 太郎"},
                                           "compare": {"instance_type": {"actual": "t3.medium"}, "private_ip": {"actual": "192.0.2.11"}}})

    def test_key_rows(self):
        rows = {r["key"]: r for r in valmod.key_rows(self.values()[0]["rows"])}
        self.assertEqual(set(rows), {"instance_type", "private_ip"})     # パラメータシート外（作業者）・未入力の項目は載せない
        it = rows["instance_type"]                                        # 入力値（手順実行）と出力値（③）が異なる
        self.assertEqual((it["expected"], it["input"], it["output"], it["status"], it["io_differs"]), ("t3.large", "t3.large", "t3.medium", "mismatch", True))
        ip = rows["private_ip"]                                           # 出力値だけ
        self.assertEqual((ip["input"], ip["output"], ip["status"], ip["io_differs"]), ("", "192.0.2.11", "match", False))
        s = valmod.key_summary(list(rows.values()))
        self.assertEqual((s["total"], s["match"], s["mismatch"], s["io_differs"]), (2, 1, 1, 1))

    def test_html_and_pdf_fallback(self):
        job = self.S.store.job_get(self.job["id"])
        h = self.S.keyvalues_html(job)
        self.assertIn("主要値一覧", h)
        self.assertIn("A4 portrait", h)
        for s in ("t3.large", "t3.medium", "192.0.2.11", "≠ 入力値"):
            self.assertIn(s, h)
        for s in ("入力日時", "手順 1：記録", "佐藤 花子"):                  # 経過・入力元・パラメータシート外の値は載せない
            self.assertNotIn(s, h)
        self.assertNotIn("printBtn", h)
        self.assertIn('id="printBtn"', self.S.keyvalues_html(job, for_browser=True))
        with mock.patch.dict(os.environ, {report.ENV_BROWSER: "none"}):
            out = self.S.export_values_pdf(job, kind="keyvalues")
        self.assertIsNone(out["pdf"])
        self.assertIn("主要値一覧", out["html"])
        with open(os.path.join(out["dir"], out["html"]), encoding="utf-8") as f:
            self.assertIn("t3.medium", f.read())


class HelpersTest(unittest.TestCase):
    def test_norm_time(self):
        self.assertEqual(valmod.norm_time("2026-10-03T10:00:00"), "2026-10-03 10:00:00")
        self.assertEqual(valmod.norm_time("2026-10-03 10:00:05"), "2026-10-03 10:00:05")
        self.assertEqual(valmod.norm_time("2026-10-03 10:00"), "2026-10-03 10:00:00")
        z = valmod.norm_time("2026-10-03T01:00:00.123Z")
        self.assertRegex(z, r"^2026-10-0[23] \d{2}:00:00$")
        for bad in ("", None, "昨日", 5):
            self.assertEqual(valmod.norm_time(bad), "")

    def test_same_value(self):
        self.assertTrue(valmod.same_value("t3.large", "T3.LARGE "))
        self.assertTrue(valmod.same_value("8", "8 GiB"))
        self.assertTrue(valmod.same_value("2026/10/03", "2026-10-03 09:00"))
        self.assertTrue(valmod.same_value("2026年10月3日", "2026/10/03"))
        self.assertFalse(valmod.same_value("2026/10/03 09:00", "2026-10-03 10:00"))
        self.assertFalse(valmod.same_value("2026/10/03", "2026/10/04"))
        self.assertFalse(valmod.same_value("t3.large", "t3.medium"))


class KeyBindingPersistenceTest(ServiceBase):
    def test_runner_keys_survive_session_and_library_round_trip(self):
        from ba.server import App
        app = App(self.tmp, port=0)
        app.start_background()
        try:
            import http.client
            from urllib.parse import quote

            def req(method, path, body=None):
                c = http.client.HTTPConnection("127.0.0.1", app.port, timeout=20)
                c.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers={"X-Token": app.token, "Content-Type": "application/json"})
                r = c.getresponse()
                d = r.read()
                c.close()
                return r.status, (json.loads(d) if d and r.getheader("Content-Type", "").startswith("application/json") else d)
            sess = session({"i3": "t3.medium"}, keys={"i3": "instance_type"})
            self.assertEqual(req("PUT", "/api/sop/sessions/" + quote(sess["key"], safe=""), sess)[0], 200)
            st, lst = req("GET", "/api/sop/sessions")
            self.assertEqual(lst["items"][0]["steps"][0]["inputs"][2]["key"], "instance_type")
            ev = {"docHash": "abc", "steps": [{"index": 0, "title": "記録", "items": [], "inputKeys": [{"label": "インスタンスタイプ", "key": "instance_type"}]}]}
            st, m = req("PUT", "/api/library/" + self.pr["id"], {"evidence": ev})
            self.assertEqual(req("GET", "/api/library/" + self.pr["id"])[1]["evidence"]["steps"][0]["inputKeys"][0]["key"], "instance_type")
            st, j = req("PUT", "/api/jobs/" + self.job["id"], {"sop_key": sess["key"]})
            self.assertEqual((st, j["job"]["sop_key"]), (200, sess["key"]))
            st, v = req("GET", "/api/jobs/%s/values" % self.job["id"])
            r = [x for x in v["rows"] if x["key"] == "instance_type"][0]
            self.assertEqual((r["final"], r["status"], r["final_source"]), ("t3.medium", "mismatch", "手順 1：記録"))
            st, h = req("GET", "/api/jobs/%s/values.html" % self.job["id"])
            self.assertEqual(st, 200)
            self.assertIn(b'id="printBtn"', h)
            self.assertIn(b'/js/print.js', h)
            self.assertNotIn(b"http://", h.replace(b"http://127.0.0.1", b""))
            self.assertEqual(req("GET", "/api/exports/..%2Fjobs")[0], 404)
            self.assertEqual(req("GET", "/api/exports/nothing.pdf")[0], 404)
            with mock.patch.dict(os.environ, {report.ENV_BROWSER: "none"}):
                st, out = req("POST", "/api/jobs/%s/values.pdf" % self.job["id"], {})
            self.assertEqual((st, out["pdf"]), (200, None))
            self.assertIn("見つかりませんでした", out["error"])
            st, data = req("GET", "/api/exports/" + quote(out["html"]))
            self.assertEqual(st, 200)
            self.assertIn("作業入力値一覧".encode("utf-8"), data)
            # keep-alive：POST の本体（{}）が次のリクエストの先頭に残らない（PDF ダウンロードが壊れた不具合の回帰テスト）
            c = http.client.HTTPConnection("127.0.0.1", app.port, timeout=20)
            hd = {"X-Token": app.token, "Content-Type": "application/json"}
            with mock.patch.dict(os.environ, {report.ENV_BROWSER: "none"}):
                c.request("POST", "/api/jobs/%s/values.pdf" % self.job["id"], body=b"{}", headers=hd)
                r1 = c.getresponse(); r1.read()
            c.request("GET", "/api/exports/" + quote(out["html"]), headers=hd)
            r2 = c.getresponse()
            self.assertEqual((r1.status, r2.status), (200, 200))
            self.assertIn("作業入力値一覧".encode("utf-8"), r2.read())
            c.close()
        finally:
            app.httpd.shutdown()
            app.httpd.server_close()


class FakeWinreg:
    HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER = "HKLM", "HKCU"

    def __init__(self, data):
        self.data = data

    def OpenKey(self, hive, path):
        if (hive, path) not in self.data:
            raise OSError("no key")
        val = self.data[(hive, path)]

        class K:
            def __enter__(s):
                return val

            def __exit__(s, *a):
                return False
        return K()

    def QueryValue(self, key, sub):
        return key


class BrowserDetectTest(unittest.TestCase):
    WIN_ENV = {"ProgramFiles(x86)": r"C:\Program Files (x86)", "ProgramFiles": r"C:\Program Files", "LOCALAPPDATA": r"C:\Users\u\AppData\Local"}

    def test_windows_program_files(self):
        edge86 = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        got = report.find_browser("win32", self.WIN_ENV, FakeWinreg({}), exists=lambda p: p == edge86, which=lambda n: None)
        self.assertEqual(got, edge86)
        edge64 = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
        self.assertEqual(report.find_browser("win32", self.WIN_ENV, FakeWinreg({}), exists=lambda p: p == edge64, which=lambda n: None), edge64)

    def test_windows_registry_first(self):
        reg = FakeWinreg({("HKLM", report._APP_PATHS % "msedge.exe"): '"D:\\Edge\\msedge.exe"'})
        got = report.find_browser("win32", self.WIN_ENV, reg, exists=lambda p: True, which=lambda n: None)
        self.assertEqual(got, "D:\\Edge\\msedge.exe")

    def test_windows_chrome_fallback_and_path(self):
        chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        self.assertEqual(report.find_browser("win32", self.WIN_ENV, FakeWinreg({}), exists=lambda p: p == chrome, which=lambda n: None), chrome)
        self.assertEqual(report.find_browser("win32", self.WIN_ENV, FakeWinreg({}), exists=lambda p: False, which=lambda n: "C:\\bin\\" + n if n == "msedge.exe" else None), "C:\\bin\\msedge.exe")
        self.assertIsNone(report.find_browser("win32", self.WIN_ENV, FakeWinreg({}), exists=lambda p: False, which=lambda n: None))
        cands = report.browser_candidates("win32", self.WIN_ENV, FakeWinreg({}))
        self.assertLess(cands.index(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"), cands.index(chrome))   # Edge が先

    def test_mac_and_linux(self):
        mac = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        self.assertEqual(report.find_browser("darwin", {}, exists=lambda p: p == mac, which=lambda n: None, home="/Users/u"), mac)
        self.assertEqual(report.find_browser("linux", {}, exists=lambda p: False, which=lambda n: "/usr/bin/chromium" if n == "chromium" else None), "/usr/bin/chromium")
        self.assertEqual(report.find_browser("linux", {}, exists=lambda p: False, which=lambda n: "/usr/bin/" + n if n in ("chromium", "microsoft-edge") else None), "/usr/bin/microsoft-edge")

    def test_env_override(self):
        self.assertEqual(report.find_browser("linux", {report.ENV_BROWSER: "/opt/x/chrome"}, exists=lambda p: p == "/opt/x/chrome", which=lambda n: "/usr/bin/" + n), "/opt/x/chrome")
        self.assertIsNone(report.find_browser("linux", {report.ENV_BROWSER: "none"}, exists=lambda p: True, which=lambda n: "/usr/bin/" + n))
        self.assertIsNone(report.find_browser("linux", {report.ENV_BROWSER: "/missing"}, exists=lambda p: False, which=lambda n: "/usr/bin/" + n))
        self.assertEqual(report.browser_label(r"C:\x\msedge.exe"), "Microsoft Edge")
        self.assertEqual(report.browser_label("/usr/bin/chromium"), "Chromium")


class HtmlToPdfTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.html = os.path.join(self.tmp, "a b#.html")
        with open(self.html, "w", encoding="utf-8") as f:
            f.write("<html><body>テスト</body></html>")
        self.pdf = os.path.join(self.tmp, "out.pdf")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_command_line_and_success(self):
        seen = {}

        def run(args, **kw):
            seen["args"], seen["kw"] = args, kw
            with open([a for a in args if a.startswith("--print-to-pdf=")][0].split("=", 1)[1], "wb") as f:
                f.write(b"%PDF-1.4 fake")
            return subprocess.CompletedProcess(args, 0, None, b"")
        report.html_to_pdf("/x/msedge", self.html, self.pdf, timeout=7, run=run)
        a = seen["args"]
        self.assertEqual(a[0], "/x/msedge")
        self.assertIn("--headless", a)
        self.assertTrue(any(x.startswith("--user-data-dir=") for x in a))
        # ブラウザには一時フォルダの短いパスを渡す（長いパス・特殊文字のファイル名でも開けるように）
        self.assertTrue(a[-1].startswith("file:///") and a[-1].endswith("/page.html"))
        self.assertNotIn(self.tmp, [x.split("=", 1)[-1][:len(self.tmp)] for x in a[1:]])
        self.assertEqual(seen["kw"]["timeout"], 7)
        with open(self.pdf, "rb") as f:                                   # 指定の場所へ移されている
            self.assertEqual(f.read(5), b"%PDF-")

    def test_timeout_and_no_output(self):
        def slow(args, **kw):
            raise subprocess.TimeoutExpired(args, kw["timeout"])
        with self.assertRaisesRegex(RuntimeError, "タイムアウト"):
            report.html_to_pdf("/x/msedge", self.html, self.pdf, timeout=1, run=slow)
        with self.assertRaisesRegex(RuntimeError, "PDF が作成されませんでした"):
            report.html_to_pdf("/x/msedge", self.html, self.pdf, run=lambda a, **k: subprocess.CompletedProcess(a, 1, None, b"boom"))
        with self.assertRaisesRegex(RuntimeError, "起動できませんでした"):
            report.html_to_pdf("/nonexistent/msedge", self.html, self.pdf)


class ValuesPdfTest(ServiceBase):
    def prepare(self):
        self.S.update_job(self.job["id"], {"inputs": {self.items["C4"]: "2026/10/03", self.items["C5"]: "山田 太郎"},
                                           "compare": {"instance_type": {"actual": "t3.medium"}}})
        return self.S.store.job_get(self.job["id"])

    def test_html_content_and_columns(self):
        h = self.S.values_html(self.prepare())
        for c in report.COLUMNS:
            self.assertIn("<th style=\"width:", h)
            self.assertIn(c, h)
        thead = h[h.index("<thead>"):h.index("</thead>")]
        idx = [thead.index(">%s<" % c) for c in report.COLUMNS]
        self.assertEqual(idx, sorted(idx))                                   # 列の順序
        self.assertIn("size: A4 landscape", h)
        self.assertIn('"Meiryo", "Yu Gothic UI"', h)
        self.assertIn("<span>web01</span>", h)                               # ヘッダ：サーバ名
        self.assertIn("<span>2026/10/03</span>", h)                          # 作業日
        self.assertIn("<span>山田 太郎</span>", h)                            # 作業者
        self.assertIn("t3.medium", h)
        self.assertIn('class="j mismatch">不一致', h)
        self.assertNotIn("サブネットID", h)                                   # 入力のない項目は載せない
        self.assertNotIn("<script", h)                                       # PDF 用は印刷ボタンなし
        self.assertNotRegex(h, r"(?i)(src|href)=\"https?:")
        self.assertNotIn("@import", h)
        self.assertNotIn("url(", h)

    def test_fallback_when_no_browser(self):
        with mock.patch.object(report, "find_browser", return_value=None):
            out = self.S.export_values_pdf(self.prepare())
        self.assertIsNone(out["pdf"])
        self.assertTrue(os.path.isfile(self.S.store.export_path(out["html"])))

    def test_fallback_when_browser_fails(self):
        with mock.patch.object(report, "find_browser", return_value="/x/msedge"), \
                mock.patch.object(report, "html_to_pdf", side_effect=RuntimeError("PDF が作成されませんでした（終了コード 1）")):
            out = self.S.export_values_pdf(self.prepare())
        self.assertEqual((out["pdf"], out["browser"]), (None, "Microsoft Edge"))
        self.assertIn("終了コード", out["error"])

    @unittest.skipUnless(CHROME, "Chrome / Chromium / Edge がないので実 PDF の生成はスキップ")
    def test_real_pdf_with_installed_browser(self):
        with mock.patch.dict(os.environ, {report.ENV_BROWSER: CHROME}):
            out = self.S.export_values_pdf(self.prepare())
        self.assertIsNone(out["error"])
        p = self.S.store.export_path(out["pdf"])
        with open(p, "rb") as f:
            self.assertEqual(f.read(5), b"%PDF-")
        if shutil.which("pdfinfo"):
            info = subprocess.run(["pdfinfo", p], stdout=subprocess.PIPE, universal_newlines=True).stdout
            self.assertRegex(info, r"Page size:\s+841\.\d+ x 59[45]\.\d+ pts \(A4\)")


if __name__ == "__main__":
    unittest.main()
