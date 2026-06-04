---
name: mcp-office-tool
description: |
  办公文档处理工具。当用户需要读取文档（PDF/Word/PPT/Excel/图片→Markdown）、
  将 Markdown 导出为 PDF、预览主题效果、操作 PDF 文件（合并/拆分/加密/水印/压缩）时使用。
---

## 执行步骤

### 第 1 步：收集需求

与用户对话收集以下信息：
- **操作类型**：读取文档 / 导出 PDF / 预览主题 / 操作 PDF
- **文件**：涉及哪些文件？引导用户附加到对话中
- **主题偏好**：是否指定 PDF 风格？（neon-dark / aurora / cyberpunk / glassmorphism / minimal-web / github / book）
- **具体需求**：合并哪些 PDF？加什么水印？密码保护？

### 第 2 步：场景分类

根据以下规则自动匹配场景：

| # | 场景 | 触发条件 | 执行方式 |
|---|------|---------|---------|
| 1 | 读取文档 | 提供 PDF/Word/PPT/Excel/图片文件，要求解析/读取/提取文字 | `mineru-open-mcp:parse_documents` |
| 2 | 导出 PDF | 要求 Markdown→PDF、导出文档、生成报告等 | `md-to-pdf.mjs` + 指定主题 |
| 3 | 橱窗预览 | 要求预览/比较全部主题风格 | `md-preview.mjs` |
| 4 | 合并 PDF | 要求合并多个 PDF 文件 | `pdf-toolkit:pdf_merge` |
| 5 | 拆分 PDF | 要求提取/拆分 PDF 页面 | `pdf-toolkit:pdf_split` |
| 6 | 加密 PDF | 要求加密/密码保护 PDF | `pdf-toolkit:pdf_encrypt` |
| 7 | 加水印 | 要求给 PDF 添加文字水印 | `pdf-toolkit:pdf_add_watermark` |
| 8 | 压缩 PDF | 要求压缩/减小 PDF 大小 | `pdf-toolkit:pdf_compress` |

**复合任务检测**：若用户输入包含多个操作（如"转换这个 Markdown 并加密"），按顺序依次执行子步骤。

### 第 3 步：二次确认

向用户展示识别结果：

```text
已识别场景：[导出 PDF]，将使用 [neon-dark] 主题。
是否继续？（回复"是"继续，或指定：主题名/取消）
```

复合任务时：
```text
检测到多个操作：
  [1] 导出 PDF（neon-dark 主题）
  [2] 加密 PDF（密码保护）
是否按以上顺序执行？（是/指定顺序/取消）
```

### 第 4 步：执行

根据场景执行对应操作：

**读取文档：** 直接调用 `mineru-open-mcp:parse_documents` 工具，传入文件路径即可。不需要手动拼参数，Claude 会自动选择。

**读取后分析：** 若用户要求"总结、分析、理解文档内容"，在读取文档后，将提取的 Markdown 文本作为附件，转交给 `/mcp-baipiao` 的长文本分析流程处理。

**导出 PDF：**
```bash
node mcp-servers/office-tools/md-to-pdf.mjs 输入.md -t 主题名
```

**橱窗预览：**
```bash
node mcp-servers/office-tools/md-preview.mjs
```
生成 `themes-preview.html`，在浏览器中打开可看到全部 7 套主题的并排预览效果。

**PDF 操作：** 直接调用 `pdf-toolkit` MCP 对应工具，无需本地脚本。

### 第 5 步：返回结果

输出格式：

```text
[场景: 导出 PDF] [主题: neon-dark] [文件: output.pdf]
---
```

然后追加反馈循环：

```text
是否需要调整？可以更换主题、修改参数，或输入"完成"结束。
```
