---
name: debug-send-to-chatgpt
description: debug 一遍不成功就送 ChatGPT，不硬扛。优先 ask_chatgpt，失败回退 ask_deepseek
metadata:
  type: feedback
---

debug 一遍不成功 → 直接送外援。不硬扛，不浪费 token。

**Why:** 今天 _sync_to_gui 的换行符被吃 bug，自己分析 2 小时找不到 root cause，ChatGPT 10 秒定位。跨行二次 sync 重复插入 width 也是 ChatGPT 发现。硬扛效率极低。

**How to apply:**
- 优先 ChatGPT（`ask_chatgpt`），失败自动回退 DeepSeek（`ask_deepseek`）
- 附件带完整源码，问题描述含：正常流程、错误现象、关键代码段
- 外援给方案后先在独立测试脚本验证，再合入
