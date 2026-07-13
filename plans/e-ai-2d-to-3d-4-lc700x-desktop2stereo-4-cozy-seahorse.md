# `4k-stereo-synthesis-lab` 工程审查框架

## 项目概览

基于 CodeGraph 探索结果，该项目是一个**实时双目立体视频生成与投送系统**，核心流程：

```
屏幕采集 → 深度估计 → 立体合成 → 显示/推流
```

| 维度 | 现状 |
|------|------|
| **主入口** | `src/main.py`（~1443 行，全局模块级状态） |
| **架构风格** | 过渡期：从全局脚本向模块化 + dataclass config + Protocol 演进 |
| **采集层** | 多后端策略模式（DXCamera / DesktopDuplication / ScreenCaptureKit / CoreGraphics / MSS），通过 `capture/factory.py` 工厂创建 |
| **立体流水线** | `StereoRuntime` + `runtime_config` — 核心深度/合成处理 |
| **显示层** | GLFW/StereoWindow（Viewer模式）+ OpenXR（XR模式）+ MJPEG/RTMP（推流） |
| **GUI** | `gui/` 模块，已拆分为 mixin 组件 |
| **跨平台** | Windows 主力，macOS/Linux 有后端适配 |
| **测试** | 初步：`tests/test_capture_session.py` |

---

## 一、架构审查（Architecture）

### 1.1 模块边界与职责

- **`capture/`** ✅ 良好：工厂 + Protocol + 多后端，`CaptureConfig` frozen dataclass 不可变
- **`capture/session.py`** ✅ 良好：分离了 CaptureSessionLoop 和回调接口
- **`streaming/config.py`** ✅ 良好：frozen dataclass
- **`viewer/settings.py`** ✅ 良好：frozen dataclass，依赖注入
- **`main.py`** ❌ 问题集中地：~100 个模块级变量、全局队列、线程管理、FPS 统计、热重载、信号采样全在一处

**审查点**：
- `main.py` 是否应拆分为 `app/` 模块？`runtime_loop`, `capture_loop`, `main_render_loop` 可独立为类
- 全局变量（`raw_q`, `runtime_q`, `runtime_config`, `stereo_runtime` 等）是否可封装为 `AppContext` 或 `Application` 类？
- `openxr_render_active` / `openxr_source_active` / `openxr_wait_idle_active` 等 threading.Event 数量过多，是否可合并状态机？

### 1.2 依赖方向

- `capture/` → 依赖 `utils`（OS_NAME, CAPTURE_TOOL）
- `streaming/` → 依赖 `utils/network.py`
- `viewer/` → 依赖 `utils/display.py`, `viewer/upscaler.py`, `viewer/controller_help.py`
- `main.py` → 依赖所有子模块

✅ 依赖方向清晰：utils ← 子模块 ← main

### 1.3 配置管理

- `settings.yaml` 作为持久化配置源
- 各子模块用 frozen dataclass 承载配置
- `main.py` 从 `from_d2s_settings()` 解码全局配置

**审查点**：
- `main.py` 中大量 `UPPER_CASE` 全局变量是否都可以迁移到 dataclass 中？
- 全局配置更新是否有类型校验？目前看是通过 `_apply_stereo_hot_reload_if_needed` 部分热重载

---

## 二、代码质量审查（Code Quality）

### 2.1 强项

- **类型注解**：全面使用 `from __future__ import annotations` + `TypeAlias` + `Protocol`
- **数据结构**：正确使用 `frozen=True` dataclass，不可变配置
- **性能意识**：注释中说明了 deque 代替 list.pop(0) 的原因，有 FPS 性能追踪
- **资源清理**：`finally` 块 + `cleanup_all_resources()` + `shutdown_event.set()`

### 2.2 问题区域

**A. `main.py` 全局状态过多**
```python
# 约 100 行模块级代码执行（import 时即运行）
raw_q = queue.Queue(maxsize=1)
runtime_q = queue.Queue(maxsize=1)
runtime_config = runtime_config_from_d2s_settings(...)
stereo_runtime = StereoRuntime(runtime_config)
# 大量 threading.Event、锁、统计变量...
```

❌ import side effects：`import main` 即创建立体运行时

**B. 注释与文档**
- `VIEWER_HELP_TEXT` / `XR_HELP_TEXT` 等大块字符串嵌入代码
- 控件帮助信息通过 `controller_help.py` 管理，但仍偏散乱

