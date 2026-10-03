@echo off
rem 构建作业助手 v2 / 構築作業アシスタント v2  — Windows 启动脚本
rem 不需要 pip install：第三方库在 vendor\ 中。只监听 127.0.0.1。
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 app.py %*
) else (
  python app.py %*
)
if errorlevel 1 (
  echo.
  echo 終了しました（エラーがあれば上のメッセージを確認）/ 已结束（如有错误请查看上方信息）。Python 3.8+ が必要 / 需要 Python 3.8+
  pause
)
