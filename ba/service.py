"""业务逻辑层（HTTP 层与测试都调用这里）。"""
import datetime
import json
import os

from . import commands as cmdmod
from . import compare as cmpmod
from . import fill as fillmod
from . import paramsheet
from . import report
from . import rules
from . import values as valmod
from . import xlsx_detect
from .store import Store, now, safe_name
from .store import _lock as store_lock

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = os.path.join(APP_DIR, "samples")


class Service:
    def __init__(self, data_dir):
        self.store = Store(data_dir)

    # ---------------- library ----------------
    def upload(self, typ, filename, data, name=None):
        name = name or os.path.splitext(safe_name(filename))[0]
        if typ == "excel_template":
            m = self.store.lib_create(typ, name, data, filename)
            path, _ = self.store.lib_file(m["id"])
            try:
                items = xlsx_detect.detect_workbook(path)
            except Exception as e:  # 不是有效的 xlsx
                self.store.lib_delete(m["id"])
                raise ValueError("Excel テンプレートを読み込めません：%s" % e)
            return self.store.lib_update(m["id"], {"items": items, "param_ref": None})
        if typ == "param_sheet":
            m = self.store.lib_create(typ, name, data, filename)
            path, _ = self.store.lib_file(m["id"])
            try:
                parsed = paramsheet.parse(path)
            except Exception as e:
                self.store.lib_delete(m["id"])
                raise ValueError("パラメータシートを解析できません：%s" % e)
            return self.store.lib_update(m["id"], {"parsed": parsed})
        if typ == "procedure":
            if not data[:2] == b"PK":
                raise ValueError(".docx ファイルではありません")
            return self.store.lib_create(typ, name, data, filename)
        raise ValueError("unknown type")

    def create_command_set(self, name, templates):
        return self.store.lib_create("command_set", name, extra={"templates": templates})

    def redetect(self, item_id):
        path, m = self.store.lib_file(item_id)
        items = xlsx_detect.detect_workbook(path)
        if m.get("param_ref"):
            self.auto_map_items(items, m["param_ref"])
        return self.store.lib_update(item_id, {"items": items})

    def auto_map_items(self, items, param_sheet_id):
        ps = self.store.lib_get(param_sheet_id)
        return xlsx_detect.auto_map(items, ps["parsed"]["params"])

    def auto_map(self, template_id, param_sheet_id):
        m = self.store.lib_get(template_id)
        items = m.get("items", [])
        n = self.auto_map_items(items, param_sheet_id)
        m = self.store.lib_update(template_id, {"items": items, "param_ref": param_sheet_id})
        return m, n

    def preview(self, template_id):
        path, _ = self.store.lib_file(template_id)
        return xlsx_detect.preview(path)

    # ---------------- jobs ----------------
    def _params(self, job):
        if not job.get("param_sheet_id"):
            return []
        try:
            return self.store.lib_get(job["param_sheet_id"])["parsed"]["params"]
        except KeyError:
            return []

    def _template(self, job):
        if not job.get("template_id"):
            return None
        try:
            return self.store.lib_get(job["template_id"])
        except KeyError:
            return None

    def context(self, job):
        """命令占位符上下文：参数（所选服务器）→ 作业输入（按 key）→ 作业全局变量（覆盖）。"""
        ctx = {p["key"]: p["values"].get(job.get("server", ""), "") for p in self._params(job)}
        ctx["server"] = job.get("server", "")
        tpl = self._template(job)
        for it in (tpl or {}).get("items", []):
            v = (job.get("inputs") or {}).get(it["id"])
            if it.get("key") and v not in (None, "") and (it.get("source") or {}).get("kind") == "input":
                if not ctx.get(it["key"]):          # パラメータ値が空のときだけ作業入力で補う
                    ctx[it["key"]] = v
        for k, v in (job.get("globals") or {}).items():
            if str(v).strip():
                ctx[k] = v
        return ctx

    def resolve(self, job):
        tpl = self._template(job)
        params = {p["key"]: p for p in self._params(job)}
        server = job.get("server", "")
        out = []
        for it in (tpl or {}).get("items", []):
            src = it.get("source") or {"kind": "input"}
            kind = src.get("kind", "input")
            if kind == "param":
                p = params.get(src.get("key"))
                val = p["values"].get(server, "") if p else ""
            elif kind == "fixed":
                val = src.get("value", "")
            elif kind == "input":
                val = (job.get("inputs") or {}).get(it["id"], "")
            else:
                val = ""
            errs = rules.validate(it, val) if kind not in ("none", "evidence") else []
            out.append({"id": it["id"], "sheet": it["sheet"], "cell": it["cell"], "label": it["label"], "kind": kind,
                        "key": src.get("key"), "value": val, "errors": errs})
        return out

    JOB_FIELDS = ("name", "template_id", "param_sheet_id", "server", "command_set_id", "procedure_id", "globals", "sop_key")

    def update_job(self, job_id, b):
        """作業の更新。inputs / compare は差分マージし、値が変わった項目に入力日時を記録する（古い JSON はそのまま）。"""
        with store_lock:    # 読み込み〜保存を 1 つの操作にする（同時の PUT で片方の更新が失われないように）
            return self._update_job(job_id, b)

    def _update_job(self, job_id, b):
        job = self.store.job_get(job_id)
        for k in self.JOB_FIELDS:
            if k in b:
                if k == "sop_key" and b[k] is not None and not isinstance(b[k], str):
                    raise ValueError("sop_key は文字列で指定してください")
                job[k] = b[k]
        ts = now()
        if isinstance(b.get("inputs"), dict):
            inputs, at = job.setdefault("inputs", {}), job.setdefault("inputs_at", {})
            for k, v in b["inputs"].items():
                if inputs.get(k) != v:
                    at[k] = ts
                inputs[k] = v
        if isinstance(b.get("compare"), dict):
            cmp_ = job.setdefault("compare", {})
            for k, v in b["compare"].items():
                if not isinstance(v, dict):
                    continue
                old = cmp_.get(k) or {}
                v = dict(v)
                if (old.get("actual") or "") != (v.get("actual") or ""):
                    v["actual_at"] = ts
                elif old.get("actual_at") and "actual_at" not in v:
                    v["actual_at"] = old["actual_at"]
                cmp_[k] = v
        return self.store.job_save(job)

    def sop_session(self, job):
        key = job.get("sop_key")
        return self.store.sop_get(key) if key else None

    def all_values(self, job):
        """最終値の整合チェック：期待値（パラメータシート）・作業入力・実測値・手順実行の入力値をキーで集約して判定する。"""
        sess = self.sop_session(job)
        groups = valmod.collect(self._params(job), job.get("server", ""), self._template(job), job, sess)
        rows = valmod.evaluate(groups)
        info = None
        if job.get("sop_key"):
            info = {"key": job["sop_key"], "found": bool(sess)}
            if sess:
                done = sum(1 for st in sess.get("steps") or [] if ((sess.get("results") or {}).get(st.get("id")) or {}).get("confirmedAt"))
                info.update({"title": sess.get("docTitle") or sess.get("docName"), "executor": sess.get("executor", ""),
                             "done": done, "total": len(sess.get("steps") or []), "updatedAt": valmod.norm_time(sess.get("updatedAt"))})
        return {"rows": rows, "summary": valmod.summary(rows), "sop": info}

    def values_meta(self, job, rows=None):
        rows = rows if rows is not None else self.all_values(job)["rows"]
        by = {r["key"]: r for r in rows if r.get("key")}
        sess = self.sop_session(job) or {}
        work_date = (by.get("work_date") or {}).get("final") or ""
        if not work_date and sess.get("startedAt"):
            work_date = valmod.norm_time(sess["startedAt"])[:10]
        operator = (by.get("worker") or {}).get("final") or self._worker(job) or sess.get("executor") or ""
        return {"job_name": job.get("name", ""), "server": job.get("server", ""), "work_date": work_date or datetime.date.today().strftime("%Y-%m-%d"),
                "operator": operator, "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "sop_title": sess.get("docTitle") or ""}

    def values_html(self, job, for_browser=False):
        v = self.all_values(job)
        rows = [r for r in v["rows"] if r["entries"]]          # 入力された値のみ
        meta = self.values_meta(job, v["rows"])
        meta["summary"] = valmod.summary(rows)
        return report.build_html(meta, rows, for_browser=for_browser)

    def keyvalues_html(self, job, for_browser=False):
        """主要値一覧：パラメータシートの項目ごとの 要求値 / 入力値 / 出力値 だけ。"""
        v = self.all_values(job)
        rows = valmod.key_rows(v["rows"])
        meta = self.values_meta(job, v["rows"])
        meta["summary"] = valmod.key_summary(rows)
        return report.build_keyvalues_html(meta, rows, for_browser=for_browser)

    REPORTS = {"values": ("作業入力値一覧", "values_html"), "keyvalues": ("主要値一覧", "keyvalues_html")}

    def export_values_pdf(self, job, timeout=90, kind="values"):
        """作業入力値一覧（kind="values"）／主要値一覧（kind="keyvalues"）の PDF を exports/ に作る。
        ブラウザが無い・失敗した場合は pdf=None（印刷用 HTML で代替）。"""
        title, builder = self.REPORTS[kind]
        base = "%s_%s_%s_%s" % (job.get("name", "job"), job.get("server", ""), title, datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        html_path = self.store.export_path(base + ".html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(getattr(self, builder)(job))
        out = {"html": os.path.basename(html_path), "pdf": None, "browser": None, "error": None,
               "dir": os.path.dirname(html_path)}
        browser = report.find_browser()
        if not browser:
            out["error"] = "Microsoft Edge（または Chrome / Chromium）が見つかりませんでした"
            return out
        out["browser"] = report.browser_label(browser)
        pdf_path = self.store.export_path(base + ".pdf")
        try:
            report.html_to_pdf(browser, html_path, pdf_path, timeout=timeout)
            out["pdf"] = os.path.basename(pdf_path)
        except RuntimeError as e:
            out["error"] = str(e)
        return out

    def job_view(self, job_id):
        job = self.store.job_get(job_id)
        res = self.resolve(job)
        return {"job": job, "resolved": res, "errors": sum(1 for r in res if r["errors"])}

    def _templates(self, job):
        if not job.get("command_set_id"):
            return []
        try:
            return self.store.lib_get(job["command_set_id"]).get("templates", [])
        except KeyError:
            return []

    def commands(self, job):
        return cmdmod.generate(self._templates(job), self.context(job))

    def preview_commands(self, templates, param_sheet_id=None, server=None, globals_=None):
        job = {"param_sheet_id": param_sheet_id, "server": server or "", "globals": globals_ or {}}
        return cmdmod.generate(templates, self.context(job))

    def script(self, job, target):
        gen = self.commands(job)
        return cmdmod.to_script(gen, target, {"job_name": job.get("name", ""), "server": job.get("server", "")})

    def compare_rows(self, job):
        hints = {}
        for g in self.commands(job):
            if g.get("checks"):
                for k in [x.strip() for x in g["checks"].split(",") if x.strip()]:
                    hints.setdefault(k, []).append({"title": g["title"], "sh": g["sh"]})
        rows = cmpmod.build_rows(self._params(job), job.get("server", ""), job.get("compare"), hints)
        return rows, cmpmod.summary(rows)

    def _worker(self, job):
        tpl = self._template(job) or {}
        for it in tpl.get("items", []):
            if "作業者" in (it.get("label") or "") or it.get("key") == "worker":
                v = (job.get("inputs") or {}).get(it["id"])
                if v:
                    return v
        return (job.get("globals") or {}).get("worker", "")

    def export_compare(self, job):
        rows, _ = self.compare_rows(job)
        ps = self.store.lib_get(job["param_sheet_id"]) if job.get("param_sheet_id") else {}
        name = "%s_%s_パラメータ比較_%s.xlsx" % (job.get("name", "job"), job.get("server", ""), datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        out = self.store.export_path(name)
        cmpmod.export_xlsx(rows, {"job_name": job.get("name", ""), "server": job.get("server", ""), "param_sheet": ps.get("name", ""),
                                  "worker": self._worker(job)}, out)
        return out

    def evidence_images(self, sop_key):
        """手順実行セッションの証跡画像を [(手順番号, 手順名, 説明, キー, 画像パス, メタ)] で返す（手順順）。"""
        s = self.store.sop_get(sop_key) if sop_key else None
        if not s:
            return []
        out = []
        for no, st in enumerate(s.get("steps") or [], 1):
            imgs = ((s.get("results") or {}).get(st.get("id")) or {}).get("images") or {}
            for req in st.get("evidence") or []:
                for meta in imgs.get(req.get("id")) or []:
                    try:
                        out.append((no, st.get("title", ""), req.get("desc", ""), req.get("key", ""), self.store.image_path(meta.get("id")), meta))
                    except KeyError:
                        continue
        return out

    def export_deliverable(self, job, sop_key=None):
        tpl = self._template(job)
        if not tpl:
            raise ValueError("この作業には成果物テンプレートが選択されていません")
        path, _ = self.store.lib_file(tpl["id"])
        res = self.resolve(job)
        values = {r["id"]: r["value"] for r in res if r["kind"] != "none"}
        name = "%s_%s_%s.xlsx" % (os.path.splitext(tpl.get("original_name") or tpl["name"])[0], job.get("server", ""), datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        out = self.store.export_path(name)
        evidence = self.evidence_images(sop_key) if sop_key else None
        written = fillmod.fill_template(path, tpl.get("items", []), values, out, evidence=evidence)
        return out, written

    # ---------------- samples ----------------
    def load_samples(self):
        made = []
        def rd(n):
            with open(os.path.join(SAMPLES, n), "rb") as f:
                return f.read()
        ps = self.upload("param_sheet", "EC2パラメータシート_sample.xlsx", rd("EC2パラメータシート_sample.xlsx"))
        made.append(ps)
        xt = self.upload("excel_template", "構築結果報告書_template_sample.xlsx", rd("構築結果報告書_template_sample.xlsx"))
        xt, _ = self.auto_map(xt["id"], ps["id"])
        made.append(xt)
        # パラメータシート・テンプレートと同じ EC2 項目を確認する手順書。入力欄のキーと証跡画像の要求を設定済みにしておく
        # （手順実行で開くと自動適用され、④ 最終値チェック・主要値一覧 PDF で ③ の実測値と突き合わせられる）
        pr = self.upload("procedure", "EC2構築確認手順書_sample.docx", rd("EC2構築確認手順書_sample.docx"))
        with open(os.path.join(SAMPLES, "EC2構築確認手順書_settings.json"), encoding="utf-8") as f:
            pr = self.store.lib_update(pr["id"], {"evidence": json.load(f)})
        made.append(pr)
        with open(os.path.join(SAMPLES, "command_templates_sample.json"), encoding="utf-8") as f:
            cs = json.load(f)
        made.append(self.create_command_set(cs["name"], cs["templates"]))
        return made
