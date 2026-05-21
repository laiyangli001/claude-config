@echo off
echo Installing deadloop monitor dependencies...
cd /d "%~dp0deadloop-monitor"
npm install
echo Extension installation...
node install-extension.mjs
echo Done. Please reload VS Code window (Ctrl+Shift+P -> Reload Window).
pause
