#!/usr/bin/env node
// 橱窗式主题预览：一个 HTML 展示所有主题效果
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _r = createRequire(import.meta.url);
const katex = _r(path.resolve(__dirname, "..", "mcp-servers", "node_modules", "katex"));
const KATEX_CSS = path.resolve(__dirname, "..", "mcp-servers", "node_modules", "katex", "dist", "katex.min.css");
const KATEX_FONTS = path.resolve(__dirname, "..", "mcp-servers", "node_modules", "katex", "dist", "fonts").replace(/\\/g, "/");

const THEMES_DIR = path.join(__dirname, "themes");
const SAMPLE_FILE = process.argv[2] || path.join(__dirname, "css-extract-sample.md");
const OUTPUT = "c:/Users/LaiYangLi/Desktop/themes-preview.html";

const themes = fs.readdirSync(THEMES_DIR).filter(f => fs.statSync(path.join(THEMES_DIR, f)).isDirectory());
const md = fs.readFileSync(SAMPLE_FILE, "utf-8");

// 渲染公式
const blocks = [];
const mdPh = md.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
  blocks.push(katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false }));
  return `<!--KB${blocks.length-1}-->`;
});
const markedHtml = execSync("node " + path.join(__dirname, "..", "mcp-servers", "node_modules", "marked", "bin", "marked.js"), {
  input: mdPh, encoding: "utf-8", timeout: 5000
}).trim();
const htmlBody = markedHtml.replace(/<!--KB(\d+)-->/g, (_, i) => blocks[parseInt(i)] || "");

// 为每个主题生成带内联 CSS 的 HTML
const themePages = themes.map(theme => {
  const td = path.join(THEMES_DIR, theme);
  let tpl = fs.readFileSync(path.join(td, "page.html"), "utf-8");
  tpl = tpl.replace(/<link[^>]*{{asset '([^']+\.css)'}}[^>]*\/?>/g, (_, f) => {
    const p = [path.join(td, "assets", f), path.join(td, "assets", path.basename(f))].find(fs.existsSync);
    return p ? "<style>" + fs.readFileSync(p, "utf-8") + "</style>" : "";
  });
  tpl = tpl.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  tpl = tpl.replace(/{{asset '[^']+'}}/g, "");
  tpl = tpl.replace("{{title}}", theme);
  tpl = tpl.replace("{{{content}}}", htmlBody);
  tpl = tpl.replace("{{~> content}}", htmlBody);
  tpl = tpl.replace("{{> content}}", htmlBody);
  tpl = tpl.replace("{{content}}", htmlBody);
  tpl = tpl.replace(/\{\{[~>\s]*\w+\s*\}\}/g, "");
  // 添加 KaTeX CSS（srcdoc 中无法加载 file://，公式用 fallback 字体）
  tpl = tpl.replace("</head>", `<style>${fs.readFileSync(KATEX_CSS, "utf-8")}</style></head>`);
  // 转义 for iframe srcdoc
  const escaped = tpl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div class="theme-card"><div class="theme-label">◉ ${theme}</div><iframe srcdoc="${escaped}"></iframe></div>`;
});

const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>主题橱窗</title>
<style>
body{margin:0;padding:20px;background:#e0e0e0;font-family:sans-serif;}
h1{font-size:20px;margin:0 0 16px;color:#333;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px;}
.theme-card{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);}
.theme-label{font-size:13px;color:#666;padding:8px 14px;background:#f8f8f8;border-bottom:1px solid #e0e0e0;}
iframe{width:100%;height:600px;border:none;}
@media(max-width:600px){.grid{grid-template-columns:1fr;}}
</style></head><body>
<h1>🖌️ 主题橱窗 &mdash; ${themes.length} 套风格</h1>
<div class="grid">${themePages.join("\n")}</div></body></html>`;

fs.writeFileSync(OUTPUT, full, "utf-8");
console.log(`✅ ${OUTPUT} (${themes.length} themes)`);
