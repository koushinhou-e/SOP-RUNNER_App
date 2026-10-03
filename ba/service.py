"""业务逻辑层（HTTP 层与测试都调用这里）。"""
import datetime
import json
import os

from . import commands as cmdmod
from . import compare as cmpmod
from . import fill as fillmod
from . import paramsheet
from . import rules
from . import xlsx_detect
from .store import Store, safe_name

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
                ctx.setdefault(it["key"], v)
                if not ctx.get(it["key"]):
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
            errs = rules.validate(it, val) if kind != "none" else []
            out.append({"id": it["id"], "sheet": it["sheet"], "cell": it["cell"], "label": it["label"], "kind": kind,
                        "key": src.get("key"), "value": val, "errors": errs})
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

    def export_deliverable(self, job):
        tpl = self._template(job)
        if not tpl:
            raise ValueError("この作業には成果物テンプレートが選択されていません")
        path, _ = self.store.lib_file(tpl["id"])
        res = self.resolve(job)
        values = {r["id"]: r["value"] for r in res if r["kind"] != "none"}
        name = "%s_%s_%s.xlsx" % (os.path.splitext(tpl.get("original_name") or tpl["name"])[0], job.get("server", ""), datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        out = self.store.export_path(name)
        written = fillmod.fill_template(path, tpl.get("items", []), values, out)
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
        made.append(self.upload("procedure", "Webサーバ定期パッチ適用手順書.docx", rd("Webサーバ定期パッチ適用手順書.docx")))
        with open(os.path.join(SAMPLES, "command_templates_sample.json"), encoding="utf-8") as f:
            cs = json.load(f)
        made.append(self.create_command_set(cs["name"], cs["templates"]))
        return made
