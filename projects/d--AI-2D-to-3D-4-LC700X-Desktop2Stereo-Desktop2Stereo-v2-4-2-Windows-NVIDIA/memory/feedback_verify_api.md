---
name: verify-api-before-use
description: 使用任何第三方库的常量/方法/参数前，必须先用命令行验证其是否存在
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 036aec35-765b-4b4a-9013-9e58905723e9
---

写代码引用第三方库的常量、方法、参数名时，**不确定就别猜**，花 5 秒跑命令确认。

- 熟悉的、确定存在的（如 `ft.Container`、`ft.Text`、基础颜色 `BLUE`）→ 直接用
- 不确定、没用过的（如 Material 3 新增色、冷门 API）→ 先确认再写

**Why:** `ft.Colors.SURFACE_VARIANT` 在 Flet 0.85.1 中不存在导致崩溃，凭记忆写引入 bug 比花 5 秒确认浪费更多时间。

**How to apply:** 不确定时执行 `python -c "import xxx; print(hasattr(xxx, 'YYY'))"` 确认。
