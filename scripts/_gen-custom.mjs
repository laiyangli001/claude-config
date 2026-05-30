import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import os from "os";

const _r = createRequire(import.meta.url);
const { chromium } = _r("c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/playwright");
const { PDFDocument } = _r("c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/pdf-lib");

const THEMES_DIR = "c:/Users/LaiYangLi/.claude/scripts/themes";
const OUTPUT = "c:/Users/LaiYangLi/Desktop/themes-custom.pdf";
const custom = ["neon-dark", "aurora", "cyberpunk", "glassmorphism", "minimal-web"];

const SAMPLE = `# Custom Themes

展示 5 套自定义网页风格主题

## 正文排版

**粗体** *斜体* \`代码\`

| 项目 | 价格 |
|------|------|
| 设计 | 100 |
| 开发 | 200 |

\`\`\`python
def hello():
    return "world"
\`\`\`

> 引用块

- 列表 A
- 列表 B`;

const htmlBody = execSync("node c:/Users/LaiYangLi/.claude/mcp-servers/node_modules/marked/bin/marked.js", {
  input: SAMPLE, encoding: "utf-8", timeout: 5000
}).trim();

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-"));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (let i = 0; i < custom.length; i++) {
    const theme = custom[i];
    const themeDir = path.join(THEMES_DIR, theme);
    let html = fs.readFileSync(path.join(themeDir, "page.html"), "utf-8");
    html = html.replace(/<link[^>]*{{asset '([^']+\.css)'}}[^>]*\/?>/g, (_, f) => {
      const p = path.join(themeDir, "assets", path.basename(f));
      return fs.existsSync(p) ? "<style>" + fs.readFileSync(p, "utf-8") + "</style>" : "";
    });
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    html = html.replace(/{{asset '[^']+'}}/g, "");
    html = html.replace("{{title}}", theme);
    html = html.replace("{{{content}}}", htmlBody);
    html = html.replace("{{~> content}}", htmlBody);
    html = html.replace("{{> content}}", htmlBody);
    html = html.replace("{{content}}", htmlBody);
    html = html.replace(/\{\{[~>\s]*\w+\s*\}\}/g, "");
    html = html.replace("</head>", "<style>@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>");

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
