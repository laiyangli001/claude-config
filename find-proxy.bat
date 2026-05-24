@echo off
setlocal enabledelayedexpansion
chcp 936 >nul
title 扫描代理端口
echo.
echo 正在扫描常见代理端口...
echo.

for %%p in (7890 7891 7892 10809 1080 1081 8888 8080) do (
  curl -s --connect-timeout 1 --proxy http://127.0.0.1:%%p -I https://github.com >nul 2>&1
  if !errorlevel! equ 0 (
    echo [可用] 端口 %%p
    git config --global http.proxy http://127.0.0.1:%%p
    git config --global https.proxy http://127.0.0.1:%%p
    echo 已配置到 git 全局设置。
    echo.
    pause
    exit /b 0
  ) else (
    echo [不可用] 端口 %%p
  )
)

echo.
echo 未找到代理端口，请确认代理软件已开启。
pause
