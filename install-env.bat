@echo off
chcp 65001 >nul
title 安装开发环境
echo ============================================
echo   Git + Node.js + TypeScript 一键安装
echo ============================================
echo.

REM --- Git ---
where git >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('git --version') do echo [已安装] %%i
) else (
    echo [安装] Git for Windows...
    winget install --id Git.Git -e --source winget --accept-package-agreements
    if %errorlevel% neq 0 (
        echo [!] winget 安装失败，尝试直接下载...
        powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/latest/download/Git-2.48.1-64-bit.exe' -OutFile '%TEMP%\git-installer.exe'; Start-Process '%TEMP%\git-installer.exe' -ArgumentList '/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS' -Wait}"
    )
)
echo.

REM --- Node.js ---
where node >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do echo [已安装] Node.js %%i
) else (
    echo [安装] Node.js LTS...
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements
    if %errorlevel% neq 0 (
        echo [!] winget 安装失败，尝试直接下载...
        powershell -Command "& {Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'; Start-Process '%TEMP%\node-installer.msi' -ArgumentList '/quiet /norestart' -Wait}"
    )
)
echo.

REM --- npm 路径刷新 ---
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js 未正确安装，跳过 TypeScript。
    pause
    exit /b 1
)

REM --- TypeScript ---
where tsc >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('tsc --version') do echo [已安装] %%i
) else (
    echo [安装] TypeScript（全局 npm install -g typescript）...
    call npm install -g typescript
)
echo.

echo ============================================
echo  安装完成！
echo.
echo  验证命令：
echo    git --version
echo    node --version
echo    npm --version
echo    tsc --version
echo ============================================
pause
