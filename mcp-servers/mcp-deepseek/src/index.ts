import { chromium, BrowserContext, Page } from "playwright";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import { launchBrowser, navigateWithToast, withRetry, isTransientError, closeBrowser } from "../../shared/browser.mjs";
// @ts-ignore
import { waitForAnswer, extractNewAnswers, waitForNewMessage, setupPageErrorMonitor, showToast } from "../../shared/answer.mjs";
// @ts-ignore
import { uploadFiles } from "../../shared/upload.mjs";
// @ts-ignore
import { loadTemplate } from "../../shared/role.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".deepseek-browser-profile");
const SITE_URL = "https://chat.deepseek.com/";
const HEADLESS = process.env.DEEPSEEK_HEADLESS === "true";
const TEMPLATES_DIR = path.resolve(__dirname, "../../shared/templates");

const INPUT_SEL = 'textarea, [contenteditable="true"]';
const STOP_BTN_SEL = 'button:has-text("Stop"), button:has-text("停止"), [aria-label*="stop" i], [aria-label*="Stop"], [aria-label*="停止"]';
const ANSWER_SEL = '.ds-assistant-message-main-content, .ds-markdown.ds-assistant-message-main-content, [data-testid="assistant-message"], .chat-message-assistant';
const SEND_BTN_SEL = 'button[type="submit"], button:has-text("Send"), button:has-text("发送")';
const LOGIN_BTN_SEL = 'button:has-text("Log in"), button:has-text("Sign in"), a:has-text("Log in")';

const CODE_MODIFY_RE = /写代码|帮我写|修复|改\b|修改|重构|优化|实现|加个|删掉|替换|调整|改下|修下|补一下|添加|移除|fix(?:ing|es)?|implement(?:s|ing|ed)?|refactor(?:s|ing|ed)?|modify(?:ing|ed)?|change[sd]?|updat[esd]|rewrite[sdn]?|correct(?:s|ing|ed)?|add[sd]?|remov[esd]|delet[esd]|replac[esd]|optimiz[esd]|patch(?:es|ing|ed)?|debug(?:s|ing|ed)?|(?:write|code)\s+(?:this|the|some|a|code)|review\s+this\s+(?:code|file)/i;
const EXPLAIN_ONLY_RE = /解释|说明|分析原因|为什么|是什么|怎么回事|什么意思|作用|原理|how\s+does|what\s+does|explain|clarify/i;
const CONSTRAINTS = `【强制约束】\n1. 最小修改原则：只改 bug 相关行。\n2. 禁止编造。\n3. 安全红线。`;

let browserContext: BrowserContext | null = null;
let page: Page | null = null;
let isPageReady = false;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

let cleaning = false;
function cleanup() {
  if (cleaning) return;
  cleaning = true;
  process.exitCode = 0;
  const ctx = browserContext;
  Promise.race([(async () => { if (ctx) await closeBrowser(ctx); })(), new Promise(r => setTimeout(r, 15000))])
    .finally(() => setTimeout(() => process.exit(), 200));
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

async function ensureBrowser() {
  if (browserContext && page && !page.isClosed() && isPageReady) { try { await page!.bringToFront(); } catch {} return { page, context: browserContext }; }
  if (browserContext) await closeBrowser(browserContext);
  browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS);
  page = await browserContext!.newPage();
  isPageReady = false;
  return { page: page!, context: browserContext! };
}

async function typeAndSend(pg: Page, text: string) {
  const el = pg.locator(INPUT_SEL).first();
  await el.evaluate((e: HTMLElement) => (e.innerText = "")).catch(() => {});
  try { await el.fill(""); } catch {}
  const isDiv = await el.evaluate((e: Element) => e.tagName === "DIV" && e.getAttribute("contenteditable") === "true");
  if (isDiv) await el.evaluate((e: HTMLElement, t: string) => (e.innerText = t), text);
  else await el.fill(text);
  const btn = pg.locator(SEND_BTN_SEL).first();
  if ((await btn.count()) > 0 && (await btn.isVisible())) await btn.click();
  else if (isDiv) await pg.keyboard.press("Control+Enter");
  else await pg.keyboard.press("Enter");
}

async function askFree(question: string, attachments?: string[]): Promise<string> {
  const { page: pg } = await ensureBrowser();

  if (!isPageReady) {
    await withRetry(() => navigateWithToast(pg, "https://chat.deepseek.com/", "DeepSeek"));
    await sleep(3000);
    // localStorage 检测登录态（DeepSeek 无登录专用 cookie）
    const userToken = await pg.evaluate(() => localStorage.getItem("userToken")).catch(() => null);
    if (!userToken) {
      if (!HEADLESS) await pg.bringToFront();
      await showToast(pg, "🔑 请登录 DeepSeek（登录后自动继续）");
      await pg.waitForSelector(INPUT_SEL, { timeout: 180000 });
    }
    await pg.waitForSelector(INPUT_SEL, { timeout: 60000 });
    isPageReady = true;
  }

  await pg.waitForSelector(INPUT_SEL, { timeout: 10000 });
  const prevCount = await pg.locator(ANSWER_SEL).count();
  if (attachments?.length) await uploadFiles(pg, attachments);
  const q = (question || "Please analyze this file").trim();
  const needC = !EXPLAIN_ONLY_RE.test(q) && CODE_MODIFY_RE.test(q);
  await showToast(pg, "📤 发送中...");
  await typeAndSend(pg, q + (needC ? CONSTRAINTS : ""));
  if (!HEADLESS) await pg.bringToFront();

  await showToast(pg, "⏳ 等待回答...");
  await waitForNewMessage(pg, ANSWER_SEL, prevCount);
  await waitForAnswer(pg, ANSWER_SEL, STOP_BTN_SEL);
  // 等内容稳定
  let stable = 0, lastLen = await pg.evaluate(() => document.body.innerText.length);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const curLen = await pg.evaluate(() => document.body.innerText.length);
    if (curLen === lastLen) { stable++; if (stable >= 3) break; }
    else { stable = 0; lastLen = curLen; }
  }
  const answerText = await extractNewAnswers(pg, ANSWER_SEL, prevCount);
  if (!answerText) throw new Error("Failed to extract answer");
  await showToast(pg, "✅ 回答完成", 2000);
  return answerText;
}

// --- MCP Server ---
const server = new Server({ name: "deepseek-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "ask_deepseek",
    description: "Use DeepSeek free web version (zero API token). Supports file attachments up to 100MB total.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string" },
        question: { type: "string" },
        attachments: { type: "array", items: { type: "string" } },
      },
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "ask_deepseek") throw new Error("Unknown tool");
  const raw = request.params.arguments || {};
  const tpl = typeof raw.template === "string" ? raw.template : "";
  const question = typeof raw.question === "string" ? raw.question : "";
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter((v): v is string => typeof v === "string") : undefined;
  let finalQuestion = question;
  if (tpl) {
    const content = loadTemplate(TEMPLATES_DIR, tpl);
    if (content) finalQuestion = `${content}\n\n---\n\n${question}`;
  }

  try {
    const answer = await askFree(finalQuestion, attachments);
    return { content: [{ type: "text", text: `【DeepSeek free answer】\n\n${answer}\n\n---\nGenerated by DeepSeek web version. Zero API token consumed.` }] };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `DeepSeek call failed: ${msg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DeepSeek MCP Server running on stdio");
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
