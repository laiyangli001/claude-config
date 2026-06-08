# Claude Code 全局配置

> 🎞️ 可交互演示版：[claude-config-slides.html](https://laiyangli001.github.io/claude-config/claude-config-slides.html)
> 📖 完整图文教程：[Claude-Config-tutorial.html](https://laiyangli001.github.io/claude-config/Claude-Config-tutorial.html)
> 📘 软件安装配置教程：[VSCode+Claude+DeepSeek 使用教程.md](./VSCode+Claude+DeepSeek%20使用教程.md)

个人 Claude Code 工作环境配置。克隆到 `~/.claude` 即用。

---

## 📦 基础设置（快速上手）

本节适合新用户快速完成 Claude Code 环境搭建。如需定制 AI 服务、死循环监控或 AutoIt 脚本，请移步【高级设置】。

### 1. 克隆配置仓库

```bash
git clone https://github.com/laiyangli001/claude-config.git ~/.claude
```

### 2. 目录结构

| 组件 | 路径 | 说明 |
|------|------|------|
| **全局 CLAUDE.md** | `CLAUDE.md` | 身份定义、行为边界、skill 使用指南 |
| **设置** | `settings.json` | API 端点、模型、权限、环境变量 |
| **CodeGraph 代码图谱** | `codegraph`（MCP 工具） | 预索引代码搜索，替代 grep，58% 更少工具调用 |
| **AI 服务（MCP）** | `mcp-servers/ai-services/` | ChatGPT/DeepSeek/Claude/豆包等 AI 网页版 MCP |
| **MinerU 文档解析** | `mineru-open-mcp`（MCP 工具） | PDF/图片/Office → Markdown，支持 OCR |
| **PDF 工具** | `pdf-toolkit`（MCP 工具） | 合并/拆分/加密/水印/压缩 PDF |
| **死循环监控** | `mcp-servers/deadloop-monitor/` | 检测输出死循环 → 打断 → 摘要求助 |
| **办公工具** | `mcp-servers/office-tools/` | Markdown → PDF（7 套主题） |
| **技能** | `skills/` | 11 个技能（mcp-baipiao、multi-ai-coder 等） |
| **AutoIt 编译器** | `Aut2Exe/` | 脚本编译、Reload、截图对话框辅助 |
| **规则文件** | `rules/` | 调试、AutoIt 等专项规则 |
| **会话数据** | `projects/**/*.jsonl` | 对话记录（git 排除，不上传） |
| **跨对话记忆** | `projects/<slug>/memory/` | 持久化的用户偏好和项目上下文 |

### 3. 基础配置（settings.json）

从模板复制并填入 API Key：

```bash
copy ~\.claude\settings.json.example ~\.claude\settings.json
```

| 字段 | 说明 | 示例值 |
|------|------|--------|
| `env.ANTHROPIC_BASE_URL` | API 端点地址 | `https://api.deepseek.com/anthropic` |
| `env.ANTHROPIC_AUTH_TOKEN` | **你的 API Key** | `sk-xxxxxxxxxxxx` |
| `env.ANTHROPIC_MODEL` | 使用的模型 | `deepseek-v4-flash` |

**安全提醒：** `settings.json` 已在 `.gitignore` 中排除，不会上传到 GitHub。

### 4. 安装 MCP 依赖

```bash
cd ~/.claude
npx playwright install chromium
node mcp-servers/install-mcp-config.mjs
```

完成后 **Reload Window**（`Ctrl+Shift+P` → `Developer: Reload Window`）。

### 5. 基础命令与工作流

| 命令 | 用途 | 示例 |
|------|------|------|
| `/help` | 查看所有可用命令 | `/help` |
| `/clear` | 清空当前对话历史 | `/clear` |
| `/grill-me` | 新任务前对齐需求 | `/grill-me` |
| `/mcp-baipiao` | 审查代码/总结文档/分析图片 | `/mcp-baipiao 审查 app.js` |
| `/mcp-office-tool` | PDF 操作/导出 | `/mcp-office-tool 导出 PDF` |
| `/multi-ai-coder` | 多 AI 协作编程 | `/multi-ai-coder 写个贪吃蛇` |

### 6. 记忆系统

Claude Code 自动保存关键信息到 `projects/<slug>/memory/`，跨对话持久化。记忆文件通过 git 同步。

### 7. Reload Window

修改配置或安装新组件后需要 Reload。可用 `Aut2Exe/reload-vscode.exe` 自动执行，或手动：

```
Ctrl+Shift+P → Developer: Reload Window
```

---

## 🔧 高级设置

本节适合需要深度定制自动化工作流、MCP 工具链和死循环监控的用户。

### AI 网页服务（MCP）

五个独立 MCP 服务，共用 Chrome 浏览器（端口 9222），Reload 后自动复用，无需重复登录。

| 工具 | 位置 | 说明 |
|------|------|------|
| `ask_chatgpt_mirror` | `ai-services/chatgpt-mirror/` | ChatGPT 镜像站 2233.ai，支持图片输入 |
| `ask_chatgpt_official` | `ai-services/chatgpt-official/` | ChatGPT 官方站 chatgpt.com，需 VPN |
| `ask_claude_mirror` | `ai-services/claude-mirror/` | Claude 镜像站 2233.ai，支持截屏 |
| `ask_deepseek` | `ai-services/deepseek/` | DeepSeek 网页版，国内直连 |
| `ask_doubao` | `ai-services/doubao/` | 豆包 AI，图片/文档/PPT 生成 |
| `parse_documents` | `mineru-open-mcp` | 文档/图片 OCR 提取文字到 Markdown |
| `pdf_*` 系列 | `pdf-toolkit` | 合并/拆分/加密/水印/加页码 |

#### 文件结构

```
mcp-servers/
├── ai-services/
│   ├── chatgpt-mirror/
│   ├── chatgpt-official/
│   ├── claude-mirror/
│   ├── deepseek/
│   ├── doubao/
│   └── shared/
├── office-tools/
│   ├── md-to-pdf.mjs
│   ├── md-preview.mjs
│   └── themes/
├── deadloop-monitor/
└── install-mcp-config.mjs
```

#### 首次使用与登录

首次调用 MCP 工具时，Playwright 弹出浏览器窗口，手动登录后 session 自动保存。后续复用无需再登录。

浏览器通过 CDP 端口 9222 持久运行，Reload 后自动连接，不会积累进程。

#### 提示词模板

模板存放在 `mcp-servers/ai-services/shared/templates/`，通过 `/mcp-baipiao` 自动加载：

| 模板 | 文件名 | 适用场景 |
|------|--------|---------|
| 代码审查 | `code_review.md` | 代码审查含角色设定、分析维度、输出格式 |
| 视觉分析 | `vision_analysis.md` | 界面截图/UI Bug 分析 |
| 长文本 | `long_text.md` | 长文档/日志总结 |
| 批量任务 | `batch_task.md` | 批量格式化/生成/转换 |
| 格式化 | `format_task.md` | 文本整理/代码高亮 |

### 死循环监控

自动检测 Claude Code 输出是否陷入重复、反转、信息停滞，打断并求助第三方 AI。

#### 一键安装

```bash
cd ~/.claude/mcp-servers/deadloop-monitor
node install-deadloop.mjs
```

Reload 后状态栏右下角显示 🟢 **循环守护**。

#### 功能

- **Stop Hook 驱动** — 事件驱动检测，零延迟
- **三重检测** — Jaccard 相似度、反转词密度、n-gram 信息增量
- **自动打断** — 检测到死循环时 AutoIt 打断输出并注入求助
- **冷却恢复** — 10 秒冷却后继续监控

#### 权限提示音

状态栏左键可开关提示音。白名单仅保留 `Skill`、`Agent`、`AskUserQuestion`，其他工具触发权限提示时会响铃。

### AutoIt3 脚本编译

AutoIt3 用于模拟鼠标键盘操作，适合自动化控制外部程序。

**编译器位置：** `Aut2Exe/Aut2exe_x64.exe`

**编译命令：**
```cmd
cmd //c "Aut2Exe/Aut2exe_x64.exe /in <脚本路径> /out <输出路径> /console"
```

**已编译工具：**

| 工具 | 用途 |
|------|------|
| `reload-vscode.exe` | 自动执行 VS Code Reload Window |
| `screenshot-dialog.exe` | Chrome 截图对话框辅助 |

### 浏览器端口复用

所有 AI 服务通过 CDP（Chrome DevTools Protocol）端口 9222 复用同一浏览器：

1. 首次调用时启动 Chrome + `--remote-debugging-port=9222`
2. 后续调用直接连接已有浏览器，不新建窗口
3. Reload 后自动复用，进程不积累
4. 没有现成聊天页时新建标签页，不占用用户已有网页

### MCP 注册脚本

`install-mcp-config.mjs` 自动将 MCP 服务写入 `~/.claude.json`，同时注册 hooks.Stop（死循环监控）。

```bash
node mcp-servers/install-mcp-config.mjs
```

执行后需 Reload Window 生效。

### CodeGraph 代码知识图谱

预索引的代码搜索工具，通过 MCP 服务给 Claude Code 提供语义代码智能。~16% 更便宜 · ~58% 更少工具调用 · 100% 本地运行。

#### 安装

```bash
npm install -g @colbymchenry/codegraph
codegraph install    # 自动检测并连接 Claude Code
```

#### 使用

```bash
cd 你的项目
codegraph init -i    # 初始化并建立索引
```

之后 Clade Code 中自动生效，代码搜索优先走 CodeGraph 而非 grep。

#### 自动排除

- 默认跳过 `node_modules`、`dist`、`build`、`target`、`.venv` 等
- 自动遵循 `.gitignore`（含非 git 项目）
- 自定义排除：编辑项目 `.gitignore` 添加需跳过的目录
