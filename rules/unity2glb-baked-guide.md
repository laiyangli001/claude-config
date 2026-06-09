实际上这里有一个误区：

**没有一个官方文档叫“Unity → GLB Lightmap Baking Export Specification”。**

你遇到的问题横跨 4 个独立规范体系：

| 层级       | 官方规范名称                                | 负责什么           |
| -------- | ------------------------------------- | -------------- |
| Mesh UV  | Unity Lightmap UV Generation          | Lightmap UV 生成 |
| Lightmap | Unity Global Illumination (GI) System | Lightmap 数据格式  |
| 材质       | glTF 2.0 Material Model               | GLB材质表达        |
| 导出       | Exporter Implementation Strategy      | 导出器实现          |

所以真正参考的规范其实是一组规范。

---

# 1. Unity Lightmap UV 规范

正式名字：

### Unity Manual → Generating Lightmap UVs

Unity文档里叫：

```text
Generating Lightmap UVs
```

内容包括：

```text
Non-overlapping UV charts
Pack Margin
Angle Error
Area Error
Hard Angle
```

核心规则：

```text
UV2 不重叠
UV2 在 0~1
UV2 有 Padding
UV2 可以被重新打包
```

这只是：

```text
Mesh Lightmap UV Specification
```

不是导出规范。

---

# 2. Unity GI / Lightmapping 规范

正式名字：

```text
Unity Global Illumination
```

里面包括：

```text
Baked GI
Realtime GI
Directional Lightmap
Shadowmask
Light Probe
Reflection Probe
```

你现在用的是：

```text
Baked GI
```

实际上一个 Renderer 的最终颜色：

```text
FinalColor =
Albedo
× Lightmap
× Reflection
+ Emission
+ Probe
```

很多人只烘：

```text
Albedo × Lightmap
```

然后发现导出不像 Unity。

原因就在这里。

---

# 3. glTF 2.0 规范

正式名字：

```text
glTF 2.0 Specification
```

Khronos 官方。

里面根本没有：

```text
Unity Lightmap
Unity GI
Unity Probe
```

概念。

标准材质只有：

```text
baseColor
metallic
roughness
normal
occlusion
emissive
```

所以：

```text
Unity Scene
≠
glTF Scene
```

必须转换。

---

# 4. 游戏行业真正使用的规范

这里才是关键。

行业里一般叫：

```text
Texture Baking Pipeline
```

或者：

```text
Texture Atlas Baking Pipeline
```

或者：

```text
Material Consolidation Pipeline
```

例如：

```text
Substance Painter
Simplygon
MeshBaker
xatlas
Unreal HLOD
```

全都走同一套路。

---

# 正确导出流程

真正成熟的导出器不会：

```text
原贴图 × lightmap
直接替换材质
```

而是：

```text
1. 展开新的 Bake UV

2. 生成 Atlas

3. 把所有材质重新烘到 Atlas

4. 烘焙:
   Albedo
   Lightmap
   AO
   Emission

5. Padding / Dilation

6. Mesh UV0 -> Atlas UV

7. 导出 glTF
```

这套流程行业名字叫：

```text
Texture Atlas Baking
```

或者：

```text
Scene Bake Export Pipeline
```

---

# 你当前方案的问题

你现在做的是：

```text
Renderer
    ↓
UV0
    ↓
Lightmap
    ↓
生成 Texture
    ↓
替换原材质
```

这属于：

```text
Per-Material Bake
```

不是：

```text
Atlas Bake
```

因此一定会出现：

```text
UV重复
Tiling
Offset
共享材质
Padding
Mip
Emission
```

各种问题。

---

# 如果目标是“导出一个与 Unity 视觉几乎一致的 GLB”

我会采用的规范路线是：

```text
Unity GI
        ↓
Scene Bake Pipeline
        ↓
xatlas UV Unwrap
        ↓
Texture Atlas Bake
        ↓
Dilation Padding
        ↓
glTF 2.0 Export
```

这是目前最接近工业级导出器（Simplygon、MeshBaker、Unreal Merge Actors、Blender Bake）的流程。

换句话说，你现在遇到的白边、模糊、错纹，并不是代码小 Bug，而是因为当前方案属于 **“Per Material Bake”**，而 Unity 场景级 Lightmap 导出本质上应该走 **“Atlas Bake Pipeline”**。这也是为什么越修一个问题，往往会冒出另一个问题。
