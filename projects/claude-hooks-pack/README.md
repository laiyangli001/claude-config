# Claude Hooks — MCP Guard

让 Claude Code 的 **PreToolUse 钩子**拦截内置工具调用，强制走 MCP 服务（file_system / codegraph / mineru / pdf-toolkit 等）。

## 原理

PreToolUse 钩子在每次工具调用前执行 `tool-check-hook.js`，读取 `rules.json` 判断是否拦截。命中规则的调用会被拒绝并提示改用对应的 MCP 工具。

## 快速安装

```
# 1. 解压到 ~/.claude/ 目录
#    确保 ~/.claude/hooks/ 下有 install-hooks.mjs 和 tool-check-hook.js

# 2. 让 Claude 按照 INSTALL.md 自动安装
#    对 Claude 说：「按照 INSTALL.md 自动安装 hooks」
```

Claude 会自动执行：
- 扫描 `~/.claude.json` 中的 MCP 服务
- 生成 `~/.claude/hooks/rules.json`（工具拦截规则，全局共享）
- 生成项目 `.claude/settings.local.json`（含 SessionStart + PreToolUse 钩子）
- 将 `settings.local.json` 追加到 `.gitignore`
- 通知你 Reload Window

## 添加新的 MCP 监督规则

1. 在 `install-hooks.mjs` 的 `KNOWN_MCP_RULES` 中添加映射
2. 运行 `node .claude/hooks/install-hooks.mjs --update`
3. Reload Window

## 文件说明

| 文件 | 作用 |
|------|------|
| `hooks/install-hooks.mjs` | 安装/更新脚本（ESM） |
| `hooks/tool-check-hook.js` | PreToolUse 钩子运行时（CJS） |
| `hooks/INSTALL.md` | 详细安装指南 |
| `rules.json` | **（生成）** 工具拦截规则 |
| `settings.local.json` | **（生成）** 钩子配置 |
