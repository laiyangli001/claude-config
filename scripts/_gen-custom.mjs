import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import os from "os";

const _r = createRequire(import.meta.url);
const _r2 = createRequire(import.meta.url);
const { chromium } = _r("c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/playwright");
const { PDFDocument } = _r("c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/pdf-lib");
const katex = _r2("c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/katex");

const THEMES_DIR = "c:/Users/LaiYangLi/.claude/scripts/themes";
const OUTPUT = "c:/Users/LaiYangLi/Desktop/themes-custom-v4.pdf";
const custom = ["neon-dark", "aurora", "cyberpunk", "glassmorphism", "minimal-web", "github", "book"];
const SAMPLE = fs.readFileSync("c:/Users/LaiYangLi/.claude/scripts/css-extract-sample.md", "utf-8");

// 公式占位符：KaTeX 渲染 → 占位符 → marked 转 HTML → 替换回 KaTeX
const katexBlocks = [];
const mdWithPlaceholders = SAMPLE.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
  try {
    const html = katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false });
    katexBlocks.push(html);
    return `<!--KATEXBLOCK_${katexBlocks.length - 1}-->`;
  } catch (e) {
    return `<div>公式错误: ${expr.trim().substring(0, 50)}</div>`;
  }
});
const markedHtml = execSync("node c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/marked/bin/marked.js", {
  input: mdWithPlaceholders, encoding: "utf-8", timeout: 5000
}).trim();
const htmlBody = markedHtml.replace(/<!--KATEXBLOCK_(\d+)-->/g, (_, id) => katexBlocks[parseInt(id)] || "");
console.log(`  KaTeX: ${katexBlocks.length} blocks rendered`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-"));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (let i = 0; i < custom.length; i++) {
    const theme = custom[i];
    const themeDir = path.join(THEMES_DIR, theme);
    let html = fs.readFileSync(path.join(themeDir, "page.html"), "utf-8");

    // CSS 内联：支持 assets/xxx.css 和 assets/css/xxx.css 两种路径
    html = html.replace(/<link[^>]*{{asset '([^']+\.css)'}}[^>]*\/?>/g, (_, f) => {
      // 尝试 assets/ 和 assets/css/ 两个可能目录
      const candidates = [
        path.join(themeDir, "assets", f),
        path.join(themeDir, "assets", path.basename(f)),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return "<style>" + fs.readFileSync(p, "utf-8") + "</style>";
      }
      return "";
    });
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    html = html.replace(/{{asset '[^']+'}}/g, "");

    // 添加 KaTeX CSS + 修复字体路径
    const katexCss = fs.readFileSync("c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/katex/dist/katex.min.css", "utf-8");
    const katexFontDir = "c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/katex/dist/fonts/".replace(/\\/g, "/");
    const katexCssFixed = katexCss.replace(/url\(fonts\//g, `url(file:///${katexFontDir}`);
    html = html.replace("</head>", `<style>${katexCssFixed}</style></head>`);

    html = html.replace("{{title}}", theme);
    html = html.replace("{{{content}}}", htmlBody);
    html = html.replace("{{~> content}}", htmlBody);
    html = html.replace("{{> content}}", htmlBody);
    html = html.replace("{{content}}", htmlBody);
    html = html.replace(/\{\{[~>\s]*\w+\s*\}\}/g, "");
    html = html.replace("</head>", "<style>@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}} .katex-display{overflow-x:auto;overflow-y:visible;max-width:100%}</style></head>");

    // 添加主题名称标签（插在 <body> 后）
    html = html.replace("<body>", `<body>\n<div style="font-family:sans-serif;font-size:13px;opacity:0.5;padding:12px 24px;text-align:right;">◉ ${theme}</div>`);

    await page.setContent(html, { waitUntil: "networkidle", timeout: 15000 });
    await page.pdf({ path: path.join(tmpDir, `p${i}.pdf`), format: "A4", printBackground: true, margin: { top: "5mm", bottom: "5mm" } });
    console.log(`  ${i + 1}. ${theme}`);
  }

  const merged = await PDFDocument.create();
  for (let i = 0; i < custom.length; i++) {
    const pdf = await PDFDocument.load(fs.readFileSync(path.join(tmpDir, `p${i}.pdf`)));
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  fs.writeFileSync(OUTPUT, await merged.save());
  console.log(`✅ ${OUTPUT}`);
} finally {
  await browser.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
