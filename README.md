# Claude Code 全局配置

> 🎞️ 可交互演示版：[claude-config-slides.html](https://laiyangli001.github.io/claude-config/claude-config-slides.html)

> 软件安装配置教程请看 [VSCode+Claude+DeepSeek 使用教程.md](./VSCode+Claude+DeepSeek%20使用教程.md)

个人 Claude Code 工作环境配置。克隆到 `~/.claude` 即用。

---

## 📦 基础设置（快速上手）

本节适合新用户快速完成 Claude Code 环境搭建。
如需定制 MCP 工具、死循环监控或 AutoIt 脚本，请移步【高级设置】。

### 1. 克隆配置仓库

打开终端（CMD 或 PowerShell），执行：

```bash
git clone https://github.com/laiyangli001/claude-config.git ~/.claude
```

克隆完成后，进入目录确认文件完整：

```bash
cd ~/.claude
dir              # Windows 查看文件列表
```

如果看到 `CLAUDE.md`、`settings.json.example`、`mcp-servers/` 等文件和目录，说明克隆成功。

> 💡 也可以直接对我说"**帮我克隆配置仓库**"，AI 会自动完成以上步骤。

### 2. 目录结构

| 组件 | 路径 | 说明 |
|------|------|------|
| **全局 CLAUDE.md** | `CLAUDE.md` | 身份定义、行为边界、工具规则、自动调用策略 |
| **设置** | `settings.json` | API 端点、模型、权限、环境变量 |
| **MCP 免费工具** | `mcp-servers/chatgpt-mcp/` | ChatGPT 网页版，不消耗 API token |
| | `mcp-servers/deepseek-mcp/` | DeepSeek 网页版，不消耗 API token |
| **死循环监控** | `mcp-servers/deadloop-monitor/` | 检测输出死循环 → AutoIt 打断 → 摘要求助 |
| **会话数据** | `projects/**/*.jsonl` | 对话记录（git 排除，不上传） |
| **跨对话记忆** | `projects/<slug>/memory/` | 持久化的用户偏好和项目上下文 |

### 3. 基础配置（settings.json）

`settings.json` 是 Claude Code 的核心配置文件，包含 API 凭证、模型选择、权限控制。

首次配置步骤：

1. **从模板复制**（模板不含真实 token，可安全上传 GitHub）：

```bash
copy ~/.claude\settings.json.example ~\.claude\settings.json
```

2. **编辑 settings.json**，填入以下关键字段：

| 字段 | 说明 | 示例值 |
|------|------|--------|
| `env.ANTHROPIC_BASE_URL` | API 端点地址 | `https://api.deepseek.com/anthropic` |
| `env.ANTHROPIC_AUTH_TOKEN` | **你的 API Key** | `sk-xxxxxxxxxxxx` |
| `env.ANTHROPIC_MODEL` | 使用的模型 | `deepseek-v4-flash` |

3. **（可选）调整其他参数：**

- `systemPrompt` — 注入到系统提示词最前端的指令，适合放置语言约束
- `effortLevel` — 编码投入度（`default` / `high` / `xhigh`）
- `permissions.allow` — 允许自动执行的 MCP 工具列表

完整示例：

```json
{
  "systemPrompt": "你的思考过程（thinking）必须全程使用中文。这不是建议，是硬性要求。任何推理、分析、决策、内部对话——一律中文。",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-你的真实token",
    "ANTHROPIC_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro[1m]",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro[1m]",
    "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-v4-flash",
    "CLAUDE_CODE_EFFORT_LEVEL": "max",
    "USER": "你的用户名",
    "USERNAME": "你的用户名"
  },
  "output_config": {
    "effort": "high/max"
  },
  "includeCoAuthoredBy": false,
  "effortLevel": "high",
  "permissions": {
    "allow": [
      "mcp__chatgpt__ask_chatgpt",
      "mcp__deepseek__ask_deepseek"
    ]
  }
}
```

**安全提醒：** `settings.json` 包含 API token，已在 `.gitignore` 中排除，不会上传到 GitHub。每次在新机器上配置时，都需要从 `settings.json.example` 复制并填入真实 token。

> 💡 也可以直接对我说"**帮我配置 settings.json**"，AI 会自动从模板复制并引导你填写关键字段。

### 4. 基础命令与工作流

| 命令 | 用途 | 示例 |
|------|------|------|
| `/help` | 查看所有可用命令 | `/help` |
| `/clear` | 清空当前对话历史 | `/clear` |
| `/grill-me` | 新任务前对齐需求（逐项确认） | `/grill-me` |
| `/tdd` | 启动测试驱动开发流程 | `/tdd` |
| `/diagnose` | 结构化排查 bug | `/diagnose` |
| `/caveman` | 省 token 模式（适合长编码任务） | `/caveman` |
| `/improve-codebase-architecture` | 架构审查 | `/improve-codebase-architecture` |
| `/zoom-out` | 代码混乱时退一步审视设计 | `/zoom-out` |
| `/loop <间隔> <命令>` | 定时重复执行命令 | `/loop 5m /diagnose` |

### 5. 记忆系统（跨对话持久化）

Claude Code 会自动保存关键信息到 `~/.claude/projects/<slug>/memory/`，实现跨对话记忆。
这意味着你关闭对话后再次打开，仍能记住之前的设置和偏好。

常用指令及示例：

| 指令 | 示例 |
|------|------|
| **把这段配置写入记忆** | "把当前的 API 端点配置写入记忆" |
| **记住这个做法** | "记住这个 deploy 流程" |
| **帮我看看之前关于 X 怎么配置的** | "帮我看看之前 MCP 怎么安装的" |
| **以后遇到 X 场景提醒你** | "以后修改代码时，提醒我用 /tdd 先写测试" |

**跨设备同步：** 记忆文件通过 git 上传到 GitHub，在家里和公司各执行一次 `git pull` 即可保持记忆一致。

```bash
# 在公司电脑同步家中已保存的记忆
cd ~/.claude && git pull
```

记忆文件和 `CLAUDE.md` 一同纳入版本控制，而对话记录 `.jsonl` 已被 git 排除，不会同步。

### 6. 备份与同步（可选）

将自己的配置推送到 GitHub，方便多设备共享。

**首次推送（创建仓库后）：**

```bash
cd ~/.claude
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git add -A
git commit -m "chore: 初始化 Claude Code 配置"
git push -u origin master
```

**日常备份：**

```bash
cd ~/.claude
git status                     # 查看有哪些文件被修改
git add -A                     # 暂存所有变更
git commit -m "chore: 更新配置" # 提交
git push                       # 推送到 GitHub
```

**从另一台设备同步：**

```bash
cd ~/.claude && git pull
```

自动排除的内容（已在 `.gitignore` 中配置，不会上传）：

- `settings.json`（含 API token，需手动复制）
- `node_modules/`（各设备自行 `npm install`）
- `projects/**/*.jsonl`（对话记录，不跨设备共享）
- `projects/**/*.jsonl.pos`（阅读位置标记）
- 运行时标记文件（`.deadloop-*`, `*.heartbeat`）

> 💡 也可以直接对我说"**帮我备份配置到 GitHub**"或"**帮我同步配置**"，AI 会自动执行对应的 git 操作。

---

## 🔧 高级设置

本节适合需要深度定制自动化工作流、MCP 工具链和死循环监控的用户。
如果只是基础使用，请参见上文的【基础设置】。

### MCP 免费工具：ask_chatgpt & ask_deepseek

这两个 MCP 服务分别调用 ChatGPT 网页版和 DeepSeek 网页版，不消耗 API token，适合复杂代码审查、长文本分析、联网查资料等场景。

> `ask_chatgpt` 通过 `target` 参数统一支持镜像站（`"mirror"`）和官方站（`"official"`），无需独立的 mirror MCP 服务。默认先尝试第三方镜像，再尝试官方网站。



#### 文件结构

```
~/.claude/mcp-servers/
├── chatgpt-mcp/          # ChatGPT 官方站
│   ├── server.js         # MCP 服务入口
│   ├── package.json
│   └── node_modules/
├── deepseek-mcp/         # DeepSeek 网页版
│   ├── server.js
│   └── ...
```

#### 一键安装依赖（批处理）

在 `~/.claude/` 目录下创建 `install-mcp-deps.bat`，写入以下内容：

```batch
@echo off
echo Installing MCP dependencies...
cd /d "%~dp0mcp-servers\chatgpt-mcp" && npm install && npx playwright install chromium
cd /d "%~dp0mcp-servers\deepseek-mcp" && npm install && npx playwright install chromium
echo All MCP dependencies installed.
pause
```

**运行方式：** 右键 `install-mcp-deps.bat` → **以管理员身份运行**（或双击运行）。

**注意事项：**

- 每个服务安装 Chromium 浏览器约 300MB，总下载量约 600MB，首次安装需要较长时间（视网速 5-30 分钟）。
- 如果中途失败，可以单独执行对应服务的安装命令重试。
- `node_modules/` 已被 `.gitignore` 排除，不会上传到 GitHub。

> 💡 也可以直接对我说"**帮我安装 MCP 依赖**"，AI 会自动完成以上安装步骤。

#### 首次使用与登录

首次调用任意 MCP 工具时，Playwright 会自动弹出 Chromium 浏览器窗口：

1. 在弹出窗口中 **手动登录** 对应服务（ChatGPT / DeepSeek）
2. 登录完成后 **关闭浏览器窗口**，session 会自动保存到独立的浏览器配置文件中
3. 后续调用不再需要重新登录，直接复用已保存的会话

> 注意：两个服务使用独立的浏览器配置文件，需要分别登录一次。
> 若需隐藏浏览器窗口（无人值守场景），在 `settings.json` 的 `env` 中设置 `"CHATGPT_HEADLESS": "true"`。

#### 提示词模板（代码审查专用）

> [待补充：用户提供的提示词模板]

#### 角色模板文件

> [待补充：用户提供的角色模板格式说明]

---

### 死循环监控（Dead Loop Monitor）

自动检测 Claude Code 输出是否陷入重复、反转、信息停滞，打断并求助第三方 AI 协助脱困。

#### 扩展包文件架构

```
~/.claude/mcp-servers/deadloop-monitor/
├── monitor.mjs                # 主监控进程
├── detectors.mjs              # 重复/反转/停滞检测器
├── helpers.mjs                # 文件读取、AutoIt 调用、停止确认
├── deadloop_control.au3       # AutoIt 源码
├── deadloop_control.exe       # 编译后的无窗口 exe
├── config.mjs                 # 所有阈值参数
├── logger.mjs                 # JSON 日志，自动轮转
├── workspace-watcher/         # VS Code 扩展
│   ├── extension.js
│   └── package.json
└── install-extension.mjs      # 扩展安装脚本
```

#### 一键安装（批处理）

创建 `install-deadloop.bat`：

```batch
@echo off
echo Installing deadloop monitor dependencies...
cd /d "%~dp0mcp-servers\deadloop-monitor"
npm install
echo Extension installation...
node install-extension.mjs
echo Done. Please reload VS Code window (Ctrl+Shift+P -> Reload Window).
pause
```

> 💡 也可以直接对我说"**帮我安装死循环监控**"，AI 会自动完成以上安装步骤。


#### 扩展安装与界面

**安装步骤：**

1. **安装依赖** — 运行 `install-deadloop.bat`，或在终端手动执行：

```bash
cd ~/.claude/mcp-servers/deadloop-monitor
npm install
node install-extension.mjs
```

2. **安装成功后会提示：**

```
[deadloop] extension installed to C:\Users\<用户名>\.vscode\extensions\laiyangli.deadloop-workspace-watcher-1.0.0
[deadloop] reload VS Code to activate (Ctrl+Shift+P → Reload Window)
```

3. **Reload VS Code** — 按 `Ctrl+Shift+P` → 输入 `Reload Window` → 回车

4. **验证安装** — Reload 后，VS Code 底部状态栏右侧会出现 **「🟢 循环守护」** 按钮

**菜单操作（左键点击状态栏）：**

| 操作 | 说明 |
|------|------|
| ⏸ 暂停监控 | 暂停检测，进程保留 |
| ▶ 恢复监控 | 恢复检测 |
| 📋 检测报告 | 打开 `.deadloop-report.md` |
| 📋 查看日志 | 打开 `deadloop-monitor.jsonl` |

**使用说明：**

- 监控自动运行，无需人工干预。每次打开 VS Code 自动启动
- 当检测到死循环时，自动执行：AutoIt ESC 长按 5 秒 → 确认是否停止 → 注入摘要指令 → 冷却
- 状态栏显示当前状态：🟢 监控中 / 🟡 已暂停 / 🔴 检测到死循环 / ⚪ 已停止
- 可在 `config.mjs` 中调整阈值（重复次数、反转词密度、信息增量率）

**重装扩展：** 修改 `extension.js` 后，重新执行 `node install-extension.mjs` 再 Reload 即可。

> 💡 也可以直接对我说"**帮我安装死循环监控扩展**"，AI 会自动完成扩展安装步骤。
> 💡 也可以直接对我说"**帮我调整循环检测阈值宽松一点**"，AI 会自动调整循环检测阈值。
---

### AutoIt3 脚本编译与调用

AutoIt3 用于模拟鼠标键盘操作，适合自动化控制外部程序、发送按键、窗口管理。

#### 功能概览

- `Send` / `ControlSend` — 发送按键
- `MouseClick` / `MouseMove` — 鼠标模拟
- `WinActivate` / `WinWait` — 窗口控制
- `ClipPut` / `ClipGet` — 剪贴板操作

#### 生成 au3 脚本的提示词模板

```
我需要一个 AutoIt3 脚本，实现以下需求：
<描述需求，例如：每 10 秒检测某个窗口是否存在，若存在则发送 F5 刷新>

请生成：
- 完整的 .au3 脚本代码
- 编译命令（使用 @Aut2Exe/Aut2exe_x64.exe，添加 /console 参数）
- 如何从 Node.js / Python 调用该 exe 的示例代码
```

#### 编译命令模板（必须无窗口静默编译）

```cmd
cmd //c "@Aut2Exe/Aut2exe_x64.exe /in "C:\Users\<用户名>\.claude\mcp-servers\deadloop-monitor\script.au3" /out "C:\Users\<用户名>\.claude\mcp-servers\deadloop-monitor\script.exe" /console"
```

也可使用绝对路径（避免当前目录问题）：

```cmd
cmd //c "@C:\Users\<用户名>\.claude\Aut2Exe\Aut2exe_x64.exe /in "C:\full\path\to\script.au3" /out "C:\full\path\to\output.exe" /console"
```

> 编译时杀毒软件可能拦截生成的 `.exe`，需手动添加至信任区（白名单），或临时关闭实时防护。

#### 在 deadloop-monitor 中的实际应用

`deadloop_control.exe` 通过上述方式编译。提供了三个子命令：

| 命令 | 说明 |
|------|------|
| `esc` | 长按 ESC 5 秒中断输出 |
| `inject_file <file>` | 粘贴文件内容 + 自动提交（Enter） |
| `paste_file <file>` | 只粘贴不提交 |

功能通过 `ControlSend` 和 `ClipPut` + `Ctrl+V` 实现，完全无窗口干扰。

---

### MCP 工具 + 死循环监控 联合使用指南

两者配合可以组成全自动脱困-求助-修复闭环。

#### 典型工作流（自动执行，不需要手动执行）

1. **监控阶段** — 死循环监控持续扫描 `.jsonl` 日志
2. **检测到死循环** → `deadloop_control.exe esc` 打断输出 → 确认停止（扫描 `stop_reason: "end_turn"`）
3. **注入求助指令** → `inject_file` 将预置的摘要生成指令粘贴到 Claude Code 输入框并自动提交 → 收到注入消息后，Claude Code 自动调用 `ask_chatgpt` 发送问题
4. **获取外部答案** → ChatGPT 网页版返回代码审查结果或修复建议 → Claude Code 按返回内容修改代码
5. **冷却恢复** → 10 秒冷却后继续监控

#### 配置要点

- 确保 `settings.json` 中 `permissions.allow` 包含 `mcp__chatgpt__ask_chatgpt` 和 `mcp__deepseek__ask_deepseek`
- 死循环监控的 `config.mjs` 中的冷却时间、触发阈值可根据工作节奏调整
- 若需长期无人值守，将 `CHATGPT_HEADLESS=true` 设为隐藏浏览器模式（但首次仍需登录）
