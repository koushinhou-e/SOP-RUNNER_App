"""把 v1 sop-runner 的源码同步进 v2（web/sop/），并做最小改动以嵌入为“手顺执行”标签页。

    python tools/sync_from_v1.py /path/to/sop-runner

parser.js / export.js 原样复制；app.js 只做以下补丁（每条都断言能匹配，v1 变化时会报错提醒）:
  1. 挂载点 #app/#hdr → #sop-app/#sop-hdr
  2. localStorage 读写 → SopStore（服务器端 JSON 保存，localStorage 作为备份）
  3. 启动时先从服务器加载会话再渲染
  4. 全局拖放只在“手顺执行”标签可见时生效
  5. 首页渲染后调用 SopHooks.afterHome（显示“从模板库打开”）
  6. 暴露 SopApp.importFile 供模板库调用
"""
import os
import shutil
import sys

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


def main(v1):
    src = os.path.join(v1, "src")
    os.makedirs(DST, exist_ok=True)
    shutil.copy(os.path.join(src, "parser.js"), os.path.join(DST, "parser.js"))
    shutil.copy(os.path.join(src, "export.js"), os.path.join(DST, "export.js"))
    shutil.copy(os.path.join(src, "app.css"), os.path.join(DST, "sop.css"))
    with open(os.path.join(src, "app.js"), encoding="utf-8") as f:
        code = f.read()
    for old, new in PATCHES:
        if old not in code:
            raise SystemExit("patch target not found (v1 changed?):\n" + old)
        code = code.replace(old, new, 1)
    code = "/* Synced from v1 sop-runner/src/app.js by tools/sync_from_v1.py — do not edit by hand. */\n" + code
    with open(os.path.join(DST, "sop-app.js"), "w", encoding="utf-8") as f:
        f.write(code)
    print("synced to", os.path.abspath(DST))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "sop-runner"))
