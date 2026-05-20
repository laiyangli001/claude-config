# 死循环监控系统（Dead Loop Monitor）v3

## Context

AI 输出可能陷入死循环（重复代码、逻辑反转、信息增量趋零）。需要外部监控脚本检测 → 打断 → 通知 → 触发下一轮处理。

## v3 架构

```
mcp-servers/deadloop-monitor/
├── monitor.mjs          ← 主入口（文件监控 + 检测 + 打断 + 注入）
├── detectors.mjs        ← 三个信号检测器
├── summarizer.mjs       ← 摘要生成
├── helpers.mjs          ← MCP Client + .jsonl 清洗 + 消息注入
├── config.mjs           ← 配置参数
├── logger.mjs           ← 日志
├── package.json
└── workspace-watcher/   ← VS Code 扩展（自动启停 + 状态栏控制）
    ├── package.json
    └── extension.js
```

## 完整流程

```
我输出死循环内容...
监控检测到循环（任意 2 个信号）
  → VS Code 右下角通知 + 状态栏变红
  → vsc-mcp execute_command 发 Ctrl+C 打断
  → 确认已停止
  → 向 .jsonl 注入用户消息（含自述摘要指令）
  → 10 秒冷却

我被打断 + 读到注入消息 → 开始新回答
  → 直接读当前 .jsonl 上下文（无需额外文件）
  → 自述总结 → 调用 ask_chatgpt_mirror → 问你
```

## 待实现内容

| 任务 | 文件 | 说明 |
|------|------|------|
| 集成 vsc-mcp | `monitor.mjs` + `config.mjs` | 添加 vsc-mcp HTTP 连接，用于发 Ctrl+C |
| Ctrl+C 中断 | `monitor.mjs` | `execute_command` 发中断信号 |
| 停止确认 | `monitor.mjs` | 轮询 .jsonl stop_reason 字段，确认停止 |
| 终端消息注入 | `monitor.mjs` | `execute_command` 向终端发送 `\n` + 指令文本 |
| 清理 helpMcp | `monitor.mjs` + `config.mjs` | 移除 ask_chatgpt_mirror 调用 |
| VS Code 状态栏 | `workspace-watcher/extension.js` | 状态栏图标 + 点击菜单 |
| VS Code 通知 | `workspace-watcher/extension.js` | 检测到循环时右下角 toast |
| 日志轮转 | `logger.mjs` | 超 5MB 自动归档，保留 3 个 |

### vsc-mcp 集成方式

monitor.mjs 通过 MCP Client 连接 vsc-mcp（HTTP SSE 端点 localhost:60100），封装两个函数：
- `sendCtrlC()` → `execute_command({ command: "kill -INT <pid>" })`，PID 由 workspace-watcher 在 spawn 时记录到临时文件 `.deadloop-pid`
- `injectToTerminal(text + "\n")` → 优先用 `send_text_to_terminal`（如可用），回退到 `execute_command` 模拟输入。文本末尾加 `\n` 提交

### 已验证结论

| 验证项 | 结果 | 结论 |
|--------|------|------|
| vsc-mcp 有无 `send_text_to_terminal` | ❌ 没有 | 只用 `execute_command` |
| .jsonl 注入 Claude Code 是否响应 | ❌ 不读取 | 废弃此回退 |
| `stop_reason` 实时性 | 完整消息末才有 | 流式输出中不出现 |
| 终端 PID 获取 | ✅ workspace-watcher spawn 时记录 | 写入 `.deadloop-pid` |
| 注入末尾加 `\n` | ✅ 需要 | `execute_command` 输出末尾带 `\n`

### 消息注入（终端注入，唯一可用方式）

已验证结果：
- vsc-mcp **无 `send_text_to_terminal`** 工具，只能用 `execute_command`
- `.jsonl` 注入**无效**（Claude Code 不读新增行），已废弃

因此唯一的注入方式是：通过 vsc-mcp 的 `execute_command` 向 Claude Code 终端发送文本，末尾加 `\n` 提交输入。

## 已验证结论汇总

| 验证项 | 结果 | 结论 |
|--------|------|------|
| vsc-mcp 有无 `send_text_to_terminal` | ❌ 没有 | 只用 `execute_command` |
| .jsonl 注入 Claude Code 是否响应 | ❌ 不读取 | 废弃此回退 |
| `stop_reason` 实时性 | 完整消息末才有 | 流式输出中不出现 |
| PowerShll SendKeys 测试 | ✅ ESC 成功 | 键盘模拟可行 |
| vsc-mcp --stdio 模式 | 🔄 待验证 | 替代不稳定的 SSE |

## ChatGPT 建议（待验证）

1. **`npx vsc-mcp --stdio`** → 替代 HTTP SSE，解决连接不稳定
2. **`execute_command` 的 `workspaceFolder` 设空字符串** → 绕过路径依赖

