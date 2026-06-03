import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium, BrowserContext, Page } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import { launchBrowser, navigateWithToast, withRetry, isTransientError, checkSite, closeBrowser } from "../../shared/browser.mjs";
// @ts-ignore
import { waitForAnswer, extractNewAnswers, waitForNewMessage, setupPageErrorMonitor, showToast } from "../../shared/answer.mjs";
// @ts-ignore
import { uploadFiles } from "../../shared/upload.mjs";
// @ts-ignore
import { loadTemplate } from "../../shared/role.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".chatgpt-mirror-profile");
const SITE_URL = "https://chatgpt.2233.ai/";
const HEADLESS = process.env.CHATGPT_HEADLESS === "true";
const CDP_PORT = 9222;
const TEMPLATES_DIR = path.resolve(__dirname, "../../shared/templates");

const SEL = {
  CHAT_INPUT: "#prompt-textarea",
  SEND_BTN: 'button.composer-submit-button-color, button[aria-label="Send"], [data-testid="send-button"]',
  STOP_BTN: 'button[aria-label*="stop" i], [data-testid="stop-button"]',
  FILE_INPUT: "#upload-files",
  PLUS_BTN: '[data-testid="composer-plus-btn"]',
  DUPLICATE_BTN: 'button:has-text("确定"), button:has-text("OK")',
  START_BTN: 'button:has-text("立即开始"), a:has-text("立即开始"), button:has-text("Start now"), a:has-text("Start now")',
  INVITE_URL: "https://2233.ai/?code=FC8XHSCH",
  CHAT_URL: "https://chatgpt.2233.ai/",
};

let browserContext: BrowserContext | null = null;
let page: Page | null = null;
let isPageReady = false;
let initPromise: Promise<{ page: Page; context: BrowserContext }> | null = null;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function closeB() {
  const ctx = browserContext;
  browserContext = null; page = null; initPromise = null; isPageReady = false;
  if (ctx) await closeBrowser(ctx);
}

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
    try { if (!page.isClosed() && (await page.locator(SEL.CHAT_INPUT).count()) > 0) { try { await page!.bringToFront(); } catch {} return { page: page!, context: browserContext! }; } } catch {}
    await closeB();
  }
  if (initPromise) return initPromise;
  initPromise = (async (): Promise<{ page: Page; context: BrowserContext }> => {
    await closeB();
    browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS, CDP_PORT);
    const existing = browserContext!.pages();
    // 扫描已有聊天页并复用，不关其他页（CDP 连的是用户浏览器）
    let found = false;
    for (const p of existing) {
      try {
        if (!p.isClosed() && p.url().includes("chatgpt.2233.ai") && (await p.locator(SEL.CHAT_INPUT).count()) > 0) {
          page = p;
          isPageReady = true;
          found = true;
          break;
        }
      } catch {}
    }
    if (!found) {
      // 检查是否有 2233.ai 域名的页，用来导航
      let domainPage = null;
      let regularPage = null;
      page = await browserContext!.newPage();
      isPageReady = false;
    }
    return { page: page!, context: browserContext! };
  })();
  return initPromise;
}

