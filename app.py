#!/usr/bin/env python3
"""構築作業アシスタント v2 — 起動スクリプト。

    python app.py [--port 8765] [--data-dir ./data] [--no-browser]

127.0.0.1 のみで待ち受け、外部ネットワークには一切アクセスしない。サードパーティライブラリは ./vendor から読み込むため pip install は不要。
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))   # リポジトリ同梱の openpyxl / et_xmlfile を優先
sys.path.insert(0, HERE)

if sys.version_info < (3, 8):
    sys.stderr.write("Python 3.8 以上が必要です / Python 3.8 or later is required.\n")
    sys.exit(1)

for _s in (sys.stdout, sys.stderr):   # Windows コンソール(cp932)で出力エラーにならないように
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(description="構築作業アシスタント v2（オフライン・ローカル専用）")
    ap.add_argument("--port", type=int, default=8765, help="ポート番号（0 = 空いているポートを自動選択）")
    ap.add_argument("--data-dir", default=os.path.join(HERE, "data"), help="データ保存フォルダ")
    ap.add_argument("--no-browser", action="store_true", help="ブラウザを自動で開かない")
    a = ap.parse_args(argv)
    from ba.server import App
    app = App(a.data_dir, port=a.port)
    url = app.url
    print("構築作業アシスタント v2 を起動しました: %s" % url, flush=True)
    print("データフォルダ: %s" % os.path.abspath(a.data_dir), flush=True)
    print("終了するには画面の「終了」ボタンか、この窓で Ctrl+C を押してください。", flush=True)
    if not a.no_browser:
        import webbrowser
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        print("停止しました。")


if __name__ == "__main__":
    main()
