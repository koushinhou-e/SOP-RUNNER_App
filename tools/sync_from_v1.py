"""v1 sop-runner のソースを v2（web/sop/）へ同期し、「手順実行」タブとして組み込むための最小限の変更を加える。

    python tools/sync_from_v1.py /path/to/sop-runner

app.js への構造パッチ（各パッチは一致を検証し、v1 が変わった場合はエラーで知らせる）:
  1. マウント先 #app/#hdr → #sop-app/#sop-hdr
  2. localStorage の読み書き → SopStore（サーバ側 JSON 保存、localStorage は予備）
  3. 起動時にサーバからセッションを読み込んでから描画
  4. グローバルなドラッグ＆ドロップは「手順実行」タブ表示中のみ有効
  5. ホーム描画後に SopHooks.afterHome を呼ぶ（「ライブラリから開く」を表示）
  6. SopApp.importFile / save / refreshGate を公開（テンプレートライブラリ・証跡画像モジュールから呼び出す）
  8. 入力項目のパラメータキー列（data-inped="key"）と値の入力日時 results[].valuesAt
  7. 証跡画像モジュール（web/sop/sop-evidence.js）用のフック：missing / onImport / afterParse / editHeader / editExtra / runExtra、結合時の引き継ぎ
  9. 完了ページ描画後に SopHooks.afterDone を呼ぶ（確認結果報告書の作成ボタンと確認ダイアログ）
export.js には証跡画像の行・名前空間・パーツ拡張のフックを追加する。
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
     "window.SopApp = { state: function () { return S; }, importFile: importDocx, render: render, save: save, refreshGate: refreshGate, home: function () { S = null; render(); } };"),
    ("  render();\n})();", "  SopStore.init().then(render);\n})();"),
    # ---- カスタム証跡画像（web/sop/sop-evidence.js）用のフック ----
    ("function missing(st) { var r = res(st); return st.inputs.filter(function (inp) { return !inp.optional && !isFilled(inp, r.values[inp.id]); }); }",
     "function missing(st) { var r = res(st); var m = st.inputs.filter(function (inp) { return !inp.optional && !isFilled(inp, r.values[inp.id]); }); return window.SopHooks && SopHooks.missingExtra ? m.concat(SopHooks.missingExtra(st, r)) : m; }"),
    ("    file.arrayBuffer().then(function (buf) {", "    if (window.SopHooks && SopHooks.onImport) SopHooks.onImport(file);\n    file.arrayBuffer().then(function (buf) {"),
    ("newSession(file.name, hash, parsed); render();", "newSession(file.name, hash, parsed); if (window.SopHooks && SopHooks.afterParse) SopHooks.afterParse(S); render();"),
    ("    h += '<div class=\"ins\"><button class=\"insbtn\" data-act=\"insert\" data-at=\"0\">＋ 在开头插入步骤</button></div>';",
     "    if (window.SopHooks && SopHooks.editHeader) h += SopHooks.editHeader();\n    h += '<div class=\"ins\"><button class=\"insbtn\" data-act=\"insert\" data-at=\"0\">＋ 在开头插入步骤</button></div>';"),
    ("＋ 添加输入项</button></div></div></div>';", "＋ 添加输入项</button></div>' + (window.SopHooks && SopHooks.editExtra ? SopHooks.editExtra(st) : '') + '</div></div>';"),
    ("    m += '<div class=\"lbl\">备注（可选）</div>", "    if (window.SopHooks && SopHooks.runExtra) m += SopHooks.runExtra(st, r, confirmed);\n    m += '<div class=\"lbl\">备注（可选）</div>"),
    ("st.inputs = st.inputs.concat(nx.inputs);", "st.inputs = st.inputs.concat(nx.inputs); st.evidence = (st.evidence || []).concat(nx.evidence || []);"),
    # ---- 最終値チェック：入力項目のパラメータキー（編集画面）と、値の入力日時 ----
    ("<th>可选</th><th></th></tr>' +", "<th>可选</th><th title=\"パラメータキー（最終値チェック・作業入力値一覧で使用）\">キー</th><th></th></tr>' +"),
    ("            '<td><input type=\"checkbox\" data-inped=\"optional\" data-sid=\"' + st.id + '\" data-iid=\"' + inp.id + '\"' + (inp.optional ? ' checked' : '') + '></td>' +",
     "            '<td><input type=\"checkbox\" data-inped=\"optional\" data-sid=\"' + st.id + '\" data-iid=\"' + inp.id + '\"' + (inp.optional ? ' checked' : '') + '></td>' +\n"
     "            '<td><input type=\"text\" class=\"mono sop-key\" list=\"sopKeyList\" data-inped=\"key\" data-sid=\"' + st.id + '\" data-iid=\"' + inp.id + '\" value=\"' + esc(inp.key || '') + '\" placeholder=\"例：instance_type\" title=\"パラメータシートのキーと同じにすると、作業の最終値チェックで突き合わせます\"></td>' +"),
    ("res(cst).values[iid] = val;", "res(cst).values[iid] = val; stampValue(res(cst), iid);"),
    ("r.values[t.getAttribute('data-inp')] = t.type === 'checkbox' ? t.checked : t.value;",
     "r.values[t.getAttribute('data-inp')] = t.type === 'checkbox' ? t.checked : t.value; stampValue(r, t.getAttribute('data-inp'));"),
    ("  function countDone(s) {", "  function stampValue(r, id) { (r.valuesAt = r.valuesAt || {})[id] = nowIso(); }   // 値の入力日時（最終値チェック用）\n  function countDone(s) {"),
    # ---- 完了ページ：確認結果報告書の作成ボタン・確認ダイアログ（web/js/app.js の SopHooks.afterDone）----
    ("    }).join('') + '</table></div>';\n    app.innerHTML = h;\n  }",
     "    }).join('') + '</table></div>';\n    app.innerHTML = h;\n    if (window.SopHooks && SopHooks.afterDone) SopHooks.afterDone(app, S);\n  }"),
]

# export.js へのパッチ（証跡画像の埋め込み用。フックが無ければ v1 と同じ出力）
EXPORT_PATCHES = [
    ("      body.push(Ox.table(W, rows, { header: true }));",
     "      if (typeof ExportHooks !== 'undefined' && ExportHooks && ExportHooks.stepRows) rows = rows.slice(0, 1).concat([].concat.apply([], R.rows.map(function (r, k) { return [rows[k + 1]].concat(ExportHooks.stepRows(r, W, L)); })));\n      body.push(Ox.table(W, rows, { header: true }));"),
    ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
     '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
     ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
     ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'),
    ("    Object.keys(defaults).forEach(function (k) { if (!parts[k]) zip.file(k, defaults[k]); });",
     "    if (meta.extend) meta.extend(defaults);\n    Object.keys(defaults).forEach(function (k) { if (!parts[k]) zip.file(k, defaults[k]); });"),
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
    exp = read(os.path.join(src, "export.js"))
    for old, new in EXPORT_PATCHES:
        if exp.count(old) != 1:
            raise SystemExit("export.js patch target not found (v1 changed?):\n" + old)
        exp = exp.replace(old, new)
    exp = v1_ja.drop_zh_labels(apply_table(exp, v1_ja.EXPORT, "export.js"))
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
