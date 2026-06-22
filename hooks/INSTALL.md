# Hook 安装指南

给 Claude Code 安装 PreToolUse 钩子，强制使用 MCP 替代内置工具。

## 安装步骤

```
# 1. 解压到 ~/.claude/ 目录
# 2. 让 Claude 按照 INSTALL.md 自动安装
#    对 Claude 说：「按照 INSTALL.md 自动安装 hooks」
```

---

## 为什么用这个 Hook

Claude Code 有多个方式访问文件：内置 `Read``Write``Edit``Glob`、Bash 的 `cat/echo/sed`、以及 MCP 的 `file_system``codegraph`。

入口太多导致三个问题：

- **token 浪费** — 同样的文件用 Read 读了一遍，下次又要重新加载
- **路径幻觉** — 内置工具容易编造不存在的路径，MCP 工具有严格的文件系统边界限制
- **行为不一致** — 同一个项目里有时用 Read、有时用 cat、有时用 file_system，调试时很难确定是哪个工具出的问题

**这个 Hook 强制统一入口：**

| 操作 | 统一走 MCP | 不再用 |
|------|-----------|--------|
| 读文件 | `file_system read_text_file` | `Read` / `cat` / `head` / `tail` |
| 写文件 | `file_system write_file` | `Write` / `echo >` |
| 改文件 | `file_system edit_file` | `Edit` / `sed` |
| 搜文件 | `file_system search_files` | `Glob` / `find` |
| 查代码 | `codegraph_explore/search/node` | `Grep` / `rg` |

所有文件操作走 `file_system`，代码搜索走 `codegraph`，行为一致、可审计、不浪费 token。

另外，你已经在用 `file_system` MCP 了（这行文字就是它读的），但每次读项目文件时系统仍然提示要不要用 Read——这本身就是混乱的证据。装了这个 Hook，混乱消失。

---

**原理**：PreToolUse 钩子在每次工具调用前执行 `tool-check-hook.js`，读取 `rules.json` 判断是否拦截。返回 `permissionDecision: "deny"` 则工具调用被阻止。

## 执行步骤

1. **安装/更新 MCP 服务**（如 `file_system`、`codegraph` 尚未配置）：
   - 读取 `~/.claude.json` 的 `mcpServers`，检查是否已存在
   - 缺少的服务请参考下文「内置映射规则」进行安装和配置

2. **运行安装脚本**：
   ```bash
   node ~/.claude/hooks/install-hooks.mjs
   ```
   脚本会自动扫描 MCP 服务、生成规则，并将 PreToolUse 钩子写入 `~/.claude/settings.json`。

3. **通知用户 Reload Window**：
   ```
   已安装完成，需要 Reload Window（Ctrl+Shift+P → Developer: Reload Window）让新代码生效。
   ```

## 更新规则

当 `~/.claude.json` 中的 MCP 服务变化后，运行：
```bash
node ~/.claude/hooks/install-hooks.mjs --update
```
之后每次启动 Claude Code，SessionStart 钩子会自动运行 `--update`，无需手动操作。

## 内置映射规则

### file_system MCP

提供文件读写、搜索等操作，替代内置的 Read/Edit/Write/Glob 和 Bash 文件命令。

**安装**：`npm install -g @modelcontextprotocol/server-filesystem`

**配置**（`~/.claude.json`）：
```json
"file_system": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project", "~/.claude"]
}
```

`args` 的最后几个参数是**允许访问的目录路径**，可以指定多个：
- 项目目录（如 `/path/to/project`）：允许读写项目文件
- 全局配置目录（如 `~/.claude`）：允许读写规则文件
- 如需让 MCP 能访问其他目录，追加路径即可

**变更路径**：直接编辑 `~/.claude.json` 中 `file_system` 的 `args`，改动后 Reload Window。

**可用工具**：

| 工具 | 用途 | 替代内置 |
|------|------|---------|
| `read_text_file` | 读文件（支持 head/tail 参数） | `Read` / `cat` |
| `read_multiple_files` | 批量读文件 | `Read` |
| `write_file` | 写文件 | `Write` / `echo >` |
| `edit_file` | 行级替换编辑（diff 格式输出） | `Edit` / `sed` |
| `search_files` | 递归搜索文件名 | `Glob` |
| `list_directory` | 列出目录内容 | `ls` |
| `get_file_info` | 获取文件元信息 | `ls -l` |
| `move_file` | 移动/重命名文件 | `mv` |
| `create_directory` | 创建目录 | `mkdir` |

