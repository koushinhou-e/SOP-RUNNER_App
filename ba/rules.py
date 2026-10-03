"""入力チェック規則 / 输入校验规则。

规则结构 (item["rules"]):
  {"required": bool, "preset": "ipv4"|..., "pattern": "regex", "min": num, "max": num, "options": [...] }
item["type"] in {"text","number","dropdown","date"}; dropdown 的选项在 item["options"]。
同样的逻辑在 web/js/rules.js 中实现（浏览器实时显示），两者共用 tests/vectors/rules_vectors.json 做一致性测试。
"""
import json
import os
import re
import unicodedata

_PRESETS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules_presets.json")
with open(_PRESETS_PATH, encoding="utf-8") as _f:
    PRESETS = json.load(_f)

MESSAGES = {
    "required": "必填",
    "options": "不在允许的选项中",
    "number": "不是数字",
    "min": "小于最小值 {min}",
    "max": "大于最大值 {max}",
    "preset": "格式不符：{label}",
    "pattern": "不符合正则 {pattern}",
    "bad_pattern": "正则无效",
}

_NUM = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)$")


def norm(v):
    if v is None:
        return ""
    return unicodedata.normalize("NFKC", str(v)).strip()


def to_number(v):
    s = norm(v).replace(",", "")
    if not _NUM.match(s):
        return None
    return float(s)


def validate(item, value):
    """返回错误列表 [{code, message}]；空列表表示通过。"""
    rules = item.get("rules") or {}
    errs = []
    s = norm(value)
    if s == "":
        if rules.get("required"):
            errs.append({"code": "required", "message": MESSAGES["required"]})
        return errs
    opts = item.get("options") or rules.get("options") or []
    if item.get("type") == "dropdown" and opts and not rules.get("allow_other"):
        if s not in [norm(o) for o in opts]:
            errs.append({"code": "options", "message": MESSAGES["options"]})
    is_num = item.get("type") == "number" or rules.get("min") not in (None, "") or rules.get("max") not in (None, "")
    if is_num:
        n = to_number(s)
        if n is None:
            errs.append({"code": "number", "message": MESSAGES["number"]})
        else:
            mn, mx = rules.get("min"), rules.get("max")
            if mn not in (None, "") and n < float(mn):
                errs.append({"code": "min", "message": MESSAGES["min"].format(min=mn)})
            if mx not in (None, "") and n > float(mx):
                errs.append({"code": "max", "message": MESSAGES["max"].format(max=mx)})
    preset = rules.get("preset")
    if preset and preset in PRESETS:
        if not re.fullmatch(PRESETS[preset]["pattern"], s):
            errs.append({"code": "preset", "message": MESSAGES["preset"].format(label=PRESETS[preset]["label"])})
    pat = rules.get("pattern")
    if pat:
        try:
            if not re.fullmatch(pat, s):
                errs.append({"code": "pattern", "message": MESSAGES["pattern"].format(pattern=pat)})
        except re.error:
            errs.append({"code": "bad_pattern", "message": MESSAGES["bad_pattern"]})
    return errs
