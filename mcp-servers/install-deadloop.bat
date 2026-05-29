@echo off
cd /d "%~dp0deadloop-monitor"
node install-deadloop.mjs
if %errorlevel% neq 0 (
    echo.
    pause
    exit /b 1
)
pause
