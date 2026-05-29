@echo off
chcp 65001 >nul
echo [1/2] Installing deadloop VS Code extension...
cd /d "%~dp0deadloop-monitor"
node install-extension.mjs
if %errorlevel% neq 0 (
    echo [ERROR] Extension installation failed.
    pause
    exit /b 1
)
echo.
echo [2/2] 手动配置 — 将以下 Stop Hook 添加到 settings.json 的 hooks 字段：
echo.
echo   {
echo     "hooks": {
echo       "Stop": [{
echo         "hooks": [{
echo           "type": "command",
echo           "command": "node",
echo           "args": ["%USERPROFILE:\=/%/.claude/mcp-servers/deadloop-monitor/stop-hook.mjs"],
echo           "timeout": 15
echo         }]
echo       }]
echo     }
echo   }
echo.
echo Done! Reload VS Code (Ctrl+Shift+P -^> Reload Window).
pause
