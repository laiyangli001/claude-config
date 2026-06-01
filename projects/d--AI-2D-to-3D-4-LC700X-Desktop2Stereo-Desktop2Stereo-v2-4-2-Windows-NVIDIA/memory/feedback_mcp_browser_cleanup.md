---
name: mcp-browser-cleanup
description: VS Code Reload/切换工作区后 MCP 浏览器进程残留导致 profile 锁冲突的解决方案
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 036aec35-765b-4b4a-9013-9e58905723e9
---

# MCP 浏览器进程残留清理

## 问题

VS Code Reload Window 或切换工作区时，MCP Node.js 进程收到 SIGTERM 被强制终止，`cleanup()` 中的 `closeBrowser()` 来不及执行。Chrome 进程变成孤儿进程，占着 `user-data-dir` profile 的锁文件（`SingletonLock`、`SingletonCookie` 等）。下次 MCP 服务启动时 `launchPersistentContext` 失败：`"Target page, context or browser has been closed"`。

## 解决方案

### 方案 1: 各 MCP server main() 启动时先暴力清扫（推荐）

在每个 MCP server 的 `main()` 中，`launchBrowser()` 之前，用 WMIC 按 profile 目录杀掉残留 Chrome：

```
taskkill /f /fi "IMAGENAME eq chrome.exe" 2>nul
```

过于暴力，会杀掉所有 Chrome 浏览器。改用 `wmic` 按命令行过滤 profile 路径。

### 方案 2: shared/browser.mjs 的 killOrphanChrome 已实现

`launchBrowser()` 内已调用 `killOrphanChrome(profileDir)`，通过 WMIC 匹配命令行中的 profile 目录杀掉对应进程。若此方案失效，常见原因：

- WMIC 在 Windows 某些版本上执行慢/失败
- Chrome 进程退出但锁文件未释放（需手动删锁文件）

### 手动恢复步骤（当自动清理失败时）

```bash
# 1. 找占用 profile 的进程
wmic process where "name='chrome.exe' and commandline like '%mcp-chatgpt-mirror%'" get processid

# 2. 强行杀掉
taskkill /f /pid <PID>

# 3. 删锁文件
rm -f ~/.claude/mcp-servers/mcp-xxx/.chatgpt-mirror-profile/SingletonLock
rm -f ~/.claude/mcp-servers/mcp-xxx/.chatgpt-mirror-profile/SingletonCookie

# 4. Reload Window
```
