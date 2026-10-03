@echo off
rem 構築作業アシスタント v2 - Windows 用起動スクリプト
rem pip install は不要です（ライブラリは vendor\ に同梱）。127.0.0.1 のみで待ち受けます。
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
  echo 終了しました。エラーが表示されている場合は上のメッセージを確認してください（Python 3.8 以上が必要です）。
  pause
)
