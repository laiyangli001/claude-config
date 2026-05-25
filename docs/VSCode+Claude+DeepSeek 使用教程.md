# VSCode + Claude + DeepSeek 使用教程

## 第一步：安装基础环境与 VS Code

### 1.1 安装与学习 VS Code

目标：掌握 VS Code 的基础操作与开发环境配置。

完整阅读官方文档（不要跳步）：
https://code.visualstudio.com/docs

重点学习：安装、用户界面、编辑技巧、调试、版本控制集成。

扩展配置：

- 安装 VS Code 扩展市场中的插件：主题、格式化工具、调试器、语言支持等。
- （可选）设置 GitHub Copilot，体验 AI 辅助编码。

快速上手：跟随 VS Code 官方入门教程，熟悉快捷键、命令面板、终端等核心功能。

### 1.2 安装 Git + Node.js + TypeScript

打开终端（CMD 或 PowerShell），执行以下命令克隆配置仓库并一键安装开发环境：

```bash
git clone https://github.com/laiyangli001/claude-config.git ~/.claude
cd ~/.claude
install-env.bat
```

`install-env.bat` 会自动检测并安装以下组件（已安装的会跳过）：

- **Git** — 版本控制
- **Node.js LTS** — JavaScript 运行时
- **TypeScript** — 全局安装（`npm install -g typescript`）

安装完成后关闭并重新打开终端，确保环境变量生效。

---

## 第二步：安装中文语言包（汉化）

在扩展商店中搜索并安装以下插件，安装后重启 VS Code：

- **名称**：Chinese (Simplified) (简体中文) Language Pack for Visual Studio Code
- **ID**：MS-CEINTL.vscode-language-pack-zh-hans
- **发布者**：Microsoft

提示：安装后点击右下角"重启"即可生效。

---

## 第三步：安装 Claude Code for VS Code

在扩展商店中搜索并安装：

- **名称**：Claude Code for VS Code
- **ID**：Anthropic.claude-code
- **发布者**：Anthropic

该扩展让您无需离开 IDE 即可使用 Claude Code 的全部能力。

---

## 第四步：配置 Claude Code 扩展

打开 VS Code 设置：
文件 → 首选项 → 设置 → 搜索 `claude code` → 点击 **在 settings.json 中编辑**。

在 settings.json 中添加以下两行（替换 xxxx 为实际值）：

```json
{
  "name": "ANTHROPIC_BASE_URL",
  "value": "https://xxxx"
},
{
  "name": "ANTHROPIC_AUTH_TOKEN",
  "value": "xxxx"
}
```

注意：这两项是基础配置，下一步我们将使用 DeepSeek API 作为后端，届时会覆盖这些值。

---

## 第五步：获取 DeepSeek API Key

1. 访问 DeepSeek 官网，点击 **API 开放平台**，使用手机号注册账号。
2. 登录后，进入 API Keys 页面，点击 **创建 API key**，填写名称并生成。
3. 复制并保存生成的 API Key（格式如 `sk-xxxx`）。

推荐在账户内 **充值少量余额**（DeepSeek 当前价格优惠，Flash 模型非常便宜）。

---

## 第六步：安装 cc-switch 并配置 DeepSeek 后端

cc-switch 是一个第三方工具，用于切换 Claude Code 的后端模型提供商。

从 GitHub 下载并安装：
https://github.com/farion1231/cc-switch/releases

运行 cc-switch，点击右上角的 **+** 号添加配置。

选择 **DeepSeek**，在 API Key 处粘贴你保存的 DeepSeek API Key。

模型选择（滚动下拉菜单到对应位置）：

- 推荐使用 `deepseek-v4-flash[1m]`（性价比高，编程任务足够）
- 也可选 `deepseek-v4-pro[1m]`（性能略好，未来可能降价）

> ⚠️ 注：DeepSeek 官方模型名为 `deepseek-chat` 或 `deepseek-coder`，此处示例名称可能为第三方工具的自定义映射，请以 cc-switch 实际提供的列表为准。如果找不到，可选择 `deepseek-chat`。

