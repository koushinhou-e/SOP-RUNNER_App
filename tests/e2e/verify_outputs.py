"""校验 E2E 下载的文件（用 openpyxl）：交付物的值与格式、比对结果。  python tests/e2e/verify_outputs.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path[:0] = [os.path.join(ROOT, "vendor"), os.path.join(ROOT, "tests")]
from openpyxl import load_workbook  # noqa: E402
from test_fill import style_sig  # noqa: E402

OUT = os.path.join(ROOT, "tests", "_out")
TPL = os.path.join(ROOT, "samples", "構築結果報告書_template_sample.xlsx")
ok = bad = 0


def check(c, m):
    global ok, bad
    print(("  ✔ " if c else "  ✘ ") + m)
    ok += bool(c)
    bad += (not c)


d = load_workbook(os.path.join(OUT, "deliverable.xlsx"))
t = load_workbook(TPL)
ws, wt = d["構築結果"], t["構築結果"]
check(ws["C9"].value == "web01.example.local" and ws["C10"].value == "i-0123456789abcdef0" and ws["C11"].value == "t3.large", "交付物：参数值已写入")
check(ws["C12"].value == 2 and ws["C13"].value == 8 and ws["C19"].value == 30, "交付物：数字单元格写为数值")
check(ws["C4"].value.strftime("%Y-%m-%d") == "2026-10-03" and ws["C4"].number_format == "yyyy/mm/dd", "交付物：作業日写为日期并保留 yyyy/mm/dd 格式")
check(ws["C3"].value == "サンプル基盤構築" and ws["C5"].value == "山田 太郎" and ws["C6"].value == "佐藤 花子" and ws["C7"].value == "MNG-0042", "交付物：作业输入已写入（含手动新增的 C7）")
check(all(ws["D%d" % r].value == "OK" for r in range(9, 20)) and ws["C21"].value == "合格", "交付物：確認結果/総合判定")
check(ws["E9"].value is None and ws["C22"].value == "（　　　）", "交付物：不填/未填的单元格保持原样（留给手动编辑）")
diffs = [c.coordinate for row in wt.iter_rows() for c in row if style_sig(c) != style_sig(ws[c.coordinate])]
check(not diffs, "交付物：所有单元格样式（字体/底色/边框/数字格式/对齐）与模板一致 %s" % (diffs[:5] if diffs else ""))
check(sorted(map(str, wt.merged_cells.ranges)) == sorted(map(str, ws.merged_cells.ranges)), "交付物：合并单元格一致")
check({k: v.width for k, v in wt.column_dimensions.items()} == {k: v.width for k, v in ws.column_dimensions.items()}, "交付物：列宽一致")
check(len(ws.data_validations.dataValidation) == len(wt.data_validations.dataValidation) and d["リスト"].sheet_state == "hidden", "交付物：数据验证与隐藏工作表保留")
check(ws.freeze_panes == wt.freeze_panes, "交付物：冻结窗格保留")

c = load_workbook(os.path.join(OUT, "compare.xlsx")).active
rows = [[x.value for x in r] for r in c.iter_rows()]
hdr_i = next(i for i, r in enumerate(rows) if r[0] == "No")
data = [r for r in rows[hdr_i + 1:] if r[0]]
it = next(r for r in data if r[3] == "instance_type")
check(len(data) == 13, "比对结果：13 行")
check(it[4] == "t3.large" and it[5] == "t3.medium" and it[6] == "不一致" and it[7] == "NG" and "変更要否" in (it[9] or ""), "比对结果：instance_type 不一致 / NG / 备注")
check(sum(1 for r in data if r[7] == "OK") == 12, "比对结果：OK 12")
check(c.cell(row=hdr_i + 1 + data.index(it) + 1, column=6).fill.fgColor.rgb.endswith("FDE2E2"), "比对结果：不一致行标红")
print("\nRESULT: %d passed, %d failed" % (ok, bad))
sys.exit(1 if bad else 0)
