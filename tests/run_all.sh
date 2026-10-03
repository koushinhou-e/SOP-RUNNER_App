#!/bin/sh
# 开发者用：全部测试。  PYTHON=python3.8 sh tests/run_all.sh
set -e
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
echo "== unit tests ($PY -I, vendored deps only) =="
$PY -I -m unittest discover -s tests -v
echo "== JS rules/compare parity =="
node tests/js/vectors_test.js
echo "== E2E (headless Chromium, network blocked) =="
[ -d tests/e2e/node_modules ] || (cd tests/e2e && npm install --no-audit --no-fund && npx playwright install chromium)
PYTHON=$PY node tests/e2e/e2e.js
$PY -I tests/e2e/verify_outputs.py
