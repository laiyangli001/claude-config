# Claude Code 全局配置

> 🎞️ 可交互演示版：[claude-config-slides.html](https://laiyangli001.github.io/claude-config/claude-config-slides.html)
> 📖 完整图文教程：[Claude-Config-tutorial.html](https://laiyangli001.github.io/claude-config/Claude-Config-tutorial.html)

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
| **AI 服务（MCP）** | `mcp-servers/ai-services/` | ChatGPT/DeepSeek/豆包等 AI 网页版 MCP |
| **MinerU 文档解析** | `mineru-open-mcp`（MCP 工具） | PDF/图片/Office → Markdown，支持 OCR |
| **PDF 工具** | `pdf-toolkit`（MCP 工具） | 合并/拆分/加密/水印/压缩 PDF |
| **死循环监控** | `deadloop-monitor/` | 检测输出死循环 → AutoIt 打断 → 摘要求助 |
| **办公工具** | `mcp-servers/office-tools/` | Markdown → PDF（7 套主题） |
| **内嵌 Python** | `mcp-servers/python3.13.3/` | 嵌入式 Python，无需系统安装 |
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
      "mcp__chatgpt-mirror__ask_chatgpt_mirror",
      "mcp__chatgpt-official__ask_chatgpt_official",
      "mcp__deepseek__ask_deepseek",
      "mcp__doubao__ask_doubao",
      "mcp__doubao__download_doubao_file"
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

### 7. Reload Window（刷新配置）

修改配置或安装新组件后，需要让 VS Code 重新加载才能生效。

**哪些情况需要 Reload：**

| 场景 | 原因 |
|------|------|
| 修改 `settings.json` 中的 `hooks`、`permissions`、`env` | Claude Code 在启动时读取配置 |
| 安装或修改 VS Code 扩展（`extension.js`） | 扩展在启动时加载 |
| 注册新的 MCP 服务或修改 MCP 配置 | MCP 进程在启动时建立 |
| 切换 Stop Hook 开关 | hook 挂载在 settings.json 上 |
| 更新 `CLAUDE.md` 或 `rules/` | Claude Code 会话开始时读取（新会话自动生效） |

**操作方法：**

```bash
Ctrl+Shift+P   →   输入 "Reload Window"   →   回车
```

或通过命令面板：`查看` → `命令面板` → `Developer: Reload Window`。

> 如果只是修改 `CLAUDE.md` 或 `rules/` 中的规则文件，**不需要 Reload**，重新开一个会话即可。
> 修改 `README.md` 等文档文件也不影响功能，只影响阅读。

---

## 🔧 高级设置

本节适合需要深度定制自动化工作流、MCP 工具链和死循环监控的用户。
如果只是基础使用，请参见上文的【基础设置】。

### MCP 免费工具

四个独立 MCP 服务，分别调用 ChatGPT 镜像站、ChatGPT 官方站、DeepSeek 网页版和豆包 AI，不消耗 API token，适合复杂代码审查、长文本分析、视觉识别等场景。

| 工具 | 位置 | 说明 |
|------|------|------|
| `ask_chatgpt_mirror` | `ai-services/chatgpt-mirror/` | ChatGPT 镜像站 2233.ai，支持图片输入，优先使用 |
| `ask_chatgpt_official` | `ai-services/chatgpt-official/` | ChatGPT 官方站 chatgpt.com，需 VPN |
| `ask_deepseek` | `ai-services/deepseek/` | DeepSeek 网页版，国内直连 |
| `ask_doubao` | `ai-services/doubao/` | 豆包 AI，图片/文档识别、PPT 生成、Excel 表格 |
| `download_doubao_file` | `ai-services/doubao/` | 下载豆包生成的 PPT/Excel 文件 |
| `parse_documents` | `mineru-open-mcp`（工具名） | 文档/图片 OCR 提取文字到 Markdown |
| `pdf_*` 系列 | `pdf-toolkit`（工具名） | 合并/拆分/加密/水印/加页码等 |



#### 文件结构

```
~/.claude/
├── mcp-servers/
│   ├── ai-services/           # AI 网页版 MCP 服务
│   │   ├── chatgpt-mirror/    # ChatGPT 镜像站
│   │   ├── chatgpt-official/  # ChatGPT 官方站
│   │   ├── deepseek/          # DeepSeek 网页版
│   │   ├── doubao/            # 豆包 AI
│   │   └── shared/            # 共享模块（browser/answer/upload/role）
│   ├── office-tools/          # 办公工具（md-to-pdf 等）
│   ├── deadloop-monitor/      # 死循环监控
│   ├── python3.13.3/          # 内嵌 Python
│   └── node_modules/          # 依赖
├── skills/                    # /mcp-baipiao、/mcp-office-tool 等
├── scripts/                   # 工具脚本
├── install-mcp-deps.bat
└── install-mcp-config.mjs
```

#### 一键安装依赖（批处理）

在 `~/.claude/` 目录下双击 `install-mcp-deps.bat` 即可一键完成：

```batch
@echo off
echo [1/2] Installing Chromium browser for Playwright...
cd /d "%~dp0"
npx playwright install chromium
echo [2/2] Registering MCP server config...
node install-mcp-config.mjs
echo Done! Please Reload Window (Ctrl+Shift+P -> Reload Window).
pause
```

**运行方式：** 右键 `install-mcp-deps.bat` → **以管理员身份运行**（或双击运行）。

**注意事项：**

- Chromium 浏览器约 300MB，首次安装需要较长时间（视网速 5-30 分钟）。
- `node_modules/` 和 `python3.13.3/` 已直接入仓，clone 后无需额外安装依赖。
- 四个服务共用同一份 Chromium。

> 💡 也可以直接对我说"**帮我安装 MCP 依赖**"，AI 会自动完成以上安装步骤。

#### MCP 配置文件说明

Claude Code 通过两个配置文件加载 MCP 服务：

| 配置文件 | 位置 | 优先级 | 说明 |
|---------|------|-------|------|
| **`.claude.json`** | `~/.claude.json`（用户家目录） | **高（主要）** | `install-mcp-config.mjs` 写入此文件，始终被 Claude Code 加载 |
| `.mcp.json` | `~/.claude/.mcp.json` | 低（次要） | 本地参考副本，某些工作区可能不自动加载 |

**关键逻辑：**
- `~/.claude.json` 是 MCP 服务注册的**主要配置文件**，`install-mcp-config.mjs` 自动将四个服务的启动路径写入此文件
- `.mcp.json` 是本仓库内的参考副本，实际运行时不一定被 Claude Code 读取
- 仓库克隆后必须执行 `install-mcp-deps.bat`（或 `node install-mcp-config.mjs`）将 MCP 配置写入 `~/.claude.json`

**切换工作区的注意事项：**
- MCP 服务路径由 `~/.claude.json` 决定，与当前 VSCode 工作区无关
- 如果切换工作区后某 MCP 服务无法调用，优先检查 `~/.claude.json` 中的 `mcpServers` 配置是否完整
- 四个服务的启动命令都使用绝对路径（`c:/Users/<用户名>/.claude/mcp-servers/...`），不依赖工作区路径

#### 首次使用与登录

首次调用任意 MCP 工具时，Playwright 会自动弹出 Chromium 浏览器窗口：

1. 在弹出窗口中 **手动登录** 对应服务（ChatGPT / DeepSeek / 豆包）
2. 登录完成后 **关闭浏览器窗口**，session 会自动保存到独立的浏览器配置文件中
3. 后续调用不再需要重新登录，直接复用已保存的会话

> 注意：四个服务使用独立的浏览器配置文件，需要分别登录一次。
> 若需隐藏浏览器窗口（无人值守场景），在 `settings.json` 的 `env` 中设置 `"CHATGPT_HEADLESS": "true"`、`"DEEPSEEK_HEADLESS": "true"` 或 `"DOUBAO_HEADLESS": "true"`。

#### 提示词模板

模板文件存放在 `mcp-servers/shared/templates/` 目录下，以 `.md` 格式存储，可通过 `/mcp-baipiao` skill 自动加载。当前已预置模板：

| 模板 | 文件名 | 适用场景 |
|------|--------|---------|
| 代码审查 | `code_review.md` | Python/JS/TS 等代码审查，含角色设定、分析维度、输出格式 |
| 视觉分析 | `vision_analysis.md` | 界面截图/UI Bug 分析，支持点阵归一化坐标 |
| 长文本 | `long_text.md` | 长文档/日志总结 |
| 批量任务 | `batch_task.md` | 批量格式化/生成/转换 |
| 格式化 | `format_task.md` | 纯文本整理/代码高亮等 |

模板中支持变量插值：`{{user_concern}}`（关注点）、`{{file_name}}`（文件名）。`/mcp-baipiao` 调用时自动完成替换。

#### `/mcp-baipiao` 任务助手

自动识别任务场景、加载对应模板、选择最优 MCP 服务并执行，省去手动拼参数的麻烦。

**用法：** 直接描述需求即可，无需指定服务和模板。

```text
/mcp-baipiao 审查 src/app.js，重点关注安全性
/mcp-baipiao 总结这个日志文件中的错误模式
/mcp-baipiao 分析这张截图中的布局问题
/mcp-baipiao 把这个 JSON 数据转成表格格式
```

**场景匹配规则：**

| 场景 | 触发条件 | 首选服务 | 加载模板 |
|------|---------|---------|---------|
| 代码审查 | 代码文件 >500行 或 明确要求审查 | mirror | `code_review` |
| 长文本分析 | 纯文档且估计 >10k token | deepseek | `long_text` |
| 多模态视觉 | 图片/界面截图 | mirror | `vision_analysis` |
| 重复性任务 | 批量生成/格式化/转换 | deepseek | `batch_task` |
| 非推理任务 | 文本整理/代码高亮 | deepseek | `format_task` |

**服务降级链：** 首选服务失败时自动切换备用服务。

| 场景 | 首选 | 第二选择 | 第三选择 | 兜底 |
|------|------|---------|---------|------|
| 代码审查 | mirror | deepseek | official | 提示手动检查 |
| 长文本分析 | deepseek | official | mirror | 分段处理 |
| 多模态 | mirror | official | doubao | 提示无法处理 |
| 重复/格式化 | deepseek | official | — | 提示手动完成 |

**复合任务：** 检测到多个动作时（如"审查代码并翻译注释"），拆分子任务按顺序依次执行。

**反馈循环：** 执行完成后支持调整关注点重新分析，或按问题列表逐项修复。

---

### MinerU 文档解析（MCP 工具）

MinerU 是一个高精度文档解析引擎，通过 `mineru-open-mcp` MCP 服务集成到 Claude Code 中。支持 PDF、图片、Office 文档等转 Markdown。

#### 安装

```bash
npm install -g mineru-open-api
```

MCP 服务已在 `install-mcp-config.mjs` 中注册，如未注册手动添加：

```bash
claude mcp add --transport stdio mineru-open-mcp -- npx -y mineru-open-mcp
```

#### 支持的格式

| 类型 | 格式 |
|------|------|
| 文档 | PDF、DOCX、PPTX |
| 图片 | PNG、JPG、JPEG、WebP、GIF、BMP |
| 表格 | XLS、XLSX |
| 网页 | HTML（需指定 `model='html'`） |

#### 两种模式

| 模式 | 条件 | 上限 | 输出 |
|------|------|------|------|
| Flash | 无需 token | ≤ 20 页/文件，≤ 10MB | Markdown（表格/公式/OCR） |
| Precision | 需 `MINERU_API_TOKEN` | ≤ 600 页/文件 | MD/HTML/LaTeX/DOCX + VLM 布局 |

#### API Key 配置（Precision 模式）

在 [mineru.net](https://mineru.net) 注册并获取 API Token 后，配置到 `~/.claude.json`（用户家目录，不会被 git 跟踪）：

```json
{
  "mcpServers": {
    "mineru-open-mcp": {
      "command": "uvx",
      "args": ["mineru-open-mcp"],
      "env": {
        "MINERU_API_TOKEN": "你的token"
      }
    }
  }
}
```

⚠️ 每次修改 `~/.claude.json` 后需要 **Reload Window** 让 MCP 进程重新加载。

#### 使用方式

MinerU 在 Claude Code 中有两种调用路径：

**方式一：自然语言触发（推荐）**

直接描述需求，Claude 会自动判断调用 `mineru-open-mcp` 的 `parse_documents` 工具：

```text
把这份 PDF 转成 Markdown
提取这个扫描件中的表格和公式
解析这个 Word 文档
ocr 识别这张图片中的文字
```

只要对话中附带了文件，Claude 会**自动选择** MinerU 处理，无需指定工具名。
如果是**界面截图、照片识别、画面分析**等需要理解图像内容的，Claude 会自动切换到豆包处理。

**方式二：通过 Skill 调用**

使用 `/mcp-office-tool` 或 `/mcp-baipiao` 自动匹配场景。

#### 调用逻辑

```
用户提供文件或URL
    ↓
Claude 识别文件类型（PDF/Word/图片等）
    ↓
自动调用 mineru-open-mcp.parse_documents
    ↓
MinerU 解析 → 返回 Markdown 结果
    ↓
Claude 将结果呈现给用户
```

不需要用户手动指定参数（语言、页数、OCR 等），Claude 会根据文件类型和需求自动推断。

#### 工作场景示例

| 场景 | 对话示例 | MinerU 处理方式 |
|------|---------|---------------|
| **论文批注** | "这篇学术论文的第三页表格提取出来" | 解析 PDF → 定位第 3 页 → 提取表格 → 返回 Markdown |
| **合同审查** | "帮我把这份合同的条款部分转成文本" | 解析 PDF/DOCX → 识别段落结构 → 返回纯文本 |
| **扫描件 OCR** | "这张票据图片的文字识别一下" | OCR 识别 → 返回可编辑文字 |
| **PPT 转文字** | "把这份演示文稿的内容提取出来" | 解析 PPTX → 提取每页文字 → 返回结构化 Markdown |
| **Excel 转 Markdown** | "这个表格转成可读的 Markdown" | 解析 XLSX → 提取表格数据 → 返回表格 Markdown |
| **网页抓取** | "把这个网页内容转成 Markdown" | 抓取 HTML → 解析正文 → 返回 Markdown（需指定 model='html'） |
| **批量处理** | "这个文件夹里的 PDF 全部转成文本" | 批量解析 → 分别输出 Markdown（Precision 模式） |
| **混合文档** | "这个压缩包里的 PDF 和图片一起处理" | 自动识别格式 → 逐文件解析 → 汇总结果 |

#### 注意事项

- Flash 模式免费，适合日常快捷解析
- 精确模式需在 [mineru.net](https://mineru.net) 注册获取 token
- 文件发送到 mineru.net 处理后不留存
- 参数 `language` 默认 `ch`，英文文档建议设为 `en`

> **⚠️ 能力边界：** MinerU 的图片处理是 **OCR + 版面分析**，能识别图片中的文字、表格、公式，但**不具备图像理解能力**。如果需要"这张截图有什么问题"、"这张照片里是什么"等视觉分析，应使用 `ask_chatgpt_mirror`（支持图片输入）。简单区分：**要提取文字 → MinerU，要理解画面 → mirror**。
---

### 死循环监控（Dead Loop Monitor）

自动检测 Claude Code 输出是否陷入重复、反转、信息停滞，打断并求助第三方 AI 协助脱困。

#### 扩展包文件架构

```
~/.claude/deadloop-monitor/
├── stop-hook.mjs              # Stop Hook 检测（事件驱动，零延迟）
├── detectors.mjs              # 重复/反转/停滞检测器（供各类脚本引用）
├── helpers.mjs                # AutoIt 调用、文件读取等工具函数
├── deadloop_control.au3       # AutoIt 源码
├── deadloop_control.exe       # 编译后的无窗口 exe
├── config.mjs                 # 所有阈值参数
├── logger.mjs                 # JSON 日志，自动轮转
├── workspace-watcher/         # VS Code 扩展（负责状态栏 + 配置界面）
│   ├── extension.js
│   └── package.json
├── install-extension.mjs      # 装扩展（给 install-deadloop.mjs 调用）
└── install-deadloop.mjs       # 一键安装：装扩展 + 注册 Hook
```

#### 一键安装（批处理）

运行 `install-deadloop.bat` 或直接在终端执行：

```bash
cd ~/.claude/deadloop-monitor
node install-deadloop.mjs
```

脚本自动完成：
1. 安装 VS Code 扩展
2. 注册 Stop Hook 到 `~/.claude/settings.json`

> 💡 也可以直接对我说"**帮我安装死循环监控**"，AI 会自动完成以上安装步骤。


#### 扩展安装与界面

**安装步骤：**

运行 `install-deadloop.mjs`，一步完成扩展安装和 Hook 注册：

```bash
cd ~/.claude/deadloop-monitor
node install-deadloop.mjs
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

- 检测由 **Stop Hook** 事件驱动，在 Claude 每轮输出完成后**立即触发**
- 检测最近两轮文本相似度，超过阈值（默认 Jaccard 相似度 > 0.85）判定为循环
- 阈值可在 `config.mjs` 中调整（`jaccardThreshold`）或切换 preset（`default` / `conservative` / `sensitive`）
- 检测到死循环时，自动执行：AutoIt 注入求助消息到输入框并提交
- 状态栏显示当前状态：🟢 监控中 / 🟡 已暂停 / 🔴 检测到死循环 / ⚪ 已停止
- 可在 `config.mjs` 中调整阈值（重复次数、反转词密度、信息增量率）

**重装扩展：** 修改 `extension.js` 后，重新执行 `node install-extension.mjs` 再 Reload 即可。

**Stop Hook 注册：** `stop-hook.mjs` 通过 `settings.json` 中的 `hooks.Stop` 配置激活，修改后同样需要 Reload Window 生效。

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
3. **注入求助指令** → `inject_file` 将预置的摘要生成指令粘贴到 Claude Code 输入框并自动提交 → 收到注入消息后，Claude Code 自动触发 `/mcp-baipiao` skill，按场景选择最优服务发送问题
4. **获取外部答案** → AI 网页版返回代码审查结果或修复建议 → Claude Code 按返回内容修改代码
5. **冷却恢复** → 10 秒冷却后继续监控

#### 配置要点

- 确保 `settings.json` 中 `permissions.allow` 包含所有 MCP 工具：`mcp__chatgpt-mirror__ask_chatgpt_mirror`、`mcp__chatgpt-official__ask_chatgpt_official`、`mcp__deepseek__ask_deepseek`、`mcp__doubao__ask_doubao`、`mcp__doubao__download_doubao_file`
- 死循环监控的 `config.mjs` 中的冷却时间、触发阈值可根据工作节奏调整
- 若需长期无人值守，将 `CHATGPT_HEADLESS=true` 设为隐藏浏览器模式（但首次仍需登录）
