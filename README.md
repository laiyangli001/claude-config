# Claude Code 全局配置

个人 Claude Code 系统配置备份。克隆到 `~/.claude` 即用。

## 包含内容

| 组件 | 路径 | 说明 |
|------|------|------|
| **全局 CLAUDE.md** | `CLAUDE.md` | 身份定义、行为边界、工具规则、自动调用策略 |
| **MCP 免费工具** | `mcp-servers/` | `ask_chatgpt` + `ask_chatgpt_mirror` + `ask_deepseek`，浏览器自动化，不消耗 API token |
| **死循环监控** | `mcp-servers/deadloop-monitor/` | 检测 Claude Code 输出死循环 → 自动打断 → 摘要求助 |
| **角色系统** | `mcp-servers/roles/` | 自动检测问题类型，首次调用发送角色模板（如 python_tutor）|
| **MCP 模板配置** | `claude.json.example` | `~/.claude.json` 的参考模板（MCP 服务器注册） |
| **Matt Pocock Skills** | `.agents/skills/` | 14 个工程纪律技能 |
| **Agent Skills 配置** | `docs/agents/` | Issue Tracker / Triage Labels / Domain Docs |
| **记忆文件** | `projects/claude-config/memory/` | 跨对话持久化的偏好和参考信息 |
| **Skills（内建）** | `skills/` | Vercel、React 等内建技能包 |

## 快速恢复

```bash
# 1. 克隆
git clone https://github.com/laiyangli001/claude-config.git ~/.claude

# 2. 安装 MCP 依赖
cd ~/.claude/mcp-servers/chatgpt-mcp && npm install
cd ~/.claude/mcp-servers/deepseek-mcp && npm install
cd ~/.claude/mcp-servers/chatgpt-mirror-mcp && npm install
cd ~/.claude/mcp-servers/deadloop-monitor && npm install

# 3. 下载 Chromium 浏览器（必须，约 300MB）
cd ~/.claude/mcp-servers/chatgpt-mcp && npx playwright install chromium
cd ~/.claude/mcp-servers/deepseek-mcp && npx playwright install chromium
cd ~/.claude/mcp-servers/chatgpt-mirror-mcp && npx playwright install chromium

# 4. 配置 settings.json（从模板复制，填入你的 API token）
cp ~/.claude/settings.json.example ~/.claude/settings.json
# 编辑 settings.json：
#   - 将 sk-<your-api-token-here> 替换为真实 token
#   - 可按需修改 systemPrompt 和 effortLevel

# 5. 配置全局 MCP 服务器（从模板复制）
cp ~/.claude/claude.json.example ~/.claude.json
# 编辑 ~/.claude.json，修正各 MCP 服务的路径
```

## 首次使用 MCP 工具

首次调用任意 MCP 工具时，Playwright 会自动弹出 Chromium 窗口：

1. **在弹出窗口中手动登录**（ChatGPT / 镜像站 / DeepSeek）
2. 登录后关闭窗口，session 会自动保存
3. 以后调用不再需要重新登录

**注意：** 三个服务使用独立的浏览器配置文件，需要分别登录一次。

**网络要求：**
- `ask_chatgpt`：需要能访问 `chatgpt.com`
- `ask_chatgpt_mirror`：访问镜像站 `chatgpt.2233.ai`，需联网
- `ask_deepseek`：国内网络可直接访问

**镜像站特殊流程：** 首次调用 `ask_chatgpt_mirror` 时会打开邀请码页面，点击 **「立即开始」** 按钮后自动打开新标签页并跳转到对话页。已登录则直接开始对话。

## MCP 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `CHATGPT_HEADLESS` | `false` | 设为 `true` 隐藏 ChatGPT / 镜像站浏览器 |
| `CHATGPT_DEBUG` | `false` | ChatGPT 调试日志 |
| `DEEPSEEK_HEADLESS` | `false` | 设为 `true` 隐藏 DeepSeek 浏览器 |
| `DEEPSEEK_DEBUG` | `false` | DeepSeek 调试日志 |

可在 `settings.json` 的 `env` 块中设置。

## 项目初始化

在新项目目录中打开 Claude Code，说：

> 帮我初始化 mattpocock skills

会自动探测项目状态、提问三个配置项、写入项目级配置。

## 核心 Skills 速查

| 技能 | 何时用 |
|------|--------|
| `/grill-me` | 新任务开始前，对齐需求 |
| `/tdd` | 写新功能、修 bug |
| `/diagnose` | bug 定位不清时 |
| `/caveman` | 大量编码，省 75% token |
| `/improve-codebase-architecture` | 每周一次架构体检 |
| `/zoom-out` | 代码变乱，不知从哪下手 |

## 角色系统

MCP 工具内置自动角色检测。首次调用时，根据问题内容自动匹配并发送角色模板（作为第一条消息设定 AI 身份），同一会话后续调用不重复发送。

当前可用角色：

