# Claude Config 使用教程：MCP 服务安装与使用

## 目录

1. [简介](#1-简介)
2. [环境要求](#2-环境要求)
3. [快速安装](#3-快速安装)
4. [配置](#4-配置)
5. [MCP 服务详解](#5-mcp-服务详解)
   - [5.1 ask_chatgpt](#51-ask_chatgpt)
   - [5.2 ask_chatgpt_mirror](#52-ask_chatgpt_mirror)
   - [5.3 ask_deepseek](#53-ask_deepseek)
6. [角色系统](#6-角色系统)
7. [常见问题](#7-常见问题)
8. [维护与更新](#8-维护与更新)

---

## 1. 简介

`claude-config` 是一个 Claude Code 全局配置仓库，包含三个免费的 MCP（Model Context Protocol）服务。这些服务通过浏览器自动化访问 ChatGPT、镜像站和 DeepSeek 的网页版，**调用时不消耗 API token**。

### 包含的服务

| 服务 | 工具名 | 来源 | 用途 |
|------|--------|------|------|
| ChatGPT | `ask_chatgpt` | chatgpt.com | 优先使用的通用 AI 助手 |
| 镜像站 | `ask_chatgpt_mirror` | chatgpt.2233.ai | ChatGPT 的国内可访问替代 |
| DeepSeek | `ask_deepseek` | chat.deepseek.com | 备选，国内可直接访问 |

---

## 2. 环境要求

- **Node.js 18+** — [下载安装](https://nodejs.org/)
- **Git** — 用于克隆仓库
- **网络**：
  - `ask_deepseek`：国内网络可直接使用
  - `ask_chatgpt_mirror`：需要联网
  - `ask_chatgpt`：需要能访问 chatgpt.com（可能需要 VPN）
- **约 1.5GB 磁盘空间**（含 Chromium 浏览器约 300MB）

---

## 3. 快速安装

### 3.1 克隆仓库

```bash
git clone https://github.com/laiyangli001/claude-config.git ~/.claude
```

### 3.2 安装依赖

进入每个 MCP 服务目录，安装 Node.js 依赖：

```bash
cd ~/.claude/mcp-servers/chatgpt-mcp && npm install
cd ~/.claude/mcp-servers/deepseek-mcp && npm install
cd ~/.claude/mcp-servers/chatgpt-mirror-mcp && npm install
```

> `npm install` 会自动执行 `npx playwright install chromium` 下载 Chromium 浏览器。如果没自动下载，可手动执行。

### 3.3 手动下载 Chromium（备选）

如果 `npm install` 时没有自动下载，手动执行：

```bash
cd ~/.claude/mcp-servers/chatgpt-mcp
npx playwright install chromium
```

三个服务共用同一个 Chromium 浏览器，只需下载一次。

### 3.4 配置 settings.json

从模板复制并填入 API token：

```bash
cp ~/.claude/settings.json.example ~/.claude/settings.json
```

编辑 `settings.json`，主要修改两处：

1. 将 `sk-<your-api-token-here>` 替换为你的真实 API token
2. 可按需修改 `systemPrompt` 和 `effortLevel`

```json
{
  "systemPrompt": "你的思考过程（thinking）必须全程使用中文。",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-你的真实token",
    "ANTHROPIC_MODEL": "deepseek-v4-flash[1m]",
    ...
  }
}
```

### 3.5 配置 MCP 服务器注册

从模板复制全局 MCP 配置文件：

```bash
cp ~/.claude/claude.json.example ~/.claude.json
```

编辑 `~/.claude.json`，根据你的实际路径修正三个 MCP 服务的 `args` 中的路径：

```json
{
  "mcpServers": {
    "chatgpt": {
      "command": "node",
      "args": ["C:/Users/你的用户名/.claude/mcp-servers/chatgpt-mcp/dist/index.js"]
    },
    "deepseek": {
      "command": "node",
      "args": ["C:/Users/你的用户名/.claude/mcp-servers/deepseek-mcp/dist/index.js"]
    },
    "chatgptmirror": {
      "command": "node",
      "args": ["C:/Users/你的用户名/.claude/mcp-servers/chatgpt-mirror-mcp/dist/index.js"]
    }
  }
}
```

---

## 4. 配置

### 4.1 环境变量

在 `settings.json` 的 `env` 块中可配置以下环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHATGPT_HEADLESS` | `false` | 设为 `true` 隐藏浏览器窗口 |
| `CHATGPT_DEBUG` | `false` | ChatGPT 调试日志 |
| `DEEPSEEK_HEADLESS` | `false` | 设为 `true` 隐藏 DeepSeek 浏览器 |
| `DEEPSEEK_DEBUG` | `false` | DeepSeek 调试日志 |

### 4.2 权限白名单

在 `settings.json` 中添加以下配置可跳过工具调用确认：

```json
"permissions": {
  "allow": [
    "mcp__chatgpt__ask_chatgpt",
    "mcp__deepseek__ask_deepseek",
    "mcp__chatgptmirror__ask_chatgpt_mirror"
  ]
}
```

---

## 5. MCP 服务详解

### 5.1 ask_chatgpt

**来源：** chatgpt.com 网页版

**首次使用：**

1. 调用时自动弹出 Chromium 浏览器窗口
2. 在浏览器中手动登录你的 ChatGPT 账号
3. 登录后关闭窗口，会话信息自动保存到 `.chatgpt-chrome-profile`
4. 以后调用不再需要重新登录

**调用方式：**

在 Claude Code 对话框中直接说：

```
用 ask_chatgpt 问：今天天气怎么样？
```

或指定角色：

```
用 ask_chatgpt（角色 python_tutor）问：Python 装饰器是什么？
```

**参数说明：**

- `question`（必填）：发送给 ChatGPT 的问题
- `attachments`（可选）：上传的文件路径列表（绝对路径）
- `role`（可选）：角色文件名（不含 .md 后缀），留空则自动检测

**示例：**

```
用 ask_chatgpt 问：帮我审查这段代码 for i in range(10): print(i)
```

```
用 ask_chatgpt 附文件 C:\code\test.py 问：这个文件有什么bug？
```

**注意事项：**

- 需要能访问 chatgpt.com（可能需要 VPN）
- 每个会话自动"New chat"开始新对话
- 支持上传文件附件

---

### 5.2 ask_chatgpt_mirror

**来源：** chatgpt.2233.ai 镜像站

**首次使用：**

1. 调用时弹出 Chromium 浏览器，打开邀请码页面 `https://2233.ai/?code=FC8XHSCH`
2. **手动点击**页面上的「立即开始」按钮
3. 点击后自动打开新标签页
4. 如果未登录，在弹出页面中手动登录
5. 登录后自动跳转到对话页，代码自动检测到新标签页并接管
6. 下次调用无需重复操作

**调用方式：**

```
用 ask_chatgpt_mirror 问：1+1等于几？
```

**与 ask_chatgpt 的区别：**

| 特性 | ask_chatgpt | ask_chatgpt_mirror |
|------|-------------|-------------------|
| 访问地址 | chatgpt.com | chatgpt.2233.ai（镜像站） |
| 网络要求 | 可能需要 VPN | 需联网 |
| 首次流程 | 直接登录 | 邀请码 → 点击立即开始 → 登录 |
| 适用场景 | 优先使用 | chatgpt.com 不可用时的替代 |

**注意事项：**

- 首次使用需点击「立即开始」按钮，代码不会自动点击
- "立即开始"会打开新标签页，代码会自动检测并切换到新标签页
- 登录 session 保存在 `.chatgpt-mirror-profile`，后续复用

---

### 5.3 ask_deepseek

**来源：** chat.deepseek.com 网页版

**首次使用：**

1. 调用时自动弹出 Chromium 浏览器窗口
2. 在浏览器中手动登录 DeepSeek 账号
3. 登录后关闭窗口，会话信息自动保存到 `.deepseek-browser-profile`
4. 以后调用无需重新登录

**调用方式：**

```
用 ask_deepseek 问：用 Python 写一个快速排序
```

**注意事项：**

- 国内网络可直接访问，无需 VPN
- 支持文件上传（最大 100MB，最多 10 个文件）
- 如果 ask_chatgpt 失败，会自动回退到此服务

---

## 6. 角色系统

三个 MCP 服务都内置了角色自动检测功能。

**工作原理：**

1. 首次调用时，根据问题内容自动匹配关键词
2. 匹配到对应角色后，先发送角色模板给 AI（设定身份）
3. 再发送用户的实际问题
4. 同一会话后续调用不重复发送角色模板

**当前可用角色：**

| 角色 | 触发关键词 | 效果 |
|------|-----------|------|
| `python_tutor` | python, django, flask, pandas, 装饰器等 | Python 编程导师，教学风格回答 |

**显式指定角色：**

```
用 ask_chatgpt（角色 python_tutor）问：解释异步编程
```

**扩展角色：**

1. 在 `mcp-servers/roles/` 下新建 `.md` 文件（参考 `python_tutor.md`）
2. 在两个 MCP 服务的 `src/index.ts` 中找到 `detectRole()` 函数，添加关键词匹配
3. 重新编译 `npm run build`

---

## 7. 常见问题

### Q: 浏览器没有弹出

检查 `CHATGPT_HEADLESS` 是否被设为 `true`。如果是，改为 `false` 或删除该环境变量。

### Q: 首次调用时提示"Failed to launch browser"

Playwright Chromium 没有正确安装。手动运行：

```bash
cd ~/.claude/mcp-servers/chatgpt-mcp
npx playwright install chromium
```

### Q: ask_chatgpt 报 "Page crashed"

最常见的两个原因：
1. 没有 VPN，无法访问 chatgpt.com → 尝试使用 `ask_chatgpt_mirror`
2. 浏览器配置目录被锁定 → 结束所有 Chrome 进程后重试

### Q: ask_chatgpt_mirror 检测不到新标签页

确保在浏览器中**手动点击**了「立即开始」按钮。代码不会自动点击。

### Q: 角色模板没有生效

角色只在首次调用或切换角色时发送。如果已经是同角色会话中的第二次调用，不会重复发送。可用显式角色参数强制指定。

### Q: 更新代码后 MCP 服务还是旧行为

需要重启 VS Code（`Ctrl+Shift+P` → `Reload Window`）让 MCP 服务器重新加载。

---

## 8. 维护与更新

### 拉取最新代码

```bash
cd ~/.claude
git pull
```

### 提交本地修改

```bash
cd ~/.claude
git add -A
git commit -m "描述你的改动"
git push
```

> 推送前需要 VPN 连接。如果 push 失败，检查 VPN 是否开启并重试。

### 自行编译（改源码后）

如果修改了 TypeScript 源码，需要重新编译：

```bash
cd ~/.claude/mcp-servers/chatgpt-mcp  # 或 deepseek-mcp / chatgpt-mirror-mcp
npm run build
```

---

*文档版本 1.0 · 最后更新 2026-05-19*