### codegraph MCP

提供代码知识图谱查询，替代 Grep 搜索符号/函数/类。

**安装**：
```
# 安装 CLI（咨询开发组获取二进制或自行编译）
# 项目内初始化索引
cd /path/to/project
codegraph init
codegraph index
```

**codegraph init**：在工作目录创建 `.codegraph/` 索引数据库（SQLite）。只需执行一次。

**codegraph index**：扫描项目文件，构建符号索引。**后台自动执行**（文件变更时自动更新索引），也可以在代码变更后手动运行以加速同步。

**配置**（`~/.claude.json`）：
```json
"codegraph": {
  "type": "stdio",
  "command": "codegraph",
  "args": ["serve", "--mcp"]
}
```

**可用工具**：

| 工具 | 用途 | 替代内置 |
|------|------|---------|
| `codegraph_explore` | **主力**。查架构/流程/代码关系，一次返回多文件源码 | 多次 `Read` |
| `codegraph_node` | 查单个符号完整源码（含所有重载） | `Read` 跳转 |
| `codegraph_search` | 按名称搜函数/类/变量位置 | `Grep` 搜符号 |
| `codegraph_callers` | 查谁调用了某函数 | `Grep` 搜引用 |
| `codegraph_impact` | 查改动影响范围 | 人工追踪 |
| `codegraph_files` | 文件树（含符号统计） | `find` |

**使用原则**：
- 查代码符号定义/引用 → 优先 codegraph，不要 Grep
- codegraph 返回的源码视为已读，不再 Read 验证
- codegraph 查不到时，才降级到 Grep/Read

## 扩展映射规则（给 Claude 用）

### 新增 MCP 服务时

脚本检测到不认识的新 MCP 时会输出：
```
[NEW] 以下 MCP 服务无监督规则，需要 Claude 分析映射：
  my-custom-db
  pdf-toolkit
```

此时分析新 MCP 的工具能力，确定它替代了哪些内置工具，然后更新 `KNOWN_MCP_RULES`。

例如检测到 `my-doc-parser` 可以读文档文件：
```js
"my-doc-parser": {
  Read: { blockWhen: "extMatch:\\.(pdf|docx)$", msg: "读文档用 my-doc-parser parse，不要用 Read" },
},
```

例如检测到 `my-db-query` 可以查数据库：
```js
"my-db-query": {
  Bash: { blockWhen: "cmdMatch:^sqlite3\\s", msg: "查数据库用 my-db-query query，不要用 Bash sqlite3" },
},
```

### blockWhen 支持的条件

| 条件 | 含义 | 示例 |
|------|------|------|
| `"always"` | 总是拦截 | 适用于 Glob、Grep |
| `"inProject"` | 文件路径在项目内时拦截 | 适用于项目文件操作 |
| `"extMatch:正则"` | 文件扩展名匹配正则时拦截 | `"extMatch:\\.(pdf\|docx)$"` |
| `"cmdMatch:正则"` | Bash 命令匹配正则时拦截 | `"cmdMatch:^sqlite3\\s"` |

### 优先级

同一工具有多条规则时，按 `KNOWN_MCP_RULES` 中的顺序匹配，命中即拦截（不继续匹配后面的规则）。通常将扩展名匹配的精确规则放在前面，通用规则（如 `inProject`）放在后面。

### 配置为空 = 已知但无需监督

```js
"my-ai-chat": {},  // 标记为已知，不会输出 [NEW] 警告
```

## 手动操作步骤（无安装脚本时）

如无法运行安装脚本，按以下步骤手动操作：

1. 读取 `~/.claude.json` 的 `mcpServers`，记录已安装的 MCP
2. 根据映射关系生成 `.claude/hooks/rules.json`
3. 确保 `.claude/hooks/tool-check-hook.js` 已存在
4. 将 PreToolUse 和 SessionStart 钩子写入 `~/.claude/settings.json` 的 `hooks` 下
5. 通知用户 Reload Window
