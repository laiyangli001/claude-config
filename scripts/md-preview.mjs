#!/usr/bin/env node
// 主题橱窗：7 列并排水平滚动，高度自适应
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _r = createRequire(import.meta.url);
const katex = _r(path.resolve(__dirname, "..", "mcp-servers", "node_modules", "katex"));
const KATEX_CSS = path.resolve(__dirname, "..", "mcp-servers", "node_modules", "katex", "dist", "katex.min.css");

const THEMES_DIR = path.join(__dirname, "themes");
const SAMPLE = process.argv[2] || path.join(__dirname, "css-extract-sample.md");
const OUTPUT = "c:/Users/LaiYangLi/Desktop/themes-preview.html";

const themes = fs.readdirSync(THEMES_DIR).filter(f => fs.statSync(path.join(THEMES_DIR, f)).isDirectory());
const md = fs.readFileSync(SAMPLE, "utf-8");

// 公式渲染
const katexBlocks = [];
const mdPh = md.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
  katexBlocks.push(katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false }));
  return `<!--KB${katexBlocks.length - 1}-->`;
});
const markedHtml = execSync("node " + path.join(__dirname, "..", "mcp-servers", "node_modules", "marked", "bin", "marked.js"), {
  input: mdPh, encoding: "utf-8", timeout: 5000
}).trim();
const htmlBody = markedHtml.replace(/<!--KB(\d+)-->/g, (_, i) => katexBlocks[parseInt(i)] || "");

// 生成每个主题
const themeCards = themes.map(theme => {
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
  tpl = tpl.replace("</head>", `<style>${fs.readFileSync(KATEX_CSS, "utf-8")}</style></head>`);
  const escaped = tpl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div class="col"><div class="label">${theme}</div><div class="page"><iframe srcdoc="${escaped}" scrolling="no"></iframe></div></div>`;
});

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;}
body{margin:0;padding:16px;background:#d8d8d8;font-family:sans-serif;}
h1{font-size:18px;margin:0 0 16px;color:#333;text-align:center;}
body{overflow-x:auto;}
.row{display:flex;gap:16px;padding:0 0 24px 0;flex-wrap:nowrap;}
.col{flex:0 0 320px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);}
.label{font-size:15px;color:#333;padding:10px 12px;background:#f0f0f0;border-bottom:1px solid #ddd;text-align:center;font-weight:600;}
.page{width:100%;overflow:hidden;}
.page iframe{width:600px;border:none;display:block;transform-origin:0 0;}
</style></head><body>
<h1>&#x1F58C; 主题橱窗 <span style="font-size:13px;color:#888;font-weight:400;">（左右滑动查看）</span></h1>
<div class="row">${themeCards.join("\n")}</div>
<script>
(function(){
var n = document.querySelectorAll("iframe").length;
function check(){
  if(--n > 0) return;
  document.querySelectorAll("iframe").forEach(function(f){
    try {
      var h = (f.contentDocument || f.contentWindow.document).body.scrollHeight;
      var s = f.parentElement.offsetWidth / 600;
      var pg = f.parentElement;
      f.style.height = h + "px";
      f.style.transform = "scale(" + s + ")";
      pg.style.height = Math.ceil(h * s) + "px";
    } catch(e){}
  });
}
document.querySelectorAll("iframe").forEach(function(f){
  if(f.contentDocument && f.contentDocument.readyState === "complete") check();
  else f.onload = check;
});
setTimeout(check, 2000);
})();
</script>
</body></html>`;

fs.writeFileSync(OUTPUT, html, "utf-8");
console.log("Done: " + OUTPUT);