将以下完整配置复制到 cc-switch 的编辑框中：

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
  "permissions": {
    "allow": [
      "mcp__chatgpt__ask_chatgpt",
      "mcp__deepseek__ask_deepseek"
    ]
  },
  "output_config": {
    "effort": "high/max"
  },
  "includeCoAuthoredBy": false,
  "effortLevel": "xhigh"
}
```

请将 `ANTHROPIC_AUTH_TOKEN` 的值替换为你自己的 DeepSeek API Key，`USER` 和 `USERNAME` 可改为你的名字。

---

## 第七步：安装 Find Skills 和 Skill Creator

这两个工具可以增强 Claude 对特定任务的处理能力。

### 安装 Find Skills

- 官方介绍：https://www.skills.sh/vercel-labs/skills/find-skills
- 中文说明：https://ai-bot.cn/find-skill/
- 安装方法：在 VS Code 的 Claude 对话中发送消息："帮我安装 find-skills"，并将上述网址发给 Claude，它会自动完成安装。

### 安装 Skill Creator

- GitHub 仓库：https://github.com/plabzzxx/skill-creator-claude/blob/master/README_CN.md
- 安装方法：同样在 Claude 对话中发送："帮我安装 skill creator"，并附上该网址。

使用方式：以后你可以直接向 Claude 提出需求，例如："帮我找编写 PPT 的 skill"，它会自动搜索、安装并告知使用命令。

---

## 第八步：Claude Code 使用技巧与高效协作指南

在开始之前，建议先观看此视频教程（B 站）：
https://www.bilibili.com/video/BV1NvRyBzEhq/

### 基础操作

1. 在 VS Code 中打开一个项目文件夹。
2. 点击左侧活动栏的 Claude 图标（聊天界面）。
3. 输入你的需求（提示词），即可与 Claude 对话。

> 💡 **提示词优化技巧**：如果你的需求描述不够清晰，可以先将问题发给 DeepSeek（官网或 API），让它帮你优化成适合 Claude 的提示词。AI 之间更懂彼此，能极大减少 Token 浪费和反复修改。

> 💡 **Plan Mode（计划模式）**：在让 Claude 实际编写代码前，先选择 Plan Mode。让它先输出一份实现计划，你确认无误后再执行——磨刀不误砍柴工。

---

### 五项核心技能：从"让 AI 写代码"到"高质量协作"

#### 1. 提示词工程：模糊意图 → 精确指令

好提示的公式：**角色 + 上下文 + 约束 + 输出格式**

在 VSCode 中实践：

- **设定人格**："你是一位资深 TypeScript 开发者，遵循 Google TypeScript Style Guide"
- **引用代码**：使用 `@file:组件名.tsx` 或直接粘贴代码并指明路径
- **给出约束**："使用 React 18 的 useId()，不要用 Math.random()"
- **指定输出**："请输出 diff 格式的修改，并注释每处变更的原因"

示例模板：

```
你是一位注重性能的前端工程师。
在 @/components/ProductList.tsx 中，列表渲染目前使用 map，请改成虚拟滚动。
使用 react-window 库，保留现有筛选逻辑。
输出完整修改后的文件，并解释为什么虚拟滚动能提升性能。
```

#### 2. 上下文管理：让 AI 看懂项目全貌

核心做法：喂给 Claude 的信息越接近"实时开发快照"，答案越可落地。

在 VSCode 中操作：

- **附加文件夹**：`@folder:src/services` 让 Claude 了解模块依赖
- **手动总结架构**：一开始就说清楚技术栈，例如："本项目是 Next.js 14 App Router，数据获取用 Server Components，API 层用 tRPC，数据库是 PostgreSQL + Prisma"
- **及时清理对话**：完成一个功能后新建对话，只注入新任务相关的上下文
- **传递真实错误**：把终端错误栈、`tsc --noEmit` 结果直接发给 Claude

**推荐做法**：在项目根目录创建 `AI.md` 文件，内容示例：

```markdown
# 项目上下文

