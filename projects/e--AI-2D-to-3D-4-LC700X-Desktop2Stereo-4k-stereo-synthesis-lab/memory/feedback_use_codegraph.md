---
name: feedback-use-codegraph
description: 优先使用 codegraph MCP 工具而非 Read/Grep 读取代码
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 53c22a58-3e65-4d4c-aa18-f6c15258202c
---

优先使用 codegraph MCP 工具（`mcp__codegraph__codegraph_explore`、`mcp__codegraph__codegraph_node`）读取代码，而不是 Read 或 Grep。

**Why:** codegraph 返回的源码是逐行精确的，等价于 Read，且附带调用关系。Read/Grep 是兜底方案。

**How to apply:** 需要读文件或找代码时，先用 `mcp__codegraph__codegraph_node`（已知路径）或 `mcp__codegraph__codegraph_explore`（模糊查找），确认不可用再回退到 Read/Grep。注意 tool name 要带 `mcp__codegraph__` 前缀。
