"""手順修正：手順テンプレートの保存（ファイルなしの手順書）と、参考画像・入力キー・証跡要求の引き継ぎ。"""
import shutil
import tempfile
import unittest

import _util  # noqa: F401  （vendor/ を sys.path に追加）
from ba.service import Service

IMG = "img-20261005120000-0a1b2c3d"


def steps():
    return [
        {"id": "x1", "section": "2. 確認", "title": "インスタンス情報を確認する", "context": "", "content": "$ aws ec2 describe-instances", "expected": "タイプが {{instance_type}} であること",
         "inputs": [{"id": "x2", "label": "インスタンスタイプ", "type": "text", "unit": "", "optional": False, "key": " instance_type "}],
         "evidence": [{"id": "ev1", "desc": "EC2 詳細画面", "key": "img_ec2"}],
         "refImages": [{"id": IMG, "w": 720, "h": 400, "ext": "png", "name": "expected.png", "caption": "期待される画面", "size": 123, "extra": "捨てられる"},
                       {"id": "../../etc/passwd", "w": 1, "h": 1, "ext": "png"}],
         "results": {"values": {"x2": "実行時の値は持ち込まない"}}},
        {"id": "x3", "title": "終了", "inputs": [{"id": "bad"}, "not-a-dict"]},
    ]


class ProcedureTemplateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.S = Service(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_clean_steps_keeps_only_known_fields(self):
        out = self.S.clean_steps(steps())
        s1 = out[0]
        self.assertEqual(s1["expected"], "タイプが {{instance_type}} であること")
        self.assertEqual(s1["inputs"], [{"id": "x2", "label": "インスタンスタイプ", "type": "text", "unit": "", "optional": False, "key": "instance_type"}])   # キーは前後の空白を除く
        self.assertEqual(s1["evidence"], [{"id": "ev1", "desc": "EC2 詳細画面", "key": "img_ec2"}])
        self.assertEqual(s1["refImages"], [{"id": IMG, "w": 720, "h": 400, "ext": "png", "name": "expected.png", "caption": "期待される画面"}])   # 不正な ID・余分な項目は落とす
        self.assertNotIn("results", s1)
        self.assertEqual([i["id"] for i in out[1]["inputs"]], ["bad"])      # dict でないものは落とす（id だけの項目は空のラベルで残る）
        self.assertEqual(out[1]["refImages"], [])

    def test_invalid_steps_rejected(self):
        for bad in (None, [], "x", [{"title": "id なし"}], [1], [{"id": "x1"}] * 501):
            with self.assertRaises(ValueError):
                self.S.clean_steps(bad)

    def test_save_new_overwrite_and_listing(self):
        with self.assertRaises(ValueError):
            self.S.save_procedure_template("  ", steps())
        m = self.S.save_procedure_template("EC2 手順（改）", steps(), seq=7, param_ref={"id": "ps-x", "server": "web01"})
        self.assertEqual((m["type"], m["kind"], m["name"], m["seq"], m["param_ref"]), ("procedure", "steps", "EC2 手順（改）", 7, {"id": "ps-x", "server": "web01"}))
        self.assertNotIn("file", m)                      # ファイルを持たない手順書
        self.assertEqual([x["id"] for x in self.S.store.lib_list("procedure")], [m["id"]])
        new_steps = steps()[:1]
        new_steps[0]["expected"] = "更新後"
        m2 = self.S.save_procedure_template("EC2 手順（改）v2", new_steps, item_id=m["id"])
        self.assertEqual((m2["id"], m2["name"], len(m2["steps"]), m2["steps"][0]["expected"]), (m["id"], "EC2 手順（改）v2", 1, "更新後"))
        self.assertEqual(len(self.S.store.lib_list("procedure")), 1)       # 上書きなので増えない
        ps = self.S.load_samples()[0]
        with self.assertRaises(ValueError):                                 # 手順テンプレート以外は上書きできない
            self.S.save_procedure_template("x", steps(), item_id=ps["id"])


class ProcedureTemplateApiTest(unittest.TestCase):
    def test_http_routes(self):
        import http.client
        import json
        from ba.server import App
        tmp = tempfile.mkdtemp()
        app = App(tmp, port=0)
        app.start_background()
        try:
            def req(method, path, body=None):
                c = http.client.HTTPConnection("127.0.0.1", app.port, timeout=10)
                c.request(method, path, json.dumps(body) if body is not None else None, {"Host": "127.0.0.1:%d" % app.port, "X-Token": app.token, "Content-Type": "application/json"})
                r = c.getresponse()
                data = json.loads(r.read().decode("utf-8") or "{}")
                c.close()
                return r.status, data
            st, m = req("POST", "/api/library/procedure_template", {"name": "テンプレート", "steps": steps(), "doc_title": "t"})
            self.assertEqual((st, m["kind"], len(m["steps"])), (200, "steps", 2))
            st, m2 = req("POST", "/api/library/%s/steps" % m["id"], {"name": "改名", "steps": steps()[:1]})
            self.assertEqual((st, m2["name"], len(m2["steps"])), (200, "改名", 1))
            st, g = req("GET", "/api/library/" + m["id"])
            self.assertEqual((st, g["steps"][0]["refImages"][0]["id"]), (200, IMG))
            self.assertEqual(req("POST", "/api/library/procedure_template", {"name": "", "steps": steps()})[0], 400)
            self.assertEqual(req("POST", "/api/library/procedure_template", {"name": "x", "steps": []})[0], 400)
            self.assertEqual(req("POST", "/api/library/pr-00000-nothing/steps", {"name": "x", "steps": steps()})[0], 404)
        finally:
            app.shutdown()
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
