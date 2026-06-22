---
name: codegraph-first
description: HIGH PRIORITY — 查代码必须先走 CodeGraph，严禁直接 Read/Grep
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fe3f695d-1aae-4fc9-bf68-0882836c8057
---

## Trigger-Action 规则

| Trigger | Action |
|---------|--------|
| 需要找函数/类定义位置 | → `codegraph_search` |
| 需要看某个符号的完整源码 | → `codegraph_node` |
| 需要理解代码关系/流程/架构 | → `codegraph_explore` |
| 需要看谁调用了某函数 | → `codegraph_callers` / `codegraph_impact` |
| 以上都找不到时 | → 才用 Grep / Read |

## 为什么会反复犯错

- **惯性**：训练数据中 Read/Grep 是主流模式，CodeGraph 是后加的规则
- **规则密度太高**：CLAUDE.md 内容太多，关键规则被淹没
- **缺前置检查**：调用工具前没有自检「当前操作是否匹配最高优先级规则」

## 如何强制记住

每次要读代码前，先停顿想一句：「CodeGraph 能不能查到？」

**Why:** 用户因我反复不用 CodeGraph 而愤怒。这不是能力问题，是执行纪律问题。用户明确说"过两轮对话就忘脑后"。

**How to apply:** 任何涉及查代码的操作，必须先尝试 CodeGraph 工具。只有当 CodeGraph 明确查不到时（索引过期/未索引），才降级到 Read/Grep。连 Read 自己刚改过的文件也要先用 codegraph_node 试试。
