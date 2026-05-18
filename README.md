# Claude Code 全局配置

个人 Claude Code 系统配置备份。克隆到 `~/.claude` 即用。

## 包含内容

| 组件 | 路径 | 说明 |
|------|------|------|
| **全局 CLAUDE.md** | `CLAUDE.md` | 身份定义、行为边界、工具规则、自动调用策略 |
| **MCP 免费工具** | `mcp-servers/` | `ask_chatgpt` + `ask_deepseek`，浏览器自动化，不消耗 API token |
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

# 3. 配置 settings.json（从模板复制，填入你的 API token）
cp ~/.claude/settings.json.example ~/.claude/settings.json
# 编辑 settings.json：
#   - 将 sk-<your-api-token-here> 替换为真实 token
#   - 可按需修改 systemPrompt 和 effortLevel
```

## 首次使用 MCP 工具

首次调用 `ask_chatgpt` 或 `ask_deepseek` 时会自动弹出浏览器窗口，手动登录一次即可，会话持久保存。

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
- 对话记录 `.jsonl` 包含在备份中，仓库设为 **Private**
- 全局配置的 Agent Skills 默认值：Local Markdown + 默认标签 + Single-context
