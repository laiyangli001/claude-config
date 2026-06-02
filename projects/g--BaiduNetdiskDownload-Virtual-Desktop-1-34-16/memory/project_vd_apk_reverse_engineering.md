---
name: vd_apk_reverse_engineering
description: Virtual Desktop APK 逆向提取 3D 场景资源 - 全记录
metadata: 
  node_type: memory
  type: project
  originSessionId: 62cf4779-9047-43e7-98f1-9f8fb77f285c
---

# Virtual Desktop APK 逆向工程 - 最终记录

## 结论

Virtual Desktop 的 VR 端 APK 使用 **Xenko 3.2.0.2 引擎**构建。环境贴图使用一种**私有的 BC6H 变体（格式码 0x46b）**，该格式仅在 VD 内部使用，从未开源过。所有标准 BC6H 解码器都会读出偏绿的结果。

PICO 4 Ultra 的 VR 系统阻止了 AGI/gfxreconstruct 等 GPU 调试工具注入到 VR 应用中，无法通过帧捕获获取正确的 RGBA 数据。0x46b 格式无法被逆推。

## 尝试过的方案

| 方案 | 结果 | 原因 |
|-----|------|------|
| QuickBMS xenko.bms 解包 | ✅ | bundle 结构公开 |
| Python BC3/BC7/ETC2 解码 | ❌ | 格式不匹配 |
| Python BC6H 解码 | ⚠️ 偏绿 | 标准解码器不认识 VD 变体 |
| C# Xenko 3.1 ContentManager | ❌ | 格式 0x46b 不存在 |
| C# Stride 4.x ContentManager | ❌ | 数据库格式不兼容 |
| 自编译 Xenko 3.2 源码 | ❌ | 0x46b 未开源 |
| 修改格式码 + .NET 4.8 运行时 | ❌ | DXGI 不支持 |
| AGI GPU 帧捕获 | ❌ | PICO VR 阻挡 |
| gfxreconstruct Vulkan 注入 | ❌ | PICO VR 阻挡 |

## 已有成果

- 字体纹理（无压缩 RGBA）✅ 完美导出
- 4 个 360° MP4 视频 ✅ 直接可用
- 全套 C# 提取工具源码（换 Xenko 3.2 原版 DLL 可工作）
- Xenko 3.2 源码已克隆并编译出大部分 DLL
- 2083 个 QuickBMS 解包文件

## 如果需要继续

找到 Xenko 3.2 的原始 Xenko.Graphics.dll（含 0x46b 格式的那个版本），或者找到兼容的 GPU 帧捕获方案。
