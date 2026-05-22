---
name: feedback-mcp-reload
description: 修改 MCP 服务源码后必须先提醒用户 reload window，不得连续盲目测试
metadata:
  type: feedback
---

修改 MCP 服务的源码并编译后，必须主动提醒用户 Reload Window，不能直接调用 MCP 工具测试（因为 MCP 进程在 VS Code 启动时加载，不会自动热更新）。

**Why:** 连续多次测试 fail 后才意识到没重启进程，浪费了时间和耐心。

**How to apply:** 每次修改 MCP 服务的源码（src/ 或 dist/）后，编译完成时立即添加一句提醒，格式固定为：`"已编译完成，需要 Reload Window（Ctrl+Shift+P → Developer: Reload Window）让新代码生效"。`
