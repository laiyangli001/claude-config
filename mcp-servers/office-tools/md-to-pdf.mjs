#!/usr/bin/env node
// Markdown → 套主题 CSS → Playwright Chromium 渲染 → 漂亮 PDF
// 使用 markdown-styles 的 17 套开源主题
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createRequire } from "module";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _r = createRequire(import.meta.url);
const { chromium } = _r(path.resolve(__dirname, "..", "node_modules", "playwright"));
const katex = _r(path.resolve(__dirname, "..", "node_modules", "katex"));
const THEMES_DIR = path.join(__dirname, "themes");
const MARKED_BIN = path.resolve(__dirname, "..", "node_modules", "marked", "bin", "marked.js");
const KATEX_CSS = path.resolve(__dirname, "..", "node_modules", "katex", "dist", "katex.min.css");
const KATEX_FONTS = path.resolve(__dirname, "..", "node_modules", "katex", "dist", "fonts").replace(/\\/g, "/");

// ── 解析参数 ──
let inputFile = "";
let outputFile = "";
let themeName = "github";
let htmlOnly = false;

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "-o" && i + 1 < process.argv.length) outputFile = process.argv[++i];
  else if (a === "-t" && i + 1 < process.argv.length) themeName = process.argv[++i];
  else if (a === "--list" || a === "-l") { listThemes(); process.exit(0); }
  else if (a === "--html" || a === "-h") htmlOnly = true;
  else if (!a.startsWith("-")) inputFile = a;
}

if (!inputFile) {
  console.error("Usage: node md-to-pdf.mjs input.md [-o output.pdf] [-t theme] [-h] [--list]");
  console.error("  -o, --output   Output path (default: input.pdf/.html)");
  console.error("  -t, --theme    Theme name (default: github)");
  console.error("  -h, --html     Output HTML instead of PDF (instant preview)");
  console.error("  -l, --list     List available themes");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const ext = htmlOnly ? ".html" : ".pdf";
if (!outputFile) outputFile = inputFile.replace(/\.md$/i, "") + ext;

const availableThemes = fs.readdirSync(THEMES_DIR).filter(f => fs.statSync(path.join(THEMES_DIR, f)).isDirectory());
if (!availableThemes.includes(themeName)) {
  console.error(`Theme "${themeName}" not found. Available themes:`);
  listThemes();
  process.exit(1);
}

// ── 步骤 1: Markdown → HTML ──
console.log(`📝 Converting: ${inputFile}`);
const mdContent = fs.readFileSync(inputFile, "utf-8");

// 渲染公式（占位符方案）
const katexBlocks = [];
const mdWithPlaceholders = mdContent.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
  try {
    const html = katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false });
    katexBlocks.push(html);
    return `<!--KATEX_${katexBlocks.length - 1}-->`;
  } catch (e) {
    return `<div>公式错误</div>`;
  }
});

// marked 转 HTML
const markedHtml = execSync(`node "${MARKED_BIN}"`, {
  input: mdWithPlaceholders, encoding: "utf-8", timeout: 10000
}).trim();

// 替换回 KaTeX
const htmlBody = markedHtml.replace(/<!--KATEX_(\d+)-->/g, (_, i) => katexBlocks[parseInt(i)] || "");

// ── 步骤 2: 套主题 ──
const themeDir = path.join(THEMES_DIR, themeName);
let fullHtml = fs.readFileSync(path.join(themeDir, "page.html"), "utf-8");

// 内联 CSS：替换 {{asset 'xxx.css'}} 为内联 style
fullHtml = fullHtml.replace(/<link[^>]*{{asset '([^']+\.css)'}}[^>]*\/?>/g, (_, f) => {
  const candidates = [
    path.join(themeDir, "assets", f),
    path.join(themeDir, "assets", path.basename(f)),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return "<style>" + fs.readFileSync(p, "utf-8") + "</style>";
  }
  return "";
});

// 删除 script 标签和剩余 asset 引用
fullHtml = fullHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
fullHtml = fullHtml.replace(/{{asset '[^']+'}}/g, "");

// 替换模板占位符
fullHtml = fullHtml.replace("{{title}}", themeName);
fullHtml = fullHtml.replace("{{{content}}}", htmlBody);
fullHtml = fullHtml.replace("{{~> content}}", htmlBody);
fullHtml = fullHtml.replace("{{> content}}", htmlBody);
fullHtml = fullHtml.replace("{{content}}", htmlBody);
fullHtml = fullHtml.replace(/\{\{[~>\s]*\w+\s*\}\}/g, "");
// 添加 KaTeX CSS（含字体路径修复）
const katexCss = fs.readFileSync(KATEX_CSS, "utf-8").replace(/url\(fonts\//g, `url(file:///${KATEX_FONTS}/`);
fullHtml = fullHtml.replace("</head>", `<style>${katexCss}</style></head>`);
fullHtml = fullHtml.replace("</head>", "<style>@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}pre,code{page-break-inside:avoid}h1,h2,h3,h4{page-break-after:avoid}}</style></head>");

// ── 步骤 3: HTML 预览（免 Chromium）或 PDF ──
console.log(`🎨 Theme: ${themeName}`);
if (htmlOnly) {
  fs.writeFileSync(outputFile, fullHtml, "utf-8");
  console.log(`✅ HTML saved: ${outputFile}`);
} else {
  console.log(`📄 Generating PDF: ${outputFile}`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(fullHtml, { waitUntil: "networkidle" });
    await page.pdf({
      path: outputFile, format: "A4",
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      printBackground: true,
    });
    console.log(`✅ PDF saved: ${outputFile}`);
  } finally {
    await browser.close();
  }
}

// ════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════

function listThemes() {
  if (fs.existsSync(THEMES_DIR)) {
    const dirs = fs.readdirSync(THEMES_DIR).filter(f => fs.statSync(path.join(THEMES_DIR, f)).isDirectory());
    console.log("Available themes (" + dirs.length + "):");
    for (const d of dirs) console.log(`  ${d}`);
    console.log(`\nUsage: node md-to-pdf.mjs input.md -t theme-name`);
  } else {
    console.log("No themes installed. Run script to auto-install.");
  }
}


