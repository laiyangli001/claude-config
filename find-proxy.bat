@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title 扫描代理端口
echo 正在扫描常见代理端口...
echo.

for %%p in (7890 7891 7892 10809 1080 1081 8888 8080) do (
  curl -s --connect-timeout 1 --proxy http://127.0.0.1:%%p -o nul -s -w "%%%%{http_code}" https://github.com 2>nul | findstr "200" >nul
  if !errorlevel! equ 0 (
    echo [可用] 端口 %%p
    git config --global http.proxy http://127.0.0.1:%%p
    git config --global https.proxy http://127.0.0.1:%%p
    echo 已自动配置 git 代理。
    pause
    exit /b 0
  ) else (
    echo [不可用] 端口 %%p
  )
)

echo.
echo 未找到代理端口，请确认代理软件已开启。
pause
