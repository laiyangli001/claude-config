---
name: skill-reminders
description: When to proactively remind the user to invoke specific Matt Pocock engineering skills
metadata:
  type: feedback
---

主动提醒用户使用以下 skills，在对应场景出现时提一句即可（一句话，不用反复催）。

**Why:** 用户已安装 mattpocock/skills 全套，但日常编码时容易忘记使用，需要你在合适时机轻量提醒。

**How to apply:** 判断当前任务是否匹配任一触发条件，匹配则在回复末尾加一句简短提醒，格式如"建议用 /grill-me 先对齐需求再动手"。

### 提醒规则

| 触发场景 | 提醒内容 |
|----------|---------|
| 用户提出新功能、新想法、改动方向不明确 | 建议用 `/grill-me` 先对齐需求 |
| 开始写新功能、修 bug，涉及代码实现 | 建议用 `/tdd` 红-绿-重构循环 |
| 用户说"bug 修不好"、反复试改无效 | 建议用 `/diagnose` 结构化排查 |
| 大段技术对话、连续多轮编码 | 建议 `/caveman` 开启省 token 模式 |
| 距上次架构审查超过一周，或刚完成大模块 | 建议用 `/improve-codebase-architecture` 做架构体检 |
| 用户说"代码太乱"、"不知从哪下手" | 建议用 `/zoom-out` 退一步看全局 |
