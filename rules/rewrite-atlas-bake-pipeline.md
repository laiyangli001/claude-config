## 重构提示词：实现 Unity 场景全局贴图集烘焙并导出 GLB（符合工业级 Atlas Bake Pipeline）

### 背景与目标
当前 `LoadAndExport.cs` 采用 **Per-Material Bake** 方式（直接将 Lightmap 颜色乘到 Albedo 贴图上），导致导出 GLB 后出现 UV 重叠、纹理接缝、白边、模糊、丢失 Emission 等问题。  
需要按照 `unity2glb-baked-guide.md` 规范，重构为 **Texture Atlas Baking Pipeline**，使导出的 GLB 视觉与 Unity 编辑器内几乎一致。

### 必须遵循的规范路线
```
Unity GI (Baked Lightmap + Directional + Shadowmask)
        ↓
场景级烘焙管线（收集所有 MeshRenderer 与 Lightmap 数据）
        ↓
全局 UV 展开（使用 xatlas / uvpacker 生成非重叠 Atlas UV）
        ↓
贴图集烘焙（Albedo + Lightmap + AO + Emission 合并到 Atlas）
        ↓
边缘填充（Dilation / Padding，消除接缝）
        ↓
glTF 2.0 导出（新 UV0 = Atlas UV，材质替换为单材质或多材质子网格）
```

### 当前代码的主要缺陷（需重构解决）
1. **UV 复用问题**：直接使用原始 UV2（Lightmap UV）作为导出 UV0，但原始 UV2 可能重叠、超出 [0,1] 范围，无法用于 Atlas 采样。
2. **纹理空间冲突**：Per-Material 贴图保留原有 Tiling/Offset，导致同一 Atlas 中纹理重复/错位。
3. **缺乏边缘填充**：相邻 Atlas 岛屿之间无 dilation，造成 mipmap 采样时的黑边/白边。
4. **丢失 GI 分量**：未处理 Directional Lightmap（方向性）、Shadowmask、Emission 和 Light Probe 的影响，导致高光/阴影方向错误。
5. **材质爆炸**：每个物体仍保留原始材质，未合并为 Atlas 材质，无法减少 draw call。

### 重构要求（详细步骤）
#### 阶段一：场景数据收集与预处理
- 从 AssetBundle 加载场景后，遍历所有 `MeshRenderer`（带 `MeshFilter`）。
- 过滤掉不可见、静态标记未烘焙、`lightmapIndex=-1` 的物体。
- 对于每个物体，记录：
  - 原始 Mesh（顶点、UV0、UV2 等）
  - 原始材质及其贴图（`_MainTex`/`_BaseMap`、`_EmissionMap`）
  - Lightmap 索引、lightmapScaleOffset（用于 UV 变换）
  - 世界变换矩阵（因为需要烘焙到 Atlas 空间，且导出时物体 transform 归零）

