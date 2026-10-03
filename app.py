#!/usr/bin/env python3
"""构建作业助手 v2 / 構築作業アシスタント v2 — 启动入口。

    python app.py [--port 8765] [--data-dir ./data] [--no-browser]

只监听 127.0.0.1；不访问任何外部网络。第三方库从 ./vendor 加载，无需 pip install。
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))   # 优先使用随仓库附带的 openpyxl / et_xmlfile
sys.path.insert(0, HERE)

if sys.version_info < (3, 8):
    sys.stderr.write("Python 3.8 or later is required.\n")
    sys.exit(1)

for _s in (sys.stdout, sys.stderr):   # Windows 控制台(cp932)下避免中文/日文输出报错
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build Assistant v2 (offline, localhost only)")
    ap.add_argument("--port", type=int, default=8765, help="port (0 = random free port)")
    ap.add_argument("--data-dir", default=os.path.join(HERE, "data"))
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args(argv)
    from ba.server import App
    app = App(a.data_dir, port=a.port)
    url = app.url
    print("Build Assistant v2 running at: %s" % url, flush=True)
    print("Data folder: %s" % os.path.abspath(a.data_dir), flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if not a.no_browser:
        import webbrowser
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        print("stopped.")


if __name__ == "__main__":
    main()
