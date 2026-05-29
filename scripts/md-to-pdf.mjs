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
const { chromium } = _r(path.resolve(__dirname, "..", "mcp-servers", "node_modules", "playwright"));
const THEMES_DIR = path.join(__dirname, "themes");
const MARKED_BIN = path.resolve(__dirname, "..", "mcp-servers", "node_modules", "marked", "bin", "marked.js");

// ── 解析参数 ──
let inputFile = "";
let outputFile = "";
let themeName = "github";

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "-o" && i + 1 < process.argv.length) outputFile = process.argv[++i];
  else if (a === "-t" && i + 1 < process.argv.length) themeName = process.argv[++i];
  else if (a === "--list" || a === "-l") { listThemes(); process.exit(0); }
  else if (!a.startsWith("-")) inputFile = a;
}

if (!inputFile) {
  console.error("Usage: node md-to-pdf.mjs input.md [-o output.pdf] [-t theme] [--list]");
  console.error("  -o, --output   Output PDF path (default: input.pdf)");
  console.error("  -t, --theme    Theme name (default: github)");
  console.error("  -l, --list     List available themes");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

if (!outputFile) outputFile = inputFile.replace(/\.md$/i, "") + ".pdf";

// ── 确保主题已安装 ──
ensureThemes();

const availableThemes = fs.readdirSync(THEMES_DIR).filter(f => fs.statSync(path.join(THEMES_DIR, f)).isDirectory());
if (!availableThemes.includes(themeName)) {
  console.error(`Theme "${themeName}" not found. Available themes:`);
  listThemes();
  process.exit(1);
}

// ── 步骤 1: Markdown → HTML ──
console.log(`📝 Converting: ${inputFile}`);
const mdContent = fs.readFileSync(inputFile, "utf-8");

// 先用 marked 转成 HTML 片段
const htmlBody = execSync(`node "${MARKED_BIN}" --input "${inputFile}"`, {
  encoding: "utf-8", timeout: 10000
}).trim();

// ── 步骤 2: 套主题 ──
const themeDir = path.join(THEMES_DIR, themeName);
const themeCss = readThemeCss(themeDir);

// 从主题的 layout 文件中获取模板
const layoutFiles = fs.readdirSync(themeDir).filter(f => f.endsWith(".html"));
let layoutHtml = "";
if (layoutFiles.length > 0) {
  layoutHtml = fs.readFileSync(path.join(themeDir, layoutFiles[0]), "utf-8");
} else {
  // 默认模板
  layoutHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>{{STYLE}}</style></head><body class="markdown-body"><div class="page">{{{CONTENT}}}</div></body></html>`;
}

const fullHtml = layoutHtml
  .replace("{{STYLE}}", themeCss)
  .replace("{{{CONTENT}}}", htmlBody);

// ── 步骤 3: Playwright Chromium 渲染 → PDF ──
console.log(`🎨 Theme: ${themeName}`);
console.log(`📄 Generating PDF: ${outputFile}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(fullHtml, { waitUntil: "networkidle" });
  await page.pdf({
    path: outputFile,
    format: "A4",
    margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    printBackground: true,
  });
  console.log(`✅ PDF saved: ${outputFile}`);
} finally {
  await browser.close();
}

// ════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════

function listThemes() {
  if (fs.existsSync(THEMES_DIR)) {
    const all = fs.readdirSync(THEMES_DIR).filter(f => fs.statSync(path.join(THEMES_DIR, f)).isDirectory());
    const standard = all.filter(t => !["neon-dark","aurora","cyberpunk","glassmorphism","minimal-web"].includes(t));
    const custom = all.filter(t => ["neon-dark","aurora","cyberpunk","glassmorphism","minimal-web"].includes(t));
    console.log("Standard themes (markdown-styles):");
    for (const d of standard) console.log(`  ${d}`);
    console.log("\nCustom themes (web-style):");
    for (const d of custom) console.log(`  ${d}`);
    console.log(`\nUsage: node md-to-pdf.mjs input.md -t theme-name`);
  } else {
    console.log("No themes installed. Run script to auto-install.");
  }
}

function ensureThemes() {
  if (fs.existsSync(THEMES_DIR)) return;
  console.log("📦 Installing themes...");
  // markdown-styles 是全局安装的，从 npm 全局路径找
  const npmRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
  const src = path.join(npmRoot, "markdown-styles", "layouts");
  copyDir(src, THEMES_DIR);
  console.log(`   ${fs.readdirSync(THEMES_DIR).length} themes installed`);
}

function readThemeCss(dir) {
  // 收集所有 CSS 文件
  let css = "";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".css"));
  for (const f of files) {
    css += fs.readFileSync(path.join(dir, f), "utf-8") + "\n";
  }
  // 添加打印优化
  css += `
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { margin: 2cm; }
  pre, code { page-break-inside: avoid; }
  h1, h2, h3, h4 { page-break-after: avoid; }
}`;
  return css;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) {
      copyDir(s, d);
    } else if (item.endsWith(".css") || item.endsWith(".html")) {
      fs.copyFileSync(s, d);
    }
  }
}
