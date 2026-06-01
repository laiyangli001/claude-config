# 删除"双摇杆同时单击→FPS面板"绑定

## Context

用户认为双手同时按下摇杆 0.5s 来开关 FPS/帮助面板的操作不实用——双摇杆同时按本身就不方便，而且已有 Menu 键短按（单键）实现完全相同的功能。删除此绑定以简化按键映射，避免冗余。

## 修改内容

### 1. CONTROLLER_BINDINGS.md
- 删除"深度与视觉"表格中的行：`双手 | 双摇杆同时单击 | 同时按住 0.5s | 开关 FPS/帮助面板`

### 2. xrviewer.py
删除以下相关代码段：
- **变量初始化**：`self._both_stick_start`、`self._both_stick_fired`
- **输入处理逻辑**（`_poll_controller_input` 中）：
  - `lsc_now`/`rsc_now` 读取后对 `both_clicked` 的检查
  - 双摇杆同时按 0.5s 后触发 `_fps_overlay_visible` 切换
  - 双摇杆按下时对单摇杆长按的抑制逻辑（`self._lsc_long_fired`/`self._rsc_long_fired`）
- 关联注释

### 3. 验证
- Python 语法检查通过
- CONTROLLER_BINDINGS.md 预览无语法错误
