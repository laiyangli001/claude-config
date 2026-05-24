@echo off
chcp 65001 >nul 2>&1
title Find Proxy Port
echo.
echo Scanning common proxy ports...
echo.

for %%p in (7890 7891 7892 10809 1080 1081 8888 8080) do (
  curl -s --connect-timeout 1 --proxy http://127.0.0.1:%%p -I https://github.com >nul 2>&1
  if errorlevel 0 if not errorlevel 1 (
    echo [OK] Port %%p is available
    git config --global http.proxy http://127.0.0.1:%%p
    git config --global https.proxy http://127.0.0.1:%%p
    echo Proxy configured in git global settings.
    echo.
    pause
    exit /b 0
  ) else (
    echo [NO] Port %%p
  )
)

echo.
echo No proxy port found. Make sure your proxy is running.
pause