- 框架：Next.js 14 (App Router)
- 语言：TypeScript 严格模式
- 状态管理：Zustand + React Query
- 样式：Tailwind CSS + Radix UI
- 测试：Vitest + Testing Library
- 包管理：pnpm
- 约定：所有组件必须拆分客户端和服务端逻辑
```

每次对话时让 Claude 先读取这个文件（或通过插件自动注入），效率翻倍。

#### 3. 任务分解：大功能拆解为可验证的小步骤

原则：大任务容易产生看似完整但漏洞百出的代码，拆解后再逐步构建。

协作流程：

1. **需求澄清**：先说"我想实现用户邀请功能，请先帮我设计 API 路由和数据库模型，不要写代码"。确认后再继续。
2. **桩实现**：让 Claude 生成接口类型和空函数，你填充关键逻辑。
3. **逐步实现**：
   - 第一步："实现 POST /api/invite，接收邮箱，检查是否已注册，生成 token 并存入数据库"
   - 第二步："实现发送邀请邮件的服务，用 Resend，并在上一步路由里调用"
   - 第三步："实现接受邀请的页面，校验 token，更新用户角色"
4. **每步后审查**：用 Git 暂存每步成果，确保始终处于可工作状态。

对话技巧：

- 每次只给一个明确的小任务，末尾加上"请只实现这部分，不要提前扩展其他功能"
- 每步完成后让 Claude 总结做了什么，并问"下一步我们可以实现什么？"

#### 4. 代码审查：让 AI 成为实时 Reviewer

应用场景：

- **可读性**：选中代码后问："这段代码有哪些可读性问题？如何用早期返回简化嵌套？"
- **性能审查**："这个 React 组件中，handleScroll 函数是否应该用 useCallback 或 ref？分析重渲染风险并给出优化版本。"
- **安全检查**："这个 Express 路由有没有 SQL 注入风险？请用参数化查询改写。"
- **风格统一**："请检查以下代码是否符合 Airbnb JavaScript 风格指南，并给出具体修正点。"

推荐工作流：

1. 完成一个模块后，用 Git 暂存。
2. 在 VSCode 中打开 Git Diff，将整个 diff 发给 Claude："请审查本次变更，关注错误处理、边界条件和逻辑错误。"
3. 根据 Claude 的逐条评论在代码中修改。

#### 5. 测试生成：先写测试，或让 AI 补全

AI 特别擅长的部分：从函数签名或组件结构生成全面的测试用例。

实操方法：

- **根据签名生成单元测试**："为 src/utils/formatCurrency.ts 中的 formatCurrency(amount: number, currency: string): string 生成 Vitest 测试，包含正常值、0、负数、无效货币代码。"
- **组件测试**："为 src/components/SearchBar.tsx 生成 Testing Library 测试，覆盖输入交互、回车、点击搜索按钮以及防抖逻辑。"
- **持续补全**：修改功能后，把修改的函数发给 Claude："请更新对应的测试文件，确保新分支被覆盖。"
- **反向生成测试描述**：先让 Claude 列出应该测试的场景，你确认后再让它生成代码。

**高价值技巧**：当 Claude 实现完一个函数后，立即说："现在请你为这个函数生成测试用例，但不要看我刚才的实现，只根据类型和你的理解来写。" 这能暴露实现与预期的不一致，捕捉逻辑漏洞。

---

### 技能闭环总结

| 技能 | 作用 |
|------|------|
| **提示词工程** | 问得准 |
| **上下文管理** | 看得全 |
| **任务分解** | 过程可控 |
| **代码审查** | 保证质量 |
| **测试生成** | 防范回归 |

在 VS Code 中反复练习这套流程，你会从"偶尔用 AI 提效"升级为"AI 是你的资深结对伙伴"。
