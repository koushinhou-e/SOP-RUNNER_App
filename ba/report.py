"""「作業入力値一覧」：印刷用 HTML の生成と、Edge（なければ Chrome/Chromium）のヘッドレス印刷による PDF 化。

- 標準ライブラリのみ。フォントは OS 標準の日本語フォント（Meiryo / Yu Gothic UI …）だけを指定し、外部リソースは一切読み込まない
- ブラウザが見つからない・失敗・タイムアウトの場合は、印刷用 HTML を開いて window.print() で印刷してもらう（フォールバック）
"""
import html
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

COLUMNS = ["項目名", "最終値", "要求値", "判定", "入力元（手順/ページ）", "入力日時"]
ENV_BROWSER = "BA_PDF_BROWSER"     # ブラウザのパスを明示（テスト用）。"none" で PDF 化を無効にする

_CSS = """
@page { size: A4 landscape; margin: 11mm 12mm 12mm 12mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1f2933; background: #fff;
  font-family: "Meiryo", "Yu Gothic UI", "Yu Gothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", sans-serif;
  font-size: 9.5pt; line-height: 1.38; }
.sheet { max-width: 273mm; margin: 0 auto; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12mm; border-bottom: 2.2pt solid #1e3a5f; padding-bottom: 3mm; }
.title { font-size: 17pt; font-weight: 700; letter-spacing: .06em; color: #1e3a5f; margin: 0; }
.sub { color: #52606d; font-size: 8.5pt; margin-top: 1mm; }
.meta { display: grid; grid-template-columns: auto auto auto; gap: 0 0; border: 0.8pt solid #9aa5b1; border-radius: 1.5mm; overflow: hidden; }
.meta div { padding: 1.4mm 4mm; border-left: 0.8pt solid #d9dee4; min-width: 34mm; }
.meta div:first-child { border-left: 0; }
.meta b { display: block; font-size: 7.5pt; color: #52606d; font-weight: 400; }
.meta span { font-size: 11pt; font-weight: 700; }
.chips { display: flex; gap: 2mm; margin: 3mm 0 2.5mm; flex-wrap: wrap; font-size: 8.5pt; }
.chip { border: 0.8pt solid #cbd2d9; border-radius: 10mm; padding: 0.4mm 3mm; background: #f5f7fa; }
.chip.bad { border-color: #e12d39; color: #ab091e; background: #ffeeee; font-weight: 700; }
.chip.good { border-color: #3ebd93; color: #0c6b58; background: #effcf6; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
th { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 8.5pt; text-align: left; padding: 1.6mm 2.2mm; border: 0.6pt solid #1e3a5f; }
td { padding: 1.0mm 2.2mm; border-bottom: 0.6pt solid #d9dee4; vertical-align: top; word-break: break-all; overflow-wrap: anywhere; }
tr { page-break-inside: avoid; break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f7f9fb; }
td.no { color: #7b8794; text-align: right; }
td.final { font-weight: 700; }
td.at { white-space: nowrap; word-break: normal; font-variant-numeric: tabular-nums; }
td.key { color: #7b8794; font-size: 7.5pt; font-family: Consolas, "MS Gothic", monospace; }
.j { display: inline-block; min-width: 13mm; text-align: center; border-radius: 1mm; padding: 0 1.5mm; font-size: 8pt; font-weight: 700; }
.j.match, .j.ok { background: #e3f9e5; color: #0e5814; }
.j.mismatch, .j.conflict, .j.invalid { background: #e12d39; color: #fff; }
.j.missing { background: #fff3c4; color: #8d6708; }
.j.no_expected { background: #eef2f6; color: #52606d; }
tr.problem td { background: #fff1f1 !important; }
tr.problem td.final { color: #ab091e; }
.alt { display: block; color: #ab091e; font-size: 7.5pt; font-weight: 400; }
.foot { margin-top: 3mm; color: #7b8794; font-size: 7.5pt; display: flex; justify-content: space-between; }
.bar { position: sticky; top: 0; background: #1e3a5f; color: #fff; padding: 8px 16px; display: flex; gap: 12px; align-items: center; margin-bottom: 14px; font-size: 13px; }
.bar button { font: inherit; padding: 6px 16px; border-radius: 6px; border: 0; background: #fff; color: #1e3a5f; font-weight: 700; cursor: pointer; }
@media screen { body { background: #e4e7eb; } .sheet { background: #fff; padding: 12mm; margin: 0 auto 20px; box-shadow: 0 2px 10px rgba(0,0,0,.15); } }
@media print { .bar { display: none; } }
"""


