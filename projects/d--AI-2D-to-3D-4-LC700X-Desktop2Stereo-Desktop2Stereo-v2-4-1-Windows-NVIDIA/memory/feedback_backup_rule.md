---
name: backup-before-xrviewer-modification
description: 修改xrviewer.py前的备份规则（重大功能才备份，简单参数不需要）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 86e68d50-e180-47c2-93fb-799430b110f1
---

在对 xrviewer.py 进行**重大功能更新**时，必须：
1. 备份到 `backup/xrviewer_YYYYMMDD_HHMM.py`
2. 追加 `backup/backup_log.txt`
3. 然后再修改代码

**简单参数调整（如改一个常量值、调一个偏移量）不需要备份。**

**Why:** 用户明确要求。重大修改需保护代码，简单调参不需要额外开销。
**How to apply:** 判断修改规模：涉及多行/多函数/着色器 → 备份；单行常量/参数 → 不备份。
