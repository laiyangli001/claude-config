import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium, BrowserContext, Page } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import { launchBrowser, closeBrowser } from "../../shared/browser.mjs";
// @ts-ignore
import { waitForAnswer, extractNewAnswers, waitForNewMessage } from "../../shared/answer.mjs";
// @ts-ignore
import { uploadFiles } from "../../shared/upload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".chatgpt-official-profile");
const HEADLESS = process.env.CHATGPT_HEADLESS === "true";

const SEL = {
  CHAT_INPUT: "#prompt-textarea",
  SEND_BTN: 'button.composer-submit-button-color, button[aria-label="Send"], [data-testid="send-button"]',
  STOP_BTN: 'button[aria-label*="stop" i], [data-testid="stop-button"]',
  FILE_INPUT: "#upload-files",
  PLUS_BTN: '[data-testid="composer-plus-btn"]',
  DUPLICATE_BTN: 'button:has-text("确定"), button:has-text("OK")',
  OFFICIAL_URL: "https://chatgpt.com/",
  LOGIN_BTN: 'a[href*="login"], [data-testid="login-button"]',
};

let browserContext: BrowserContext | null = null;
let page: Page | null = null;
let isPageReady = false;
let initPromise: Promise<{ page: Page; context: BrowserContext }> | null = null;

async function closeB() { browserContext = null; page = null; initPromise = null; isPageReady = false; }

let cleaning = false;
function cleanup() {
  if (cleaning) return;
  cleaning = true;
  process.exitCode = 0;
  const ctx = browserContext;
  Promise.race([(async () => { await closeB(); if (ctx) try { await ctx.close(); } catch {} })(), new Promise(r => setTimeout(r, 15000))])
    .finally(() => setTimeout(() => process.exit(), 200));
}
process.on("SIGINT", cleanup); process.on("SIGTERM", cleanup);

async function ensureBrowser(): Promise<{ page: Page; context: BrowserContext }> {
  if (browserContext && page) {
    try { if (!page.isClosed() && (await page.locator(SEL.CHAT_INPUT).count()) > 0) return { page: page!, context: browserContext! }; } catch {}
    await closeB();
  }
  if (initPromise) return initPromise;
  initPromise = (async (): Promise<{ page: Page; context: BrowserContext }> => {
    await closeB();
    browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS);
    const existing = browserContext!.pages();
    page = existing[0] || await browserContext!.newPage();
    for (let i = 1; i < existing.length; i++) try { await existing[i].close(); } catch {}
    isPageReady = false;
    return { page: page!, context: browserContext! };
  })();
  return initPromise;
}

async function askChatGPT(question: string, attachments?: string[]): Promise<string> {
  const { page: pg } = await ensureBrowser();

  if (!isPageReady) {
    await pg.goto(SEL.OFFICIAL_URL, { waitUntil: "domcontentloaded" });
    if (await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false)) {
      isPageReady = true;
    } else if (await pg.locator(SEL.LOGIN_BTN).first().isVisible().catch(() => false)) {
      if (!HEADLESS) await pg.bringToFront();
      await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
      isPageReady = true;
    } else {
      throw new Error("Cannot access ChatGPT. Please check if the site is accessible.");
    }
  }

  if (attachments?.length) await uploadFiles(pg, attachments, { fileInputSelector: SEL.FILE_INPUT, duplicateBtnSelector: SEL.DUPLICATE_BTN });

  const answerSel = '[data-message-author-role="assistant"]';
  let prev = await pg.locator(answerSel).count();
  await pg.locator(SEL.CHAT_INPUT).first().evaluate((el: HTMLElement, t: string) => { el.innerText = t; el.dispatchEvent(new Event("input", { bubbles: true })); }, question);
  const btn = pg.locator(SEL.SEND_BTN).first();
  if ((await btn.count()) > 0 && (await btn.isVisible())) await btn.click(); else await pg.keyboard.press("Enter");

  await waitForNewMessage(pg, answerSel, prev);
  await waitForAnswer(pg, answerSel, SEL.STOP_BTN);
  const answer = await extractNewAnswers(pg, answerSel, prev);
  if (!answer) throw new Error("Failed to extract answer");
  return answer;
}

const server = new Server({ name: "chatgpt-official-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ask_chatgpt_official", description: "Use official ChatGPT (chatgpt.com) free version.", inputSchema: { type: "object", properties: { question: { type: "string" }, attachments: { type: "array", items: { type: "string" } } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "ask_chatgpt_official") throw new Error("Unknown tool");
  const raw = req.params.arguments || {};
  const q = typeof raw.question === "string" ? raw.question : "";
  const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v): v is string => typeof v === "string") : undefined;
  try {
    const answer = await askChatGPT(q, files);
    return { content: [{ type: "text", text: `【ChatGPT Official answer】\n\n${answer}` }] };
  } catch (e: unknown) {
    return { content: [{ type: "text", text: `ChatGPT Official call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
});

async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("ChatGPT Official MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