async function askChatGPT(question: string, attachments?: string[]): Promise<string> {
  const { page: pg } = await ensureBrowser();

  if (!isPageReady) {
    await withRetry(() => navigateWithToast(pg, SEL.INVITE_URL, "ChatGPT 镜像站"));
    // 点 START_BTN（中文或英文）
    const startBtn = pg.locator(SEL.START_BTN);
    if ((await startBtn.count()) > 0 && (await startBtn.isVisible())) {
      await startBtn.first().click({ timeout: 3000 }).catch(() => {});
      await sleep(3000);
    }

    // 如果跳到 dashboard，直接导航到聊天页（同标签页）
    if (pg.url().includes("2233.ai") && !pg.url().includes("chatgpt.2233.ai")) {
      await showToast(pg, "正在进入 ChatGPT…");
      await pg.goto("https://chatgpt.2233.ai/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await sleep(4000);
    }

    // 使用聊天标签页（page 可能已被更新为新标签页）
    const chatPg = page || pg;

    // 如果跳到 /list（车队列表），点第一个"访问"
    if (chatPg.url().includes("/list") || chatPg.url().includes("/team")) {
      await showToast(chatPg, "正在进入对话…");
      const visitBtn = pg.locator('button:has-text("访问"), button:has-text("Access")').first();
      if (await visitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await visitBtn.click({ timeout: 3000 }).catch(() => {});
        await sleep(4000);
      }
    }

    // 等待聊天输入框出现（使用可能已切换的标签页）
    await chatPg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    const cookies = await browserContext!.cookies();
    const hasSession = cookies.some(c => c.name.includes("session") && c.value.length > 10);
    if (!hasSession) {
      if (!HEADLESS) await chatPg.bringToFront();
      await showToast(chatPg, "🔑 请登录镜像站（登录后自动继续）");
      await chatPg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 180000 });
    }
    if (!(await chatPg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false))) {
      throw new Error("Cannot access ChatGPT mirror.");
    }
    isPageReady = true;
  }

  const activePg = page || pg;
  if (attachments?.length) await uploadFiles(activePg, attachments, { fileInputSelector: SEL.FILE_INPUT, duplicateBtnSelector: SEL.DUPLICATE_BTN });
  const answerSel = '[data-message-author-role="assistant"]';
  let prev = await activePg.locator(answerSel).count();
  await activePg.locator(SEL.CHAT_INPUT).first().evaluate((el: HTMLElement, t: string) => { el.innerText = t; el.dispatchEvent(new Event("input", { bubbles: true })); }, question);
  const sb = activePg.locator(SEL.SEND_BTN).first();
  if ((await sb.count()) > 0 && (await sb.isVisible())) await sb.click(); else await activePg.keyboard.press("Enter");

  await showToast(activePg, "⏳ 等待回答...");
  await waitForNewMessage(activePg, answerSel, prev);
  await waitForAnswer(activePg, answerSel, SEL.STOP_BTN);
  // 等 stop 消失 + 内容稳定 3 秒
  let stable = 0, lastLen = await activePg.evaluate(() => document.body.innerText.length);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const curLen = await activePg.evaluate(() => document.body.innerText.length);
    if (curLen === lastLen) { stable++; if (stable >= 3) break; }
    else { stable = 0; lastLen = curLen; }
  }
  const answer = await extractNewAnswers(activePg, answerSel, prev);
  if (!answer) throw new Error("Failed to extract answer");
  await showToast(activePg, "✅ 回答完成", 2000);
  return answer;
}

const server = new Server({ name: "chatgpt-mirror-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ask_chatgpt_mirror", description: "Use ChatGPT mirror (chatgpt.2233.ai) free version.", inputSchema: { type: "object", properties: { template: { type: "string" }, question: { type: "string" }, attachments: { type: "array", items: { type: "string" } } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "ask_chatgpt_mirror") throw new Error("Unknown tool");
  const raw = req.params.arguments || {};
  const tpl = typeof raw.template === "string" ? raw.template : "";
  const q = typeof raw.question === "string" ? raw.question : "";
  const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v): v is string => typeof v === "string") : undefined;
  let finalQuestion = q;
  if (tpl) {
    const content = loadTemplate(TEMPLATES_DIR, tpl);
    if (content) finalQuestion = `${content}\n\n---\n\n${q}`;
  }
  try {
    const answer = await askChatGPT(finalQuestion, files);
    return { content: [{ type: "text", text: `【ChatGPT Mirror answer】\n\n${answer}` }] };
  } catch (e: unknown) {
    return { content: [{ type: "text", text: `ChatGPT Mirror call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
});

async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("ChatGPT Mirror MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
