---
name: system-config-reference
description: 全局 Claude Code 系统配置记录——MCP 服务、skills、issue tracker 等完整配置快照
metadata:
  type: reference
---

本记忆是 2026-05-18 完成的全局系统配置快照，用于后续快速参考和恢复。

## 配置文件位置

| 文件 | 路径 |
|------|------|
| 全局 CLAUDE.md | `C:\Users\LaiYangLi\.claude\CLAUDE.md` |
| Claude 配置 | `C:\Users\LaiYangLi\.claude.json` |
| Settings | `C:\Users\LaiYangLi\.claude\settings.json` |
| Agent skills 文档 | `C:\Users\LaiYangLi\.claude\docs\agents\` |
| 记忆存储 | `C:\Users\LaiYangLi\.claude\projects\c--Users-LaiYangLi--claude\memory\` |

## MCP 免费工具（省 token）

- **ask_chatgpt** — ChatGPT 网页版，优先调用
- **ask_deepseek** — DeepSeek 网页版，备选
- 安装路径：`C:\Users\LaiYangLi\.claude\mcp-servers\`
- 配置在 `~/.claude.json` 的 `mcpServers` 字段
- 首次调用需浏览器登录，会话持久保存
- 自动调用规则已写入全局 CLAUDE.md 末尾

## Matt Pocock Skills（14 个）

安装命令：`npx skills@latest add mattpocock/skills`
安装位置：`.agents/skills/`

核心 4 个：
- `/grill-me` — 需求对齐
- `/tdd` — 红-绿-重构测试循环
- `/diagnose` — 结构化 bug 诊断
- `/caveman` — 省 75% token

辅助：`/grill-with-docs`, `/to-prd`, `/to-issues`, `/triage`, `/improve-codebase-architecture`, `/zoom-out`, `/handoff`, `/prototype`, `/write-a-skill`, `/setup-matt-pocock-skills`

## Agent skills 配置（全局默认）

- **Issue Tracker**: Local Markdown（`.scratch/<feature-slug>/`）
- **Triage Labels**: 默认五标签（`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`）
- **Domain Docs**: Single-context（根目录 `CONTEXT.md` + `docs/adr/`）

配置在 `docs/agents/` 下的三个文件：
- `issue-tracker.md`
- `triage-labels.md`
- `domain.md`

## 项目初始化流程

在具体项目目录打开 Claude Code，说"帮我初始化 mattpocock skills"，会自动探测项目状态、问三个问题、写入项目级配置。项目级配置覆盖全局默认。
