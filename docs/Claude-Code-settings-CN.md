> ## 文档索引
> 完整索引获取：https://code.claude.com/docs/llms.txt

# Claude Code 设置

> 通过全局和项目级设置以及环境变量来配置 Claude Code。

Claude Code 提供多种设置来自定义其行为。可通过 ` /config ` 命令进入交互式 REPL 配置界面。

## 配置作用域

Claude Code 使用**作用域系统**确定配置的应用范围。

| 作用域 | 位置 | 影响范围 | 共享给团队？ |
|--------|------|----------|-------------|
| **Managed** | 服务器管理设置、plist/注册表或系统级 `managed-settings.json` | 设备上所有用户 | 是（IT 部署） |
| **User** | `~/.claude/` 目录 | 你，跨所有项目 | 否 |
| **Project** | 仓库中的 `.claude/` | 所有协作者 | 是（提交到 git） |
| **Local** | `.claude/settings.local.json` | 你，仅此仓库 | 否（gitignored） |

### 各作用域适用场景

**Managed**：安全策略、合规要求、IT/DevOps 标准化配置。

**User**：个人偏好（主题、编辑器）、跨项目工具和插件、API 密钥和身份验证。

**Project**：团队共享设置（权限、hooks、MCP 服务器）、标准化工具。

**Local**：特定项目的个人覆盖、测试配置、特定机器的设置。

### 优先级

1. **Managed**（最高）— 不可被覆盖
2. **命令行参数** — 临时会话覆盖
3. **Local** — 覆盖项目和用户设置
4. **Project** — 覆盖用户设置
5. **User**（最低）— 当其他作用域未指定时生效

### 各功能的存储位置

| 功能 | 用户位置 | 项目位置 | 本地位置 |
|------|---------|---------|---------|
| **Settings** | `~/.claude/settings.json` | `.claude/settings.json` | `.claude/settings.local.json` |
| **Subagents** | `~/.claude/agents/` | `.claude/agents/` | 无 |
| **MCP servers** | `~/.claude.json` | `.mcp.json` | `~/.claude.json`（per-project） |
| **Plugins** | `~/.claude/settings.json` | `.claude/settings.json` | `.claude/settings.local.json` |
| **CLAUDE.md** | `~/.claude/CLAUDE.md` | `CLAUDE.md` 或 `.claude/CLAUDE.md` | `CLAUDE.local.md` |

Windows 上 `~/.claude` 解析为 `%USERPROFILE%\.claude`。

## settings.json

可选配置项包括：

| 键 | 说明 | 示例 |
|----|------|------|
| `permissions` | 权限规则：allow/ask/deny | `{"allow": ["Bash(git diff *)"]}` |
| `env` | 会话环境变量 | `{"FOO": "bar"}` |
| `model` | 模型覆盖 | `"claude-sonnet-4-6"` |
| `effortLevel` | 投入度：low/medium/high/xhigh | `"xhigh"` |
| `hooks` | 生命周期钩子 | 参见 hooks 文档 |
| `language` | 响应语言 | `"japanese"` |
| `enableAllProjectMcpServers` | 自动批准项目 .mcp.json 中的所有 MCP 服务器 | `true` |

### MCP 关键设置

- **`enableAllProjectMcpServers`**：设为 `true` 自动批准项目 `.mcp.json` 中的所有 MCP 服务器
- **`enabledMcpjsonServers`**：批准特定服务器列表，如 `["memory", "github"]`
- **`disabledMcpjsonServers`**：拒绝特定服务器，如 `["filesystem"]`

## 全局配置（~/.claude.json）

以下设置**存储在 `~/.claude.json` 而非 `settings.json`**：

| 键 | 说明 | 示例 |
|----|------|------|
| `autoConnectIde` | 自动连接运行的 IDE | `true` |
| `autoInstallIdeExtension` | 自动安装 IDE 扩展 | `true` |

**重要**：MCP 服务器的用户作用域配置也存储在 `~/.claude.json` 的 `mcpServers` 键中。项目作用域的 MCP 存储在 `.mcp.json`。

## 环境变量

环境变量可以不用编辑设置文件就能控制 Claude Code 行为，也可在 `settings.json` 的 `env` 键下配置。

详见[环境变量参考](https://code.claude.com/docs/en/env-vars)。

## 注意事项

- **`~/.claude.json` 包含敏感数据**（OAuth 会话、使用历史等），备份前请谨慎。
- **项目 MCP 使用 `.mcp.json`**，提交到 git 可与团队共享。
- **CLAUDE.md** 包含指令和上下文，Claude 在启动时加载。
- **Windows** 需要 `cmd /c` 包装 `npx` 命令。
- 设置文件修改后**自动重新加载**，无需重启。
- 权限规则中的数组跨作用域**合并和去重**，而非替换。
