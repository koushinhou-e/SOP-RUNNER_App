# -*- coding: utf-8 -*-
"""UI が日本語のみであることの検査：画面に出る文字列に簡体字（中国語専用の字形）や中国語特有の語が無いこと。

対象:
  * web/ 配下の .js / .html / .css（web/vendor を除く）— JS は文字列リテラルのみ（コメントと正規表現リテラルは
    文書解析用のため対象外）、HTML はタグ内外のテキスト、CSS はコメント以外
  * ba/*.py と app.py の文字列リテラル（docstring は除く）、ba/rules_presets.json、samples/command_templates_sample.json
  * 起動スクリプト start.bat / start.sh / start.command（全文）
  * README.md の日本語部分（開発者向け中国語セクションより前）
"""
import ast
import io
import os
import re
import tokenize
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# 簡体字でのみ使われ、日本語（新字体）では使わない字。日本語と共通の字形（例: 数 号 写 与 体 会 双 宝 了）は含めない。
SIMPLIFIED_ONLY = set(
    "这们输导认确设项执选择删载开关时间务单码测试检编辑错误问题显种么吗没为从后个东发现动无对应头实际结证业报书页"
    "级规则览链网络线态帮请签转换读进达运还过迟递遗难顺预类风飞验值骤录节带户闭门闻队阶陆险随隐须顾领频颜额馈"
    "两严丰临丽举义乐习买亏亚产亲亿仅仓仪价众优传伤伪侧储儿兴养兽册军农冻净减击创别剧劝办励劳势华协卖卫厂历压县"
    "变启员响团园围图圆圣场坏块坚垒处备复够夺奋妇实审宽对寻层岁岛币师帐广庆库废异弃张弹归彻忆总恶惊惯战扩扫扬护"
    "拟挂损摄敌暂术杀杂权极构标栏树样档桥楼欢毕气汇汉浏济满灵热爱环电监盘础离积稳窗笔简紧统罗职联胜脑艺范获"
    "虑虽补观视觉计订让议讯记讲许论访评识词话询该详语说调谁谢负账货质购贴费资赋车软轻较辅边远违连适逻邮钟钮铁"
    "银销锁键长闲际释鉴针钱阳阴阵陈驱鱼齿冲况决您你吧呢啊")
# 字形は日本語と共通だが、中国語でしか使わない語
CHINESE_WORDS = ["模板", "文件", "信息", "按钮", "用户", "数据", "默认", "当前", "参数", "映射", "打开", "填写", "列表",
                 "本机", "示例", "未填", "必填", "格式不符", "正则", "已经", "可以", "加载", "视为", "手顺"]


def bad_fragments(text):
    out = []
    for i, ch in enumerate(text):
        if ch in SIMPLIFIED_ONLY:
            out.append(text[max(0, i - 8):i + 8])
    for w in CHINESE_WORDS:
        for m in re.finditer(re.escape(w), text):
            out.append(text[max(0, m.start() - 8):m.end() + 8])
    return out


REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")
REGEX_KW = ("return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "else")


def js_strings(src):
    """JS ソースから文字列リテラル（'..' ".." `..`）を抽出する。コメントと正規表現リテラルはスキップ。"""
    out, i, n, prev = [], 0, len(src), ""
    while i < n:
        c = src[i]
        if c in " \t\r\n":
            i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in "'\"`":
            j, buf = i + 1, []
            while j < n and src[j] != c:
                if src[j] == "\\":
                    buf.append(src[j:j + 2])
                    j += 2
                    continue
                buf.append(src[j])
                j += 1
            out.append("".join(buf))
            i, prev = j + 1, "str"
            continue
        if c == "/" and (prev == "" or prev in REGEX_PREV or prev in REGEX_KW):
            j, cls = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    cls = True
                elif src[j] == "]":
                    cls = False
                elif src[j] == "/" and not cls:
                    break
                j += 1
            i, prev = j + 1, "re"
            while i < n and src[i].isalpha():
                i += 1
            continue
        m = re.match(r"[A-Za-z_$][\w$]*", src[i:])
        if m:
            prev = m.group(0)
            i += len(prev)
            continue
        prev = c
        i += 1
    return out


def py_strings(src):
    tree = ast.parse(src)
    doc_lines = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)) and node.body:
            b = node.body[0]
            if isinstance(b, ast.Expr) and isinstance(getattr(b, "value", None), ast.Constant) and isinstance(b.value.value, str):
                doc_lines.update(range(b.lineno, (getattr(b, "end_lineno", None) or b.lineno) + 1))
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.STRING and tok.start[0] not in doc_lines:
            out.append(tok.string)
    return out


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def targets():
    """(表示名, 検査対象テキスト) を列挙。"""
    web = os.path.join(ROOT, "web")
    for d, dirs, files in os.walk(web):
        dirs[:] = [x for x in dirs if x != "vendor"]
        for fn in files:
            p = os.path.join(d, fn)
            rel = os.path.relpath(p, ROOT)
            if fn.endswith(".js"):
                for s in js_strings(read(p)):
                    yield rel, s
            elif fn.endswith(".html"):
                yield rel, re.sub(r"<!--.*?-->", "", read(p), flags=re.S)
            elif fn.endswith(".css"):
                yield rel, re.sub(r"/\*.*?\*/", "", read(p), flags=re.S)
    pys = [os.path.join(ROOT, "app.py")] + [os.path.join(ROOT, "ba", f) for f in os.listdir(os.path.join(ROOT, "ba")) if f.endswith(".py")]
    for p in pys:
        for s in py_strings(read(p)):
            yield os.path.relpath(p, ROOT), s
    for rel in ("ba/rules_presets.json", "samples/command_templates_sample.json", "start.bat", "start.sh", "start.command"):
        yield rel, read(os.path.join(ROOT, rel))
    readme = read(os.path.join(ROOT, "README.md"))
    yield "README.md(日本語部分)", readme.split("<!-- zh-dev -->")[0]


class NoChineseTest(unittest.TestCase):
    def test_tokenizer_sanity(self):
        s = js_strings("var a = /确认/.test(x) ? '確認' : \"x\"; // 这是注释\n/* 注释 */ b = 4 / 2; c = `t`;")
        self.assertEqual(s, ["確認", "x", "t"])
        self.assertTrue(bad_fragments("请确认"))
        self.assertFalse(bad_fragments("確認してください。作業者・実測値・期待値・判定・備考・異常・手順書・数値・入力"))

    def test_no_simplified_chinese_in_ui(self):
        hits = []
        for rel, text in targets():
            for frag in bad_fragments(text):
                hits.append("%s: …%s…" % (rel, frag.replace("\n", " ")))
        self.assertEqual(hits, [], "中国語（簡体字）の文言が残っています:\n" + "\n".join(hits[:80]))

    def test_html_lang_and_font(self):
        html = read(os.path.join(ROOT, "web", "index.html"))
        self.assertIn('<html lang="ja">', html)
        css = read(os.path.join(ROOT, "web", "css", "app.css")) + read(os.path.join(ROOT, "web", "sop", "sop.css"))
        self.assertIn('"Yu Gothic UI",Meiryo,"Hiragino Sans",sans-serif', css)
        self.assertNotIn("YaHei", css)
        self.assertNotIn("PingFang", css)


if __name__ == "__main__":
    unittest.main()
