# 代码审查规则：必须附带运行环境信息

## 规则

所有代码审查任务（包括自行审查和委托 MCP 审查）**必须**在 prompt 中附带完整的运行环境信息。

## 环境声明模板

审查 prompt 开头必须包含以下标准化声明：

```
## 运行环境
- Python: 3.12.13
- OS: Windows 11 Pro for Workstations (10.0.26200)
- 框架: Flet 0.85.1
- asyncio: Python 3.12 原生（注意 Task GC 行为）
- OpenXR: pyopenxr
- 图形: ModernGL + OpenGL (GLFW)
- 窗口系统: Win32 API
- 架构: x64
- 子进程管理: subprocess.Popen（Windows，不可用 asyncio.create_subprocess_exec）
```

## 为什么需要

以下 bug 全部来自运行时环境的独有特性，不知道环境信息 = 不可能在审查中发现：

### 案例 1：Python 3.12 Task GC
- **问题**：`asyncio.create_task()` 返回值无引用 → Task 被 GC，协程永不执行
- **环境**：Python 3.12+ 行为变更（旧版本不会 GC 未引用的 Task）
- **漏审原因**：审查时没被告知 Python 版本

### 案例 2：Windows asyncio subprocess
- **问题**：`asyncio.create_subprocess_exec` + `await proc.wait()` 在进程退出后永不返回
- **环境**：Windows 上 asyncio subprocess transport 回调不触发
- **漏审原因**：审查默认假设 Linux 行为

### 案例 3：Flet 事件循环
- **问题**：同步 Flet 回调中直接 `asyncio.create_task()` → 投递到错误事件循环
- **环境**：Flet 使用独立事件循环，不能与主应用循环混用
- **漏审原因**：审查时没意识到多循环架构

### 案例 4：Windows Console Quick Edit Mode
- **问题**：用户点击控制台窗口 → 进程挂起
- **环境**：Windows 控制台默认行为
- **漏审原因**：在 macOS/Linux 上根本不存在此问题

### 案例 5：Windows 子进程 stdio 句柄继承
- **问题**：`subprocess.Popen()` 不指定 stdio → 继承父进程句柄，管道阻塞
- **环境**：Windows 句柄继承行为不同于 Unix
- **漏审原因**：审查默认 Unix 语义

## 执行方式

1. **自行审查**：读代码前先明确写出运行环境
2. **委托 MCP**：在 prompt 开头嵌入环境声明，让外部 AI 也知晓环境约束
3. **通过 /mcp-baipiao 审查**：`mcp-baipiao` skill 的 `code_review` 模板已包含 `{{environment}}` 占位符，会自动填入本模板内容
4. **新建项目/迁移环境时**：更新本文件中的环境声明模板，确保反映实际运行环境