#### 阶段二：全局 UV 展开（Atlas UV 生成）
- **禁止直接使用原始 UV2**。必须为所有需要导出的 Mesh 生成一套新的、不重叠的 Atlas UV（范围 [0,1]，chart 之间有 padding margin）。
- 推荐集成第三方库：`xatlas` (C# 绑定) 或 `UVPack`（如 `MeshBaker` 中的算法）。
- 输入：所有 Mesh 的世界空间顶点（或原始局部顶点 + 世界矩阵）和边信息。
- 输出：每个 Mesh 的新的 UV0 数组（长度 = 顶点数），以及整个场景的 Atlas 布局（每个物体的 UV 区域映射）。
- 注意：如果场景过大需分拆多个 Atlas（每个 Atlas 不超过 4096x4096）。

#### 阶段三：贴图集烘焙（Texture Atlas Baking）
创建 N 张 Atlas 纹理（Albedo、Lightmap、AO、Emission 可分别烘焙或合并为一张，推荐保留独立通道）：
- **Albedo Atlas**：采样原始材质的 `_MainTex`/`_BaseMap`，按新 Atlas UV 映射写入。
- **Lightmap Atlas**：采样 `LightmapSettings.lightmaps[lightmapIndex].lightmapColor`，并根据物体原有的 lightmapScaleOffset 将原始 UV2 转换为 Lightmap UV，再映射到 Atlas UV。
- **AO Atlas**：如果原始材质有 AO 贴图或 Unity 烘焙了 AO，一并采样。
- **Emission Atlas**：采样 `_EmissionMap`，并按强度缩放。

**关键处理**：
- 颜色空间：确保所有采样在 Linear 空间进行，最终导出时根据 glTF 要求转换。
- 边缘填充（Dilation）：对每个 Atlas 岛屿边缘像素向外扩展（至少 4-8 像素），使用 `texel dilation` 算法（复制最近邻有效像素或镜像填充）。
- 高精度格式：烘焙时使用 `TextureFormat.RGBA32` 或 `RGBAHalf`，避免色带。

#### 阶段四：Mesh 数据重建与导出 glTF
- 为每个物体创建新的 Mesh：
  - 顶点位置 = 原始局部位置（不世界变换），或 **烘焙世界位置后重置 transform 归零**。推荐前者：保持顶点在局部空间，导出时设置物体 transform 为单位矩阵。
  - UV0 = 阶段二生成的新 Atlas UV。
  - 其余属性（法线、切线、UV1 等）可保留原始数据（若需要）。
- 材质：生成一个新的 `Material`（使用 glTF 标准 PBR 属性），其纹理设置为烘焙后的 Atlas 纹理，以及对应的 metallic/roughness 等参数（可从原始材质平均或选择主要材质）。
  - 若场景材质种类过多且需要保持独立外观，可使用子网格（submesh）+ 多材质，但推荐完全合并为单材质（利用 Atlas UV 不同区域采样同一纹理）。
- 导出：调用 `GLTFSceneExporter` 或自定义导出器，将根节点下的所有重建物体（transform 归零）导出为一个 `.glb` 文件。

#### 阶段五：验证与调试
- 在外部查看器（如 Babylon.js Sandbox, three.js editor）中检查：
  - 纹理接缝是否消失（使用 mipmap 也正常）
  - 光照是否与 Unity 内一致（尤其是金属/粗糙表面的高光形状）
  - Emission 是否自发光
- 如果出现颜色偏差，检查 gamma/linear 转换和 Lightmap 的解码方式（Unity 通常存储为 gamma，采样时需转换）。

### 代码实现约束
- 兼容 Unity 2022.3，编辑器环境（不依赖运行时烘焙）。
- 必须使用现有的 `RuntimeLightmapBaker.BakeAll()`？不，应直接读取 `LightmapSettings` 中已存在的 Lightmap 数据（假设场景已提前烘焙好）。如果场景未烘焙，则先触发 `Lightmapping.Bake()` 并等待完成。
- 考虑性能：For 循环中避免每帧 `GetPixels`，使用 `Graphics.CopyTexture` 或并行 Compute Shader 加速（可选）。
- 依赖库：可通过 nuget 或 Unity Package 引入 `xatlas` (GitHub: `zeux/xatlas`，有 C# 封装) 或使用 `UnityEngine.U2D.Package` 中的 UV packer。

### 输出期望
重构后的脚本应包含以下核心函数（示例）：
```csharp
public class SceneAtlasBaker : MonoBehaviour {
    void BakeAndExport();
    List<AtlasData> GenerateGlobalAtlasUV(List<MeshRenderer> renderers);
    Texture2D BakeAlbedoAtlas(List<MeshRenderer> renderers, Vector2[] atlasUVs, Rect[] uvRects);
    Texture2D BakeLightmapAtlas(...);
    void Dilation(Texture2D tex, int padding);
    void ExportGlbWithAtlas(GameObject root, List<MeshData> meshData, Texture2D[] atlasTextures);
}
```

### 注意事项
- **不要**试图在单个脚本中一次性完成所有功能而不测试中间结果。建议分阶段实现并验证。
- 若场景包含大量顶点（>100k），需考虑分批处理或使用 Job System/Burst。
- 对于混合有烘焙静态物体和动态物体的场景，动态物体应使用 Light Probe 采样，导出时需特殊处理（转化为顶点光照或生成 Probe 数据到自定义纹理）。
- 最终 GLB 文件应保持合理的文件大小（纹理压缩可使用 `Texture2D.EncodeToPNG` 或 `EncodeToKTX`）。

--- 

以上提示词可作为开发者任务说明或 AI 重构指令。请严格按照 Atlas Baking Pipeline 重写 `LoadAndExport.cs`，删除原有的 `BakeLightmapIntoAlbedo` 及其相关逻辑。