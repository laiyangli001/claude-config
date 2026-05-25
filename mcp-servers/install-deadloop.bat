@echo off
echo [1/1] Installing deadloop VS Code extension...
cd /d "%~dp0deadloop-monitor"
node install-extension.mjs
if %errorlevel% neq 0 (
    echo [ERROR] Extension installation failed.
    pause
    exit /b 1
)
echo Done. Please reload VS Code window (Ctrl+Shift+P -^> Reload Window).
pause
