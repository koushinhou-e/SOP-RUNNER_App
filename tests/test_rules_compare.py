import json
import os
import unittest

import _util  # noqa: F401
from ba import compare, rules

V = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectors")


class RulesTest(unittest.TestCase):
    def test_vectors(self):
        with open(os.path.join(V, "rules_vectors.json"), encoding="utf-8") as f:
            for v in json.load(f):
                with self.subTest(v=v):
                    self.assertEqual([e["code"] for e in rules.validate(v["item"], v["value"])], v["codes"])


class CompareTest(unittest.TestCase):
    def test_vectors(self):
        with open(os.path.join(V, "compare_vectors.json"), encoding="utf-8") as f:
            for e, a, r in json.load(f):
                with self.subTest(e=e, a=a):
                    self.assertEqual(compare.judge(e, a), r)

    def test_rows_and_summary(self):
        params = [{"key": "instance_type", "label": "インスタンスタイプ", "category": "基本", "values": {"web01": "t3.large"}},
                  {"key": "memory_gib", "label": "メモリ(GiB)", "category": "基本", "values": {"web01": "8"}},
                  {"key": "os", "label": "OS", "category": "OS", "values": {"web01": "Amazon Linux 2023"}}]
        state = {"instance_type": {"actual": "t3.medium", "judgement": "NG"}, "memory_gib": {"actual": "8 GiB", "judgement": "OK"}}
        rows = compare.build_rows(params, "web01", state)
        self.assertEqual([r["auto"] for r in rows], ["mismatch", "match", "missing"])
        s = compare.summary(rows)
        self.assertEqual((s["mismatch"], s["match"], s["missing"], s["ok"], s["ng"], s["unjudged"]), (1, 1, 1, 1, 1, 1))