def build_html(meta, rows, for_browser=False):
    """meta: {job_name, server, work_date, operator, generated_at, sop_title, summary}; rows: values.evaluate() の結果（入力のある行のみ渡す）。"""
    e = lambda s: html.escape("" if s is None else str(s))
    s = meta.get("summary") or {}
    chips = ['<span class="chip">入力項目 %d</span>' % len(rows)]
    if s.get("mismatch"):
        chips.append('<span class="chip bad">要求値と不一致 %d</span>' % s["mismatch"])
    if s.get("conflict"):
        chips.append('<span class="chip bad">入力値の食い違い %d</span>' % s["conflict"])
    if s.get("invalid"):
        chips.append('<span class="chip bad">書式エラー %d</span>' % s["invalid"])
    if not (s.get("mismatch") or s.get("conflict") or s.get("invalid")):
        chips.append('<span class="chip good">不一致・食い違いなし</span>')
    if meta.get("sop_title"):
        chips.append('<span class="chip">手順実行：%s</span>' % e(meta["sop_title"]))
    body = []
    for n, r in enumerate(rows, 1):
        if r["conflict"]:
            j = '<span class="j conflict">食い違い</span>'
        else:
            j = '<span class="j %s">%s</span>' % (r["status"], e("—" if r["status"] == "no_expected" else r["status_label"]))
        alts = "".join('<span class="alt">≠ %s：%s</span>' % (e(x["source"]), e(x["value"])) for x in r["entries"] if x.get("differs"))
        body.append('<tr class="%s"><td class="no">%d</td><td>%s%s</td><td class="final">%s%s</td><td>%s</td><td>%s</td><td>%s</td><td class="at">%s</td></tr>' % (
            "problem" if r["problem"] or r["status"] == "invalid" else "", n, e(r["label"]),
            ('<div class="key">%s</div>' % e(r["key"])) if r.get("key") and r["key"] != r["label"] else "",
            e(r["final"]), alts, e(r["expected"]) if r["has_expected"] else '<span style="color:#9aa5b1">—</span>', j, e(r["final_source"]),
            e((r["final_at"] or "")[:16]) or '<span style="color:#9aa5b1">—</span>'))
    if not body:
        body.append('<tr><td colspan="7" style="text-align:center;color:#7b8794;padding:8mm">入力された値がありません</td></tr>')
    bar = ('<div class="bar"><button type="button" id="printBtn">印刷 / PDF に保存</button><span>用紙：A4 横。印刷ダイアログで「PDF に保存」を選ぶと PDF になります。</span></div>'
           '<script src="/js/print.js"></script>') if for_browser else ""
    ths = "".join('<th style="width:%s">%s</th>' % (w, c) for w, c in zip(("19%", "20%", "17%", "8%", "19%", "13%"), COLUMNS))
    return """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>作業入力値一覧 - %(title)s</title><style>%(css)s</style></head>
<body>%(bar)s<div class="sheet">
<div class="head"><div><h1 class="title">作業入力値一覧</h1><div class="sub">%(job)s</div></div>
<div class="meta"><div><b>サーバ名</b><span>%(server)s</span></div><div><b>作業日</b><span>%(date)s</span></div><div><b>作業者</b><span>%(op)s</span></div></div></div>
<div class="chips">%(chips)s</div>
<table><thead><tr><th style="width:4%%">No</th>%(ths)s</tr></thead><tbody>%(body)s</tbody></table>
<div class="foot"><span>判定：要求値（パラメータシート）と最終値を照合。「食い違い」は同じ項目に入力元ごとに異なる値があることを示します。</span><span>出力日時 %(gen)s ／ 構築作業アシスタント v2</span></div>
</div></body></html>""" % {
        "title": e(meta.get("server") or meta.get("job_name") or ""), "css": _CSS, "bar": bar, "job": e(meta.get("job_name") or ""),
        "server": e(meta.get("server") or "—"), "date": e(meta.get("work_date") or "—"), "op": e(meta.get("operator") or "—"),
        "chips": "".join(chips), "ths": ths, "body": "".join(body), "gen": e(meta.get("generated_at") or ""),
    }


KEY_COLUMNS = [("項目名", "21%"), ("要求値（パラメータシート）", "22%"), ("入力値", "21%"), ("出力値（実測）", "21%"), ("判定", "10%")]

_KEY_CSS = """
@page { size: A4 portrait; margin: 12mm; }
.sheet { max-width: 186mm; }
td { padding: 1.6mm 2.2mm; font-size: 10pt; }
td.no { white-space: nowrap; padding-left: 1mm; padding-right: 1.5mm; }
td.v { font-family: Consolas, "MS Gothic", monospace; font-size: 9.5pt; }
td.v.final { font-weight: 700; }
.io { display: block; color: #ab091e; font-size: 7.5pt; font-weight: 700; }
"""


