@echo off
echo Installing MCP dependencies...
cd /d "%~dp0chatgpt-mcp" && npm install && npx playwright install chromium
cd /d "%~dp0deepseek-mcp" && npm install && npx playwright install chromium
echo All MCP dependencies installed.
pause