## 注入方案敲定

最终采用 **PowerShell SendKeys** 方案（已验证通过）：
1. 监控脚本生成注入文本
2. 写入临时 `.ps1` 文件
3. `powershell -File xxx.ps1` 执行：`AppActivate("Visual Studio Code")` + `SendKeys(文本 + "~")`
4. 清理临时文件

### 与 workspace-watcher 通信协议

监控进程 ←→ workspace-watcher 通过 **stdin/stdout** 通信：
- 监控 `stdout` 输出 `DEADLOOP_DETECTED` → 扩展触发通知
- 监控 `stdin` 接收 JSON 指令：`{ "command": "pause" }` / `{ "command": "resume" }` / `{ "command": "stop" }`
- 收到指令后回复确认：`{ "status": "paused" }` 等，扩展据此更新状态栏
- 监控确认停止后输出 `DEADLOOP_STOPPED` 或通过 exit code 退出
- workspace-watcher 持有子进程的 stdin 引用
- **stdin 非阻塞处理**：monitor.mjs 使用 `readline` 异步接口处理 stdin，不阻塞主轮询循环
- **多实例状态**：状态栏显示当前活动工作区的监控状态，切换工作区时自动更新

### 监控控制面板（VS Code 状态栏）

在 workspace-watcher 扩展中添加状态栏项：
- **正常**：`$(pulse) 监控中`
- **暂停**：`$(debug-pause) 已暂停`
- **冷却中**：`$(sync~spin) 冷却中`
- **告警**：`$(error) 死循环!`
- **中断失败**：`$(warning) 需手动干预`
- **点击弹出**：暂停 / 恢复 / 停止

### VS Code 右下角通知

检测到死循环后，在 VS Code 右下角弹原生通知（toast）：
- workspace-watcher 监听监控进程 stdout 的 `DEADLOOP_DETECTED` 标记
- 收到后调用 `vscode.window.showWarningMessage("检测到死循环！", "查看", "忽略")`
- 用户点击"查看"后，聚焦到 Claude Code 对话框

比 Windows `msg` 弹窗更不打扰，且在 VS Code 界面内直接可见。

### 日志轮转

- 日志超 5MB 自动轮转
- 格式：`deadloop-monitor.1.jsonl` ... 最多 3 个归档
- 启动时检查并执行

### summarizer.mjs 职责更新

不再调用 MCP 服务，改为**生成注入消息文本**：
- 输入：DialogWindow 中的最近 5 轮对话 + loopSample
- 输出：自然语言指令文本（不用 `[SYSTEM]` 前缀）
- 该文本由 monitor.mjs 注入到终端（或 .jsonl）

### 停止确认逻辑

.jsonl 中 assistant 消息的 `stop_reason` 字段含义：
- `"end_turn"` → AI 自然完成回复，已停止
- `"tool_use"` → AI 发了工具调用，等待工具结果
- `undefined/null` → 被 Ctrl+C 中断，或流式输出未正常结束

另外，被中断时 .jsonl 最后可能有一条包含 `"interrupted": true` 的元数据行。

```
发 Ctrl+C
  → 每秒轮询 .jsonl 最后 3 行（最多等 60 秒）
  → 辅助检测：通过 vsc-mcp get_terminal_output 检查终端是否出现提示符
  → 解析最后一条 assistant 消息的 message.stop_reason：
     ① stop_reason === "end_turn" → 自然结束 ✅
     ② stop_reason === undefined/null（且无新行写入）→ 被中断 ✅
     ③ 出现 "interrupted": true 的行 → 被中断 ✅
     ④ 终端输出出现提示符（$ / >）→ 已停止 ✅
     ⑤ stop_reason === "tool_use" → 工具调用中，继续等
  → 确认停止后注入消息
```

### 中断失败处理

若 60 秒内未确认停止（.jsonl 仍在增长且 stop_reason 始终为 "tool_use"）：
- 状态栏切换为 `$(warning) 需手动干预`
- VS Code 通知 "自动中断失败，请手动 Ctrl+C"
- 跳过本轮，进入冷却期

### 注入消息模板
```

## 文件清单

| 文件 | 说明 |
|------|------|
| `mcp-servers/deadloop-monitor/package.json` | 依赖 |
| `mcp-servers/deadloop-monitor/monitor.mjs` | 主入口 |
| `mcp-servers/deadloop-monitor/detectors.mjs` | 三个信号检测器 |
| `mcp-servers/deadloop-monitor/summarizer.mjs` | 摘要生成 |
| `mcp-servers/deadloop-monitor/helpers.mjs` | MCP Client + 清洗 + jsonl 注入 |
| `mcp-servers/deadloop-monitor/config.mjs` | 配置 |
| `mcp-servers/deadloop-monitor/logger.mjs` | 日志 |
