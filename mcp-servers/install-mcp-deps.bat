@echo off
setlocal enabledelayedexpansion

echo [1/2] Installing Chromium browser for Playwright...
cd /d "%~dp0"
npx playwright install chromium
echo Chromium installed.

echo.
echo [2/2] Registering MCP server config...
node install-mcp-config.mjs
if %errorlevel% neq 0 (
    echo [ERROR] Failed to write MCP config. Please manually add MCP servers.
)

echo.
echo Done! Please Reload Window (Ctrl+Shift+P -^> Reload Window) to activate.
pause
