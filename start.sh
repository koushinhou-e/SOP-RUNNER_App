#!/bin/sh
# 構築作業アシスタント v2 - macOS / Linux 用起動スクリプト（pip install 不要）
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 app.py "$@"; else exec python app.py "$@"; fi
