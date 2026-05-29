# 程序化生成默认房间（替代 glTF 环境模型）

## Context

用户反馈 glTF 模型太难找。当前实现中，`environment/environment.glb` 不存在时环境模型功能静默不可用。需要提供一个**开箱即用的默认房间**，当没有 glTF 文件时自动生成一个简单的 3D 房间，用户无需额外寻找模型文件。同时保留 glTF 加载能力，用户今后放入自己的 `.glb` 文件可自动覆盖。

## 方案

在 `xrviewer.py` 中添加 `_generate_default_room()` 方法，生成一个简单的房间网格（5 个面：地板、后墙、左墙、右墙、天花板），顶点格式与 `load_glb_model` 输出一致（N×8 float32），复用相同的 VAO 创建逻辑和 `_controller_prog` 渲染管线。

每个面作为独立的 primitive，使用 `tex_id = -1`（无纹理），通过 `u_base_color_factor` 设置不同的颜色。

## 修改点

### 1. 修改 `_init_env_model(self)` — 文件不存在时生成默认房间

```python
def _init_env_model(self):
    env_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'environment')
    os.makedirs(env_dir, exist_ok=True)
    path = os.path.join(env_dir, 'environment.glb')
    if os.path.exists(path):
        self._load_env_model(path)
        if self._env_model_prims:
            print(f"[OpenXRViewer] Environment model loaded ({len(self._env_model_prims)} prims)")
    else:
        print("[OpenXRViewer] No environment.glb — generating default room")
        self._generate_default_room()
```

### 2. 添加 `_generate_default_room(self)` 方法

生成一个 8m×3m×8m 的房间，中心在原点，用户站在房间中央。

**房间几何：**

| 面 | 范围 | 法线 | 颜色 |
|----|------|------|------|
| 地板 | x∈[-4,4], y=0, z∈[-4,4] | (0,1,0) | (0.20, 0.20, 0.22) 深灰 |
| 后墙 | x∈[-4,4], y∈[0,3], z=-4 | (0,0,1) | (0.30, 0.30, 0.35) 浅灰 |
| 左墙 | x=-4, y∈[0,3], z∈[-4,4] | (1,0,0) | (0.25, 0.25, 0.30) 中灰 |
| 右墙 | x=4, y∈[0,3], z∈[-4,4] | (-1,0,0) | (0.28, 0.28, 0.33) 中灰 |
| 天花板 | x∈[-4,4], y=3, z∈[-4,4] | (0,-1,0) | (0.35, 0.35, 0.40) 亮灰 |

每个面：4 个顶点 × 8 floats（px,py,pz, nx,ny,nz, u,v），6 个 indices（2 个三角形）。

Primitive 结构扩展 `color` 字段（仅用于程序化生成，glTF 加载的 prim 没有此字段）：

```python
self._env_model_prims.append({
    'vao': vao, 'vbo': vbo, 'ibo': ibo,
    'tex_key': None,
    'tri_count': 2,
    'color': (r, g, b),  # 自定义字段
})
```

### 3. 修改 `_render_env_model` — 支持 per-primitive color

```python
for prim in self._env_model_prims:
    if prim['tex_key'] and prim['tex_key'] in self._env_model_tex_cache:
        self._env_model_tex_cache[prim['tex_key']].use(location=3)
        self._controller_prog['u_use_texture'].value = 1
        self._controller_prog['u_base_color_factor'].value = (1.0, 1.0, 1.0)
    else:
        self._controller_prog['u_use_texture'].value = 0
        color = prim.get('color', (0.7, 0.7, 0.7))
        self._controller_prog['u_base_color_factor'].value = color
    prim['vao'].render(moderngl.TRIANGLES)
```

## 文件修改

只改 `Desktop2Stereo/xrviewer.py`：
- `_init_env_model()` — 增加文件不存在时生成默认房间的分支
- 新增 `_generate_default_room()` 方法
- `_render_env_model()` — 无纹理时读取 `prim.get('color')`

## 验证

1. 删除 `environment/environment.glb`（或确保不存在），启动程序
2. 按 `N` 键，应看到默认房间（5 面体：地板、墙壁、天花板）
3. 房间应正确遮挡屏幕（深度测试正常）
4. 房间内部各面可见（背面剔除已禁用）
5. FPS 面板显示 `[Env] ON`
6. 放入 `environment.glb` 后重启，glTF 模型自动替代默认房间
