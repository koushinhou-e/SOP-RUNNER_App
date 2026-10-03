#!/bin/sh
# 构建作业助手 v2 — macOS / Linux 启动脚本（不需要 pip install）
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 app.py "$@"; else exec python app.py "$@"; fi
