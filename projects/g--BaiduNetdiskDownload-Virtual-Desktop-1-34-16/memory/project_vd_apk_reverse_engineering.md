---
name: vd_apk_reverse_engineering
description: Virtual Desktop APK 逆向提取 3D 场景资源全过程记录
metadata: 
  node_type: memory
  type: project
  originSessionId: 62cf4779-9047-43e7-98f1-9f8fb77f285c
---

# Virtual Desktop APK 逆向提取

## 结论

VD 的 APK（Quest 端）使用 **Xenko 3.2.0.2 引擎**构建，不是 Unity。资源格式是 Xenko 私有的 KNHC/TKTX 格式，环境贴图使用一种 **私有 BC6H 变体（格式码 0x46b）**，该格式从未在开源版本中出现过。

Xenko 3.2 的开源代码（master-3.2 分支）不包含 0x46b 格式支持，Stride 4.x 也不兼容。唯一能正确解码这些纹理的是 **Xenko 3.2 的原始编译 DLL**，但该版本从未在 NuGet 上发布过。

## 已有成果

- 字体纹理（无压缩 RGBA）✅ 已完美导出
- 4 个 360° MP4 视频 ✅ 直接可用
- 全套 C# 提取工具源码 ✅
- QuickBMS 解包 + xenko.bms 脚本 ✅
- Stride 3.2 源码已克隆并编译出大部分 DLL ✅

## 关键文件位置

```
g:/BaiduNetdiskDownload/
├── bundle_extracted/          ← QuickBMS 解包的 2083 个文件
├── stride_source/             ← Xenko 3.2 源码 (master-3.2)
├── Xenko32LocalExtractor/     ← 用本地编译 DLL 的提取器 (.NET 4.8)
├── XenkoExtractor/            ← 用 NuGet 3.1 包的提取器 (.NET Core 3.1)
├── stride_export/             ← C# 数据库导出的 DDS
├── xenko31_export/            ← Xenko 3.1 导出的纹理
├── xenko32_final_export/      ← 最终导出的纹理（字体可用）
├── xs32.bms                   ← QuickBMS 解包脚本
└── QuickBMS/                  ← 解包工具
```

## 如果要继续

找到 Xenko 3.2 的原始 `Xenko.Graphics.dll` 和依赖 DLL，替换 `Xenko32LocalExtractor` 的引用即可。
