---
name: session-persistence-guide
description: Claude Code 对话 session 保存与恢复的完整操作指南
metadata:
  type: reference
---

Claude Code 没有原生"对话另存为"按钮，以下是实用等效方案。

## 四种方式

| 方式 | 操作 | 适用场景 |
|------|------|---------|
| 对话历史 | `Ctrl+Shift+P` → `Claude Code: Show Conversation History` | 找回之前的对话，浏览和恢复 |
| `/resume` | 输入 `/resume` + 关键词描述 | 记得对话大致内容，快速定位恢复 |
| memory 文件（推荐） | 保存关键决策到 `memory/*.md` | 跨对话持久化，永久可查 |
| 手动复制 | 选中对话内容，复制保存为文本 | 临时备份，精确控制内容 |

## 推荐做法

1. **每次重要决策后**，告诉我"把这个写入记忆"——我会创建对应的 memory 文件
2. **以后新对话需要恢复**，说"帮我看看之前怎么配置的"——我会自动读 MEMORY.md 索引找到相关记忆
3. **memory 目录结构**：
   - `feedback` 类型 → 你的工作偏好和禁止事项
   - `reference` 类型 → 外部资源、配置快照、操作指南
   - `project` 类型 → 项目背景、截止日、干系人
   - `user` 类型 → 你的角色、技能水平、偏好

## 快捷指令

- "把当前配置写入记忆" → 保存当前系统/项目配置快照
- "记住这个做法" → 保存操作流程和决策理由
- "以后遇到 X 场景提醒我" → 保存为 feedback 类型
- "帮我查看关于 X 的记忆" → 读取相关记忆文件
