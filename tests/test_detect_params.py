import unittest

import _util
from ba import paramsheet, xlsx_detect


class DetectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.items = xlsx_detect.detect_workbook(_util.TEMPLATE)
        cls.by = {i["cell"]: i for i in cls.items}

    def test_counts_and_reasons(self):
        self.assertEqual(len(self.items), 39)
        reasons = {}
        for i in self.items:
            reasons[i["reason"]] = reasons.get(i["reason"], 0) + 1
        self.assertEqual(reasons, {"placeholder": 3, "highlight": 2, "label": 21, "validation": 13})

    def test_placeholders(self):
        self.assertEqual(self.by["C3"]["key"], "project_name")
        self.assertEqual(self.by["C3"]["label"], "案件名")
        self.assertEqual(self.by["C6"]["placeholder"], "＿＿＿＿＿＿")
        self.assertEqual(self.by["C22"]["label"], "特記事項")
        self.assertFalse(self.by["C22"]["rules"]["required"])

    def test_highlight_and_date(self):
        self.assertEqual(self.by["C4"]["reason"], "highlight")
        self.assertEqual(self.by["C4"]["type"], "date")
        self.assertEqual(self.by["C5"]["label"], "作業者")
        self.assertEqual(self.by["C5"]["key"], "worker")

    def test_validation_list_inline_and_range(self):
        d9 = self.by["D9"]
        self.assertEqual((d9["type"], d9["options"], d9["label"]), ("dropdown", ["OK", "NG", "対象外"], "サーバ名 / 確認結果"))
        self.assertEqual(self.by["C21"]["options"], ["合格", "不合格"])   # =リスト!$A$1:$A$2 (hidden sheet)

    def test_number_types(self):
        self.assertEqual(self.by["C12"]["type"], "number")
        self.assertEqual((self.by["C12"]["rules"]["min"], self.by["C12"]["rules"]["max"]), (1, 128))
        self.assertEqual(self.by["C13"]["type"], "number")   # number_format "0"
        self.assertTrue(self.by["C13"]["rules"]["required"])  # メモリ is not メモ

    def test_presets_by_label(self):
        self.assertEqual(self.by["C10"]["rules"].get("preset"), "instance_id")
        self.assertEqual(self.by["C18"]["rules"].get("preset"), "ipv4")
        self.assertEqual(self.by["C9"]["rules"].get("preset"), "hostname")

    def test_notes_column_optional_and_unfilled(self):
        e9 = self.by["E9"]
        self.assertEqual(e9["source"]["kind"], "none")
        self.assertFalse(e9["rules"]["required"])

    def test_merged_cells_not_duplicated(self):
        self.assertNotIn("D21", self.by)       # C21:D21 merged
        self.assertNotIn("C1", self.by)        # title merged B1:E1

    def test_automap(self):
        items = xlsx_detect.detect_workbook(_util.TEMPLATE)
        ps = paramsheet.parse(_util.PARAMS)
        n = xlsx_detect.auto_map(items, ps["params"])
        self.assertEqual(n, 11)
        by = {i["cell"]: i for i in items}
        self.assertEqual(by["C11"]["source"], {"kind": "param", "key": "instance_type"})
        self.assertEqual(by["C13"]["source"], {"kind": "param", "key": "memory_gib"})
        self.assertEqual(by["D11"]["source"]["kind"], "input")   # 確認結果 column is never mapped to the parameter


class ParamSheetTest(unittest.TestCase):
    def test_parse(self):
        p = paramsheet.parse(_util.PARAMS)
        self.assertEqual(p["servers"], ["web01", "web02", "db01"])
        self.assertEqual(len(p["params"]), 13)
        ctx = paramsheet.server_context(p, "db01")
        self.assertEqual(ctx["instance_type"], "r5.xlarge")
        self.assertEqual(ctx["memory_gib"], "32")      # int, not "32.0"
        self.assertEqual(ctx["private_ip"], "198.51.100.21")
        self.assertEqual([x["category"] for x in p["params"]][:2], ["基本", "基本"])

    def test_two_column_sheet(self):
        import os
        import tempfile
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(["項目", "値"])
        ws.append(["インスタンスタイプ", "t3.small"])
        ws.append(["EBSサイズ", 50])
        fd, path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        try:
            wb.save(path)
            p = paramsheet.parse(path)
            self.assertEqual(p["servers"], ["default"])
            self.assertEqual(p["params"][1]["values"]["default"], "50")
            self.assertEqual(p["params"][0]["key"], "インスタンスタイプ")
        finally:
            os.remove(path)