| 角色文件 | 触发关键词 | 说明 |
|----------|-----------|------|
| `python_tutor.md` | python, django, flask, pandas, asyncio, 装饰器等 | Python 编程导师，教学风格 |
| `nodejs_tutor.md` | node.js, javascript, express, typescript, 异步, event loop 等 | Node.js/JS 编程导师，教学风格 |

也可在调用时显式指定角色：
```
用 ask_chatgpt（角色 python_tutor）问：解释异步编程
```

在 `mcp-servers/roles/` 中添加新的 `.md` 文件并更新 `detectRole()` 即可扩展角色。

## CLAUDE.md 自动调用规则

全局 `CLAUDE.md` 中已配置自动触发规则。当你自主处理任务时，满足以下任一条件会自动调用免费 MCP 工具：

- 数据量超过 1500 token 或 3000 字符
- 需要信息提取/统计/转换
- 需要联网获取最新信息
- 复杂推理（步骤超过 5 步）
- 知识不足
- 任务涉及文件分析（自动以附件上传）

策略：优先 `ask_chatgpt_mirror` → 失败回退 `ask_chatgpt` → 再失败回退 `ask_deepseek`。

## 死循环监控（Dead Loop Monitor）

监控 Claude Code 输出是否陷入重复循环，自动打断并求助第三方 AI 协助脱困。

**架构：**
- `monitor.mjs` — 独立进程，轮询 `.jsonl` 对话文件，通过三个检测器（重复代码块、反转词密度、信息增量率）识别循环
- `workspace-watcher/extension.js` — VS Code 扩展，状态栏显示监控状态，检测到循环时右下角弹通知
- 检测到循环 → 发 Ctrl+C 打断 → 确认停止 → 注入摘要指令 → 冷却后继续监控

**进程保活：** monitor 每 2 秒写心跳文件 `.deadloop-heartbeat`，扩展每 3 秒轮询 mtime，超 10 秒判定进程死亡并更新状态栏。

**状态栏操作：** 左键点击弹出菜单：暂停/恢复/停止监控、查看日志。

**VS Code 扩展安装：**
```bash
cd ~/.claude/mcp-servers/deadloop-monitor
npm install         # 自动通过 postinstall 脚本安装扩展
# 或手动安装：
code --install-extension workspace-watcher/laiyangli.deadloop-workspace-watcher-1.0.0.vsix
```

## 记忆系统：对话持久化

跨对话保存关键信息，对 Claude Code 说以下指令：

| 指令 | 效果 | 示例 |
|------|------|------|
| "把这段配置写入记忆" | 保存关键决策到 memory 文件 | "把当前的 API 端点配置写入记忆" |
| "记住这个做法" | 保存操作流程和决策理由 | "记住这个 deploy 流程" |
| "帮我看看之前关于 X 怎么配置的" | 读取历史记忆恢复上下文 | "帮我看看之前 MCP 怎么安装的" |
| "以后遇到 X 场景提醒我" | 保存为反馈规则，见下方详细举例 | — |

### "以后遇到 X 场景提醒我" 详细举例

| 对 Claude Code 说 | 保存的规则 |
|------|-----------|
| "以后我要写新功能时，提醒我用 `/grill-me` 先对齐需求" | 新功能开发前自动提示需求对齐 |
| "以后修改代码时，提醒我用 `/tdd` 先写测试" | 编码前提示红-绿-重构循环 |
| "以后遇到报错反复修不好时，提醒我用 `/diagnose` 结构化排查" | bug 循环时提示科学诊断方法 |
| "以后连续编码超过 10 分钟时，提醒我开启 `/caveman` 省 token" | 长对话时提示压缩模式 |
| "以后每次完成一个大模块，提醒我跑 `/improve-codebase-architecture`" | 里程碑后提示架构审查 |
| "以后我说代码太乱看不懂时，提醒我用 `/zoom-out`" | 迷失方向时提示退一步审视 |
| "以后新项目开始前，提醒我初始化 `/grill-with-docs` 写 CONTEXT.md" | 新项目启动时提示写领域文档 |
| "以后准备发布时，提醒我用 `/to-prd` 生成需求文档" | 发布前提示生成 PRD |
| "以后积攒了多个 idea 时，提醒我用 `/to-issues` 拆成任务" | 想法堆积时提示拆解为 issue |

## 备份修改

```bash
cd ~/.claude
git add -A
git commit -m "描述改动"
git push
```

## 注意事项

- `settings.json` 包含 API token，已被 `.gitignore` 排除，不会上传
- `systemPrompt` 字段会注入到系统提示词最前端，优先级高于 `CLAUDE.md`，适合放置语言/身份约束
- `mcp-servers/*/node_modules/` 已排除，克隆后需 `npm install`
- `mcp-servers/*/package-lock.json` 已排除，克隆后需 `npm install` 生成
- 对话记录 `.jsonl` 包含在备份中，仓库设为 **Private**
- 全局配置的 Agent Skills 默认值：Local Markdown + 默认标签 + Single-context
- `claude.json.example` 是 `~/.claude.json` 的参考模板，新机器需根据实际路径修正 MCP 参数
- MCP 服务器配置在 `~/.claude.json`（全局），不在 `settings.json` 中
