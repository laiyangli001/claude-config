# 死循环监控系统（Dead Loop Monitor）v3

## Context

Claude Code 在生成代码时可能陷入"死循环"——反复输出相似内容、自我否定、无新信息增量。此系统通过外部监控进程 + VS Code 扩展 + AutoIt 键盘模拟，自动检测、中断、注入上下文提示，让 AI 跳出循环。

本次更新从 vsc-mcp 方案全面迁移到 AutoIt 编译 exe 方案（更可靠），新增粘贴模式、检查报告、MCP 优先级链等特性。

## 架构总览

```
[VS Code Extension]          [monitor.mjs]               [deadloop_control.exe]
     |                            |                             |
  activate()                  main()
     |-- spawn(monitor.mjs) ->|
     |                        autoDiscoverSessionFile()
     |                        state = MONITORING
     |                            |
     |                        while(true):
     |                          sleep(2000)
     |                          write heartbeat
     | <--- status:monitoring --|
     |                          processAndCheck():
     |                            read .jsonl new lines
     |                            feed 3 detectors
     |                            if >= 2 signals:
     |                              detected = true
     | <--- DEADLOOP_DETECTED  --|
     |   writeReport()
     |   updateDisplay(alert)
     |                        waitForStop():
     |                          sendEscViaAutoIt():
     |                            |---> esc (hold ESC 5s)
     |                          sleep(5000)
     |                          checkFileForStop():
     |                            scan last 64KB of .jsonl
     |                          (retry up to 3x)
     |                            |
     |                        if stopped:
     |                          injectSummary():
     |                            injectViaAutoIt():
     |                            |---> inject_file (paste + Enter + Ctrl+Enter)
     |                        else:
     |                          pasteViaAutoIt():
     |                            |---> paste_file (paste only, no send)
     |                          NEEDS_MANUAL
     |                        state = COOLDOWN (10s)
     |                        reset detectors
     |                            |
     | <--- status:cooling ------|
     |                        (10s 后回到 MONITORING)
```

## 项目结构

```
mcp-servers/deadloop-monitor/
├── monitor.mjs               # 主监控脚本（入口）
├── detectors.mjs             # 3 个信号检测器
├── helpers.mjs               # 工具函数（文件读取、AutoIt 调用、停止检测）
├── summarizer.mjs            # 摘要构建（注入消息模板）
├── config.mjs                # 配置项
├── logger.mjs                # 日志
├── deadloop_control.au3      # AutoIt 源码
├── deadloop_control.exe      # 编译后的 AutoIt exe
├── package.json
└── workspace-watcher/
    ├── extension.js          # VS Code 扩展
    └── package.json
```

## 完整流程

### 1. 启动（VS Code 扩展）
- 扩展激活 → 创建状态栏"循环守护"
- 生成 `.deadloop-activated` 标记文件
- 获取当前工作区路径
- Spawn `monitor.mjs` 子进程
- 写入 PID 到 `.deadloop-pid`
- 建立 heartbeat 检测（每 3 秒检查 mtime，超 10 秒判定死亡）

### 2. 监控循环（monitor.mjs）
- 自动发现当前会话的 `.jsonl` 文件
- 每 2 秒增量读取新行
- 写入 heartbeat（每轮）
- 状态转移：IDLE → MONITORING → HELPING → COOLDOWN → MONITORING
- 支持 PAUSED 状态（通过 stdin 命令切换）

### 3. 死循环检测（3 个信号，≥2 触发）

| 检测器 | 原理 | 阈值 |
|--------|------|------|
| **RepeatDetector** | 代码行标准化后计数，≥3 次重复计为 1 hit | maxHits: 1 |
| **ReversalDetector** | 200 字窗口内统计反转词（但是/不过/actually/wait 等） | minCount: 5 |
| **InfoStallDetector** | 连续 N 次 feed 无新代码行/断言 | maxStallCount: 2 |

任何单检测器触发只输出警告，**同一 chunk 内 ≥2 个信号才判定为死循环**。

### 4. 中断（HELPING 阶段）
- **waitForStop()**: 最多 3 轮
  1. 先 `checkFileForStop()` 检查是否已自然结束
  2. `sendEscViaAutoIt()` → `deadloop_control.exe esc` 长按 ESC 5 秒
  3. 等 5 秒，再 `checkFileForStop()`
  4. 仍需继续则重试（最多 3 次）

### 5. 停止确认
- **checkFileForStop()**: 全量扫描 .jsonl 末尾 64KB
- 倒序解析每行 JSON，检查:
  - `stop_reason: "end_turn"` → stopped ✅
  - `interrupted: true` → interrupted ✅
  - `stop_reason: "tool_use"` → running ❌（继续输出）
- 两次确认之间等待 5 秒确保文件已写入

### 6. 注入/粘贴
- **确认到停止**: `injectViaAutoIt()` → 写临时文件 → `deadloop_control.exe inject_file <path>` → ESC 聚焦 → Ctrl+V → Enter → Ctrl+Enter（自动提交）
- **未确认停止**: `pasteViaAutoIt()` → `deadloop_control.exe paste_file <path>` → ESC 聚焦 → Ctrl+V（只粘贴，等人眼确认后手动按 Enter）

### 7. 注入消息内容
固定模板（4 点）要求 Claude Code:
1. 用第三人称总结用户的原始需求
2. 已经尝试过的方案
3. 循环的表现
4. 核心问题是什么

