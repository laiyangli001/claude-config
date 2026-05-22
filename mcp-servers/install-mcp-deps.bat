@echo off
setlocal enabledelayedexpansion

echo Installing MCP dependencies...
cd /d "%~dp0" && npm install playwright @modelcontextprotocol/sdk typescript @types/node
npx playwright install chromium
echo All MCP dependencies installed.

echo.
echo Configuring MCP servers in %USERPROFILE%\.claude.json...

cd /d "%~dp0" && node install-mcp-config.mjs
if %errorlevel% neq 0 (
    echo [ERROR] Failed to write MCP config. Please manually add MCP servers to %USERPROFILE%\.claude.json
    echo   Reference: claude.json.example in the repository
)

echo.
echo Done! Please Reload Window (Ctrl+Shift+P -^> Reload Window) to activate.
pause