**C. 错误处理**
- `signal_handler` 仅 `print` + `os._exit(1)` — 应触发优雅关闭
- `main()` 外层 Exception 被注释掉：
  ```python
  # except Exception as e:
  #     print(f"[Main] Error: {e}")
  ```

**D. 重复代码**
- FPS 统计逻辑在 Viewer 模式和 Legacy 模式中重复（`main()` 内两段几乎相同的 deque + avg_fps + 1% low 计算）
- Viewer `main()` 和 `else` (Legacy) 分支共享同样的统计模式

### 2.3 未跟踪的新文件

`git status` 显示以下文件未跟踪，审查时需关注：
- `src/capture/session.py` — 已完成，应提交
- `src/streaming/rtmp.py` — 需审查
- `src/utils/breakdown.py` — 可能为 `FPSBreakdown` 类（main.py 中引用了）
- `src/utils/queue_utils.py` — 需审查
- `tests/test_capture_session.py` — 好的开始

---

## 三、可测试性审查（Testability）

### 3.1 现状

| 文件 | 可测试性 | 原因 |
|------|---------|------|
| `capture/factory.py` | ⭐⭐⭐⭐⭐ | 纯函数 + Protocol，容易 mock |
| `capture/types.py` | ⭐⭐⭐⭐⭐ | 纯数据类 |
| `viewer/settings.py` | ⭐⭐⭐⭐⭐ | 纯函数，可注入 |
| `capture/session.py` | ⭐⭐⭐⭐ | 依赖回调注入，可 mock |
| `utils/display.py` | ⭐⭐⭐ | 耦合 mss / 平台 API |
| `main.py` | ⭐ | 全局状态 + import side effects + GLFW |

### 3.2 阻塞测试的因素

1. **`main.py` 顶层代码**：import 即创建立体运行时
2. **全局队列**：模块间通过 `raw_q` / `runtime_q` 隐式耦合
3. **多线程**：`capture_loop` / `process_runtime_loop` 难以单线程测试
4. **硬件依赖**：依赖 GPU（CUDA/ROCm）、显示器、采集设备

---

## 四、性能与安全性审查

### 4.1 性能

- 队列用 `maxsize=1` 保证最新帧，避免积压 ✅
- deque + running sum 做 O(1) 滑动窗口统计 ✅
- GPU 利用率采样已有 `_sample_gpu_engine_utilization` ✅
- 视频解码 / 3D 引擎利用率采样 ✅
- 主要瓶颈：depth inference（`process_runtime_loop`），取决于模型复杂度

### 4.2 安全

- 无网络认证逻辑（RTMP stream key 仅本地使用）
- 无用户输入/注入风险（键盘/鼠标操作不涉及外部输入解析）
- 无 SQL/文件写入风险

---

## 五、审查执行步骤建议

### Step 1：模块边界审查

对每个子模块逐一回答：
- 职责是否单一？
- public API 是否清晰（`__init__.py` 暴露了什么）？
- 外部依赖是否显式注入？

### Step 2：`main.py` 拆分解耦审查

将 `main.py` 按职责拆分为候选方案评审：
- `AppContext` — 全局状态容器
- `AppOrchestrator` — 线程编排（capture_loop, process_loop, render_loop）
- `FpsTracker` / `LatencyTracker` — 统计逻辑（复用 Viewer/Legacy 两端）
- `HotReloadWatcher` — 设置热重载

### Step 3：测试覆盖审查

- 哪些模块已覆盖？缺哪些？
- 如何 mock GPU pipeline？
- 是否为 `main.py` 拆分后的新类写测试？

### Step 4：CI / 工具链审查

- `requirements.txt` / `pyproject.toml` 是否存在？
- 是否有 lint 配置？
- 构建/打包流程？

---

## 六、推荐重构优先级

| 优先级 | 项目 | 影响 |
|--------|------|------|
| P0 | `main.py` 全局状态封装为 `Application` 类 | 可测性、可维护性 |
| P1 | 重复 FPS 统计代码提取为 `FpsTracker` | 消除重复 |
| P1 | 新文件（session.py 等）提交 | 版本控制 |
| P2 | 恢复外层 Exception handler | 稳定性 |
| P2 | 分离 `StereoRuntime` 创建时机（延迟初始化） | 可测性 |
| P3 | 提取帮助文本到独立资源文件 | 模块整洁 |