### 8. 冷却期
- COOLDOWN 状态持续 10 秒（config.cooldownMs）
- 跳过期间的所有 .jsonl 内容
- 恢复 MONITORING

### 9. 收到注入消息后的 AI 流程（Claude Code）
1. 按注入消息的 4 点要求生成总结摘要
2. 优先级链调用：`ask_chatgpt_mirror` → `ask_chatgpt` → `ask_deepseek`
3. 收到回答后，如果对方能提供参考代码，要求完整代码
4. 按照建议修改 bug

## AutoIt 控制（deadloop_control.exe）

编译自 `deadloop_control.au3`，通过 `cmd //c "@Aut2Exe/Aut2exe_x64.exe /in <au3路径> /out <exe路径> /console"` 无窗口静默编译。

**命令列表：**

| 命令 | 行为 |
|------|------|
| `esc` | 长按 ESC 5 秒（每 100ms 一次 `ControlSend`） |
| `inject_file <path>` | `FileRead(path)` → `ClipPut` → ESC → Ctrl+V → Enter → Ctrl+Enter |
| `paste_file <path>` | `FileRead(path)` → `ClipPut` → ESC → Ctrl+V（不发送） |
| `inject <text>` | 同上但直接传文本（**已废弃**，多行文本截断） |
| `paste <text>` | 同上但只粘贴（**已废弃**，多行文本截断） |

所有命令通过 `ControlSend` 发送按键（不要求窗口焦点），窗口匹配 `[REGEXPTITLE:.*Visual Studio Code.*]`（回退 `.*VS Code.*`）。

## VS Code 扩展功能

| 功能 | 说明 |
|------|------|
| 状态栏显示 | monitoring/paused/cooling/alert/intervention_needed 5 种状态，颜色变化 |
| 未读告警 | unreadAlert 标记 → 警告图标 + 黄色背景 |
| 通知 | `DEADLOOP_DETECTED` → toast 通知 + 写入 `.deadloop-report.md` |
| 报告文件 | 每次检测追加 Markdown 表格到 `<workspace>/.deadloop-report.md`，保留最近 5 条 |
| 自动中断失败 | 显示 `NEEDS_MANUAL` 错误提示，推荐手动 Ctrl+C |
| QuickPick 菜单 | 左键点击状态栏弹出：暂停/恢复/停止/查看报告/查看日志 |
| Heartbeat 监控 | 每 3 秒检查 heartbeat 文件 mtime，超 10 秒判定进程死亡 |
| 终端命令下发 | 通过 `sendToTerminal()` 向 Claude Code 终端发 ESC/文本（AutoIt 的后备方案） |
| 进程管理 | spawn 前先用 WMI 清理同工作区的旧进程，防止 VS Code reload 残留 |

## 键盘模拟后备方案

| 方案 | 优先级 | 说明 |
|------|--------|------|
| AutoIt exe | **首选** | 编译后的 exe，最可靠 |
| PowerShell SendKeys | 次选 | Win32 Window + SendKeys，依赖窗口焦点 |
| VS Code API | 回退 | monitor stdout 发 JSON action → extension `sendText()` 到终端 |

## 通信协议（monitor ↔ extension）

通过 stdin/stdout 通信：

- **monitor stdout → extension**: JSON 状态行 + 特殊标记
  - `{"status":"monitoring","tokenCount":123,"detectors":...}` → 更新状态栏
  - `{"action":"sendEsc"}` → 发 ESC 到终端（回退方案，已改用 AutoIt）
  - `{"action":"injectText","text":"..."}` → 发文本到终端（回退方案）
  - `DEADLOOP_DETECTED` → 触发通知 + 写报告
  - `NEEDS_MANUAL` → 显示错误提示
- **monitor stdin ← extension**: JSON 命令
  - `{"command":"pause"}` → 暂停监控
  - `{"command":"resume"}` → 恢复监控
  - `{"command":"stop"}` → 停止监控进程
  - `{"command":"status"}` → 返回当前状态

## 日志轮转
- 文件: `deadloop-monitor.jsonl`
- 超 5MB 自动轮转，保留最多 3 个归档

## 关键文件说明

| 文件 | 核心逻辑 |
|------|---------|
| `monitor.mjs` | `main()` 入口循环、`processAndCheck()` 增量读取+检测、`waitForStop()` ESC中断+停止确认、`injectSummary()` 构建注入消息 |
| `detectors.mjs` | `RepeatDetector.feed()` 代码行重复检测、`ReversalDetector.feed()` 反转词密度、`InfoStallDetector.feed()` 信息增量 |
| `helpers.mjs` | `checkFileForStop()` 64KB tail scan、`injectViaAutoIt()` temp file → inject_file、`pasteViaAutoIt()` temp file → paste_file、`sendEscViaAutoIt()` ESC 中断、`JsonlReader` 增量文件读取、`DialogWindow` 对话窗口 |
| `deadloop_control.au3` | esc/inject_file/paste_file 三个 AutoIt 命令窗口 |
| `summarizer.mjs` | `buildSummary()` 生成摘要报告文本 |
| `extension.js` | `StatusBarManager` 状态栏、`writeReport()` 报告生成、`startMonitor()` 子进程管理、`sendToTerminal()` 终端交互 |
| `config.mjs` | 所有可调参数 |
