"""v1 sop-runner のソースを v2（web/sop/）へ同期し、「手順実行」タブとして組み込むための最小限の変更を加える。

    python tools/sync_from_v1.py /path/to/sop-runner

app.js への構造パッチ（各パッチは一致を検証し、v1 が変わった場合はエラーで知らせる）:
  1. マウント先 #app/#hdr → #sop-app/#sop-hdr
  2. localStorage の読み書き → SopStore（サーバ側 JSON 保存、localStorage は予備）
  3. 起動時にサーバからセッションを読み込んでから描画
  4. グローバルなドラッグ＆ドロップは「手順実行」タブ表示中のみ有効
  5. ホーム描画後に SopHooks.afterHome を呼ぶ（「ライブラリから開く」を表示）
  6. SopApp.importFile を公開（テンプレートライブラリから呼び出す）
さらに tools/v1_ja.py の置換表で UI 文言を日本語化する（parser.js / export.js / app.js / app.css）。
v1 本体（/workspace/sop-runner）は変更しない。
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import v1_ja  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, "..", "web", "sop")

PATCHES = [
    ("var app = document.getElementById('app');", "var app = document.getElementById('sop-app');"),
    ("var hdr = document.getElementById('hdr');", "var hdr = document.getElementById('sop-hdr');"),
    ("try { localStorage.setItem(S.key, JSON.stringify(S)); } catch (e) { toast('保存失败：' + e.message); }",
     "SopStore.save(S);"),
    ("try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }",
     "return SopStore.load(key);"),
    ("for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) { var s = load(k); if (s && s.steps) out.push(s); } }",
     "SopStore.list().forEach(function (s) { if (s && s.steps) out.push(s); });"),
    ("localStorage.removeItem(b.getAttribute('data-key')); render();", "SopStore.remove(b.getAttribute('data-key')); render();"),
    ("window.addEventListener('drop', function (e) { e.preventDefault(); if (!S &&",
     "window.addEventListener('drop', function (e) { e.preventDefault(); if (app.offsetParent !== null && !S &&"),
    ("    app.innerHTML = h;\n    var drop = document.getElementById('drop');",
     "    app.innerHTML = h;\n    if (window.SopHooks && SopHooks.afterHome) SopHooks.afterHome(app);\n    var drop = document.getElementById('drop');"),
    ("window.SopApp = { state: function () { return S; } };",
     "window.SopApp = { state: function () { return S; }, importFile: importDocx, render: render, home: function () { S = null; render(); } };"),
    ("  render();\n})();", "  SopStore.init().then(render);\n})();"),
]


def apply_table(code, table, name):
    for old, new, count in table:
        n = code.count(old)
        if n != count:
            raise SystemExit("%s: expected %d match(es), found %d (v1 changed?):\n%s" % (name, count, n, old))
        code = code.replace(old, new)
    return code


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, code):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(code)


def main(v1):
    src = os.path.join(v1, "src")
    os.makedirs(DST, exist_ok=True)
    note = "/* Synced from v1 sop-runner/src/%s by tools/sync_from_v1.py (UI 文言は日本語化済み) — 手で編集しないこと。 */\n"
    write(os.path.join(DST, "parser.js"), note % "parser.js" + apply_table(read(os.path.join(src, "parser.js")), v1_ja.PARSER, "parser.js"))
    exp = v1_ja.drop_zh_labels(apply_table(read(os.path.join(src, "export.js")), v1_ja.EXPORT, "export.js"))
    write(os.path.join(DST, "export.js"), note % "export.js" + exp)
    write(os.path.join(DST, "sop.css"), note % "app.css" + apply_table(read(os.path.join(src, "app.css")), v1_ja.CSS, "app.css"))
    code = read(os.path.join(src, "app.js"))
    for old, new in PATCHES:
        if old not in code:
            raise SystemExit("patch target not found (v1 changed?):\n" + old)
        code = code.replace(old, new, 1)
    code = apply_table(code, v1_ja.APP, "app.js")
    write(os.path.join(DST, "sop-app.js"), note % "app.js" + code)
    print("synced to", os.path.abspath(DST))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "sop-runner"))
