---
name: xrviewer-latest-state
description: xrviewer.py 最新修改状态（2026-05-12 晚间在家电脑完成）
metadata: 
  node_type: memory
  type: project
  originSessionId: 86e68d50-e180-47c2-93fb-799430b110f1
---

# xrviewer.py 最新修改状态

## 保留的修改列表（共11项）

1. **曲线屏 VBO 缓存** — `_render_border` + `_render_eye`
2. **beam_setup 缓存** — `_render_lasers` + `_render_laser_hit_circles`
3. **CPU mipmap 优化** — `_update_frame` CPU 路径
4. **手柄模型位置偏移** — `_render_controllers`（Z=-0.02, Y=-0.03）
5. **射线起点同步** — 三处（`_laser_beam_setup`, `_beam_origin_dir`, `_handle_keyboard_input`）
6. **射线加粗** — `BEAM_R` 0.003 → 0.004（直径 8mm）
7. **射线高度降低** — 0.03 → 0.020（降 10mm）
8. **射线前移** — 0.08 → 0.11（前移 3cm）
9. **射线不透明** — alpha 0.7 → 1.0
10. **渲染顺序调整** — 手柄模型→键盘之后，射线→最上层
11. **命中圆环恢复** — `_render_laser_hit_circles` 函数体补全

**Why:** 这是家里电脑上实际运行的最终版本，与公司电脑上的版本可能不同。
**How to apply:** 公司电脑上的 xrviewer.py 需对比更新以上11项差异。
