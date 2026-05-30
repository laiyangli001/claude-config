#!/usr/bin/env node
// 逐个渲染每套主题 -> 单独 PDF -> 合并 -> 删除临时文件
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createRequire } from "module";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _r = createRequire(import.meta.url);
const { chromium } = _r(path.resolve(__dirname, "..", "mcp-servers", "node_modules", "playwright"));

const THEMES_DIR = path.join(__dirname, "themes");
const OUTPUT = path.resolve(process.cwd(), process.argv[2] || "themes-showcase.pdf");

const SAMPLE = `# 标题一

正文内容，展示字体和排版。**粗体**、*斜体*、\`代码\`。

## 表格

| 项目 | 价格 | 数量 |
|------|------|------|
| 苹果 | 5.00 | 10 |
| 香蕉 | 3.50 | 20 |

\`\`\`python
def hello():
    return "world"
\`\`\`

> 引用块。

- 无序列表
- 第二项`;

const htmlBody = execSync(`node "${path.resolve(__dirname, "..", "mcp-servers", "node_modules", "marked", "bin", "marked.js")}"`, {
  input: SAMPLE, encoding: "utf-8", timeout: 10000
}).trim();

const themes = fs.readdirSync(THEMES_DIR).filter(f => fs.statSync(path.join(THEMES_DIR, f)).isDirectory());

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "themes-"));
console.log(`🎨 ${themes.length} themes, generating...`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (let i = 0; i < themes.length; i++) {
    const theme = themes[i];
    const themeDir = path.join(THEMES_DIR, theme);
    const assetsDir1 = path.join(themeDir, "assets", "css");  // 有的在 assets/css/
    const assetsDir2 = path.join(themeDir, "assets");          // 有的直接在 assets/
    const assetDir = fs.existsSync(assetsDir1) ? assetsDir1 : assetsDir2;

    // 读取布局模板
    let html = fs.readFileSync(path.join(themeDir, "page.html"), "utf-8");

    // 替换 asset CSS 引用为内联 style
    html = html.replace(/<link[^>]*{{asset '([^']+\.css)'}}[^>]*\/?>/g, (_, f) => {
      const cssPath = path.join(assetDir, path.basename(f));
      if (fs.existsSync(cssPath)) return `<style>${fs.readFileSync(cssPath, "utf-8")}</style>`;
      return "";
    });

    // 移除 script 标签和剩余 asset 引用
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    html = html.replace(/{{asset '[^']+'}}/g, "");

    // 替换 Handlebars 模板标签（先替换 content，再清剩余）
    html = html.replace("{{title}}", theme);
    html = html.replace("{{{content}}}", htmlBody);
    html = html.replace("{{~> content}}", htmlBody);
    html = html.replace("{{> content}}", htmlBody);
    html = html.replace("{{content}}", htmlBody);
    html = html.replace(/\{\{[~>\s]*\w+\s*\}\}/g, "");

    // 打印时保留颜色
    html = html.replace("</head>", "<style>@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>");

    await page.setContent(html, { waitUntil: "networkidle", timeout: 15000 });

    const pdfFile = path.join(tmpDir, `p${i}.pdf`);
    await page.pdf({ path: pdfFile, format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "10mm", right: "10mm" } });
    process.stdout.write(`  ${i+1}. ${theme}\n`);
  }

  // 用 pdf-lib 合并（从 mcp-servers node_modules 加载）
  console.log("Merging...");
  const { PDFDocument } = _r(path.resolve(__dirname, "..", "mcp-servers", "node_modules", "pdf-lib"));

  const mergedPdf = await PDFDocument.create();
  for (let i = 0; i < themes.length; i++) {
    const pdfBytes = fs.readFileSync(path.join(tmpDir, `p${i}.pdf`));
    const pdf = await PDFDocument.load(pdfBytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    for (const p of pages) mergedPdf.addPage(p);
  }
  fs.writeFileSync(OUTPUT, await mergedPdf.save());
  console.log(`✅ ${OUTPUT}`);
} catch (e) {
  console.error("Error:", e.message);
} finally {
  await browser.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
