"""把已知值写入客户交付物模板并另存（保留模板原有格式）。

只修改值：openpyxl 写入 cell.value 时保留字体/填充/边框/数字格式/合并单元格/列宽/数据验证/条件格式。
注意：openpyxl 不保留图片、图表、形状、宏（见 README 的已知限制）。
"""
import datetime
import re

from openpyxl import load_workbook
from openpyxl.styles.numbers import is_date_format

from .rules import to_number

_DATE = re.compile(r"^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*$")


def _typed(item, value, cell):
    s = str(value).strip()
    if item.get("type") == "number":
        n = to_number(s)
        if n is not None:
            return int(n) if n.is_integer() else n
    if item.get("type") == "date" or is_date_format(cell.number_format or "General"):
        m = _DATE.match(s)
        if m:
            try:
                d = datetime.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                if is_date_format(cell.number_format or "General"):
                    return d
            except ValueError:
                pass
    return s


def fill_template(template_path, items, values, out_path):
    """values: {item_id: value}. 返回写入的单元格列表。"""
    wb = load_workbook(template_path)
    written = []
    for it in items:
        if it["id"] not in values:
            continue
        v = values[it["id"]]
        if v is None or str(v).strip() == "":
            continue
        if it["sheet"] not in wb.sheetnames:
            continue
        ws = wb[it["sheet"]]
        cell = ws[it["cell"]]
        if type(cell).__name__ == "MergedCell":
            continue
        ph = it.get("placeholder")
        cur = cell.value
        if ph and isinstance(cur, str) and ph in cur and cur.strip() != ph.strip():
            cell.value = cur.replace(ph, str(v), 1)       # 保留占位符前后的文字
        else:
            cell.value = _typed(it, v, cell)
        written.append(it["id"])
    wb.save(out_path)
    return written