def build_keyvalues_html(meta, rows, for_browser=False):
    """「主要値一覧」：パラメータシートの項目ごとに 要求値 / 入力値 / 出力値 / 判定 だけを並べた 1 枚もの（A4 縦）。

    rows: values.key_rows() の結果。手順の経過・入力元ごとの値・日時などは載せない。
    """
    e = lambda s: html.escape("" if s is None else str(s))
    dash = '<span style="color:#9aa5b1">—</span>'
    s = meta.get("summary") or {}
    chips = ['<span class="chip">項目 %d</span>' % len(rows)]
    if s.get("match"):
        chips.append('<span class="chip good">一致 %d</span>' % s["match"])
    if s.get("mismatch"):
        chips.append('<span class="chip bad">不一致 %d</span>' % s["mismatch"])
    if s.get("io_differs"):
        chips.append('<span class="chip bad">入力値と出力値が異なる %d</span>' % s["io_differs"])
    body = []
    for n, r in enumerate(rows, 1):
        st = r["status"]
        j = '<span class="j %s">%s</span>' % (st, e("—" if st == "no_expected" else r["status_label"]))
        body.append('<tr class="%s"><td class="no">%d</td><td>%s%s</td><td class="v">%s</td><td class="v%s">%s</td><td class="v%s">%s%s</td><td>%s</td></tr>' % (
            "problem" if st == "mismatch" or r["io_differs"] else "", n, e(r["label"]),
            ('<div class="key">%s</div>' % e(r["key"])) if r.get("key") and r["key"] != r["label"] else "",
            e(r["expected"]) or dash,
            "" if r["output"] else " final", e(r["input"]) or dash,
            " final" if r["output"] else "", e(r["output"]) or dash, '<span class="io">≠ 入力値</span>' if r["io_differs"] else "",
            j))
    if not body:
        body.append('<tr><td colspan="6" style="text-align:center;color:#7b8794;padding:8mm">入力値・出力値のある項目がありません</td></tr>')
    bar = ('<div class="bar"><button type="button" id="printBtn">印刷 / PDF に保存</button><span>用紙：A4 縦。印刷ダイアログで「PDF に保存」を選ぶと PDF になります。</span></div>'
           '<script src="/js/print.js"></script>') if for_browser else ""
    ths = "".join('<th style="width:%s">%s</th>' % (w, c) for c, w in KEY_COLUMNS)
    return """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>主要値一覧 - %(title)s</title><style>%(css)s</style></head>
<body>%(bar)s<div class="sheet">
<div class="head"><div><h1 class="title">主要値一覧</h1><div class="sub">%(job)s</div></div>
<div class="meta"><div><b>サーバ名</b><span>%(server)s</span></div><div><b>作業日</b><span>%(date)s</span></div><div><b>作業者</b><span>%(op)s</span></div></div></div>
<div class="chips">%(chips)s</div>
<table><thead><tr><th style="width:5%%">No</th>%(ths)s</tr></thead><tbody>%(body)s</tbody></table>
<div class="foot"><span>入力値：作業者が入力した値（① 作業入力・手順実行）。出力値：コマンド結果などの実測値（③）。判定は出力値（無ければ入力値）を要求値と照合。</span><span>出力日時 %(gen)s</span></div>
</div></body></html>""" % {
        "title": e(meta.get("server") or meta.get("job_name") or ""), "css": _CSS + _KEY_CSS, "bar": bar, "job": e(meta.get("job_name") or ""),
        "server": e(meta.get("server") or "—"), "date": e(meta.get("work_date") or "—"), "op": e(meta.get("operator") or "—"),
        "chips": "".join(chips), "ths": ths, "body": "".join(body), "gen": e(meta.get("generated_at") or ""),
    }


# ---------------- ブラウザ（Edge / Chrome / Chromium）の検出 ----------------
_APP_PATHS = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%s"
_LINUX_NAMES = ["microsoft-edge", "microsoft-edge-stable", "msedge", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]
_MAC_APPS = ["Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium"]


def _registry_app_path(winreg_mod, exe):
    if winreg_mod is None:
        return None
    for hive in ("HKEY_LOCAL_MACHINE", "HKEY_CURRENT_USER"):
        try:
            with winreg_mod.OpenKey(getattr(winreg_mod, hive), _APP_PATHS % exe) as k:
                v = winreg_mod.QueryValue(k, None)
                if v:
                    return v.strip('"')
        except OSError:
            continue
    return None


def browser_candidates(platform=None, env=None, winreg_mod=None, home=None):
    """優先順のブラウザ候補（存在確認前）。Edge を先に、Chrome/Chromium は代替。"""
    platform = platform or sys.platform
    env = os.environ if env is None else env
    out = []
    if platform.startswith("win"):
        if winreg_mod is None:
            try:
                import winreg as winreg_mod  # noqa: F811  Windows のみ
            except ImportError:
                winreg_mod = None
        for exe, rel in (("msedge.exe", r"Microsoft\Edge\Application\msedge.exe"), ("chrome.exe", r"Google\Chrome\Application\chrome.exe")):
            reg = _registry_app_path(winreg_mod, exe)
            if reg:
                out.append(reg)
            for var in ("ProgramFiles(x86)", "ProgramFiles", "ProgramW6432", "LOCALAPPDATA"):
                if env.get(var):
                    out.append(env[var].rstrip("\\/") + "\\" + rel)
            out.append("PATH:" + exe)
    elif platform == "darwin":
        home = home or os.path.expanduser("~")
        for app in _MAC_APPS:
            out.append("/Applications/" + app)
            out.append(os.path.join(home, "Applications", app))
    else:
        out += ["PATH:" + n for n in _LINUX_NAMES]
    seen, uniq = set(), []
    for c in out:
        if c.lower() not in seen:
            seen.add(c.lower())
            uniq.append(c)
    return uniq


def find_browser(platform=None, env=None, winreg_mod=None, exists=os.path.isfile, which=shutil.which, home=None):
    """PDF 化に使うブラウザの実行ファイルのパス。見つからなければ None。"""
    env = os.environ if env is None else env
    forced = (env.get(ENV_BROWSER) or "").strip()
    if forced:
        return None if forced.lower() == "none" else (forced if exists(forced) else None)
    for c in browser_candidates(platform, env, winreg_mod, home):
        if c.startswith("PATH:"):
            p = which(c[5:])
            if p:
                return p
        elif exists(c):
            return c
    return None


def browser_label(path):
    n = os.path.basename(path or "").lower()
    return "Microsoft Edge" if "edge" in n else ("Google Chrome" if "chrome" in n and "chromium" not in n else ("Chromium" if "chromium" in n else (path or "")))


def html_to_pdf(browser, html_path, pdf_path, timeout=90, run=subprocess.run):
    """ヘッドレスのブラウザで HTML を PDF に印刷する。失敗時は RuntimeError。

    ブラウザには一時フォルダの短いパス（page.html → out.pdf）だけを渡し、できた PDF を pdf_path へ移す。
    出力先が深いフォルダ・長い作業名だと、フルパスが Windows の 260 文字制限を超えてブラウザが
    ファイルを開けず（ERR_FILE_NOT_FOUND）、% や # などの URL 上の特殊文字の影響も受けるため。
    """
    if os.path.exists(pdf_path):
        os.remove(pdf_path)
    work = tempfile.mkdtemp(prefix="ba-pdf-")
    page, tmp_pdf = os.path.join(work, "page.html"), os.path.join(work, "out.pdf")
    shutil.copyfile(html_path, page)
    args = [browser, "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--disable-sync", "--disable-background-networking", "--disable-component-update", "--disable-domain-reliability",
            "--disable-client-side-phishing-detection", "--no-pings",
            "--user-data-dir=" + os.path.join(work, "profile"),     # 起動中の Edge とプロファイルを共有しない（共有すると既存のウィンドウに渡されて終わる）
            "--no-pdf-header-footer", "--print-to-pdf-no-header", "--print-to-pdf=" + tmp_pdf, pathlib.Path(page).as_uri()]
    kw = {"stdout": subprocess.DEVNULL, "stderr": subprocess.PIPE, "timeout": timeout}
    if os.name == "nt":
        kw["creationflags"] = 0x08000000      # CREATE_NO_WINDOW
    try:
        try:
            p = run(args, **kw)
        except subprocess.TimeoutExpired:
            raise RuntimeError("ブラウザの PDF 出力がタイムアウトしました（%d 秒）" % timeout)
        except OSError as ex:
            raise RuntimeError("ブラウザを起動できませんでした：%s" % ex)
        ok = os.path.exists(tmp_pdf) and os.path.getsize(tmp_pdf) > 0
        if ok:
            with open(tmp_pdf, "rb") as f:
                ok = f.read(5) == b"%PDF-"
        if not ok:
            err = (getattr(p, "stderr", b"") or b"").decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError("PDF が作成されませんでした（終了コード %s）%s" % (getattr(p, "returncode", "?"), ("：" + err[-1][:200]) if err else ""))
        shutil.move(tmp_pdf, pdf_path)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return pdf_path
