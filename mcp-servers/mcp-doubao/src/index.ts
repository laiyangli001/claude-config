import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium, BrowserContext, Page } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import { launchBrowser, withRetry, isTransientError } from "../../shared/browser.mjs";
// @ts-ignore
import { setupPageErrorMonitor, showToast } from "../../shared/answer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".doubao-profile");
const HEADLESS = process.env.DOUBDAO_HEADLESS === "true";

const SEL = {
  CHAT_INPUT: 'textarea[placeholder*="发消息"]',
  // 发送按钮选择器（登录后出现）
  SEND_BTN: 'button:has-text("发送"), button[aria-label*="send" i], button[aria-label*="Send"]',
  STOP_BTN: 'button[aria-label*="stop" i], button[aria-label*="Stop"]',
  LOGIN_BTN: 'button:has-text("登录"), a:has-text("登录")',
  URL: "https://www.doubao.com/chat/",
};

let browserContext: BrowserContext | null = null;
let page: Page | null = null;
let isPageReady = false;
let initPromise: Promise<{ page: Page; context: BrowserContext }> | null = null;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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
    browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS, SEL.URL);
    const existing = browserContext!.pages();
    page = existing[0] || await browserContext!.newPage();
    for (let i = 1; i < existing.length; i++) try { await existing[i].close(); } catch {}
    setupPageErrorMonitor(page);
    isPageReady = false;
    return { page: page!, context: browserContext! };
  })();
  return initPromise;
}

async function askDoubao(question: string): Promise<string> {
  const { page: pg } = await ensureBrowser();

  if (!isPageReady) {
    await showToast(pg, "⏳ 打开豆包...");
    await withRetry(() => pg.goto(SEL.URL, { waitUntil: "domcontentloaded", timeout: 30000 }));
    await sleep(2000);
    // 检测是否有登录 session（通过 cookie 判断）
    const cookies = await browserContext!.cookies();
    const hasSession = cookies.some(c => c.name === "flow_cur_user_sec_id" && c.value.length > 10);
    if (!hasSession && await pg.locator(SEL.LOGIN_BTN).first().isVisible().catch(() => false)) {
      if (!HEADLESS) await pg.bringToFront();
      await showToast(pg, "🔑 请登录豆包（登录后自动继续）");
      try {
        await pg.locator(SEL.LOGIN_BTN).first().waitFor({ state: "hidden", timeout: 180000 });
      } catch {
        throw new Error("登录超时，请重新调用并在浏览器中完成登录");
      }
    }
    // 登录验证：确认聊天输入框已出现
    if (!(await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false))) {
      throw new Error("未检测到聊天输入框，请确保已登录");
    }
    isPageReady = true;
  }

  await showToast(pg, "📤 发送中...");
  const input = pg.locator(SEL.CHAT_INPUT).first();
  await input.click();
  await input.fill(question);
  await input.evaluate((el: HTMLTextAreaElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, question);
  await sleep(300);
  await pg.keyboard.press("Enter");

  // 等回答生成（轮询检测新内容出现，最长 60 秒）
  await showToast(pg, "⏳ 等待回答...");
  const textBefore = await pg.evaluate(() => document.body.innerText.length);
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const curLen = await pg.evaluate(() => document.body.innerText.length);
    if (curLen > textBefore) break; // 页面文本增长 → 回答来了
  }

  // 提取回答
  await sleep(3000);
  await showToast(pg, "✅ 回答完成", 2000);
  let answer = await pg.evaluate(() => {
    const msgs = document.querySelectorAll('[class*="message"], article, [role="article"]');
    const texts = [];
    for (const el of msgs) {
      const t = (el.textContent || "").trim();
      if (t.length > 5) texts.push(t);
    }
    return texts.length > 0 ? texts[texts.length - 1] : "";
  });
  if (!answer || answer.length < 5) throw new Error("Failed to extract answer");
  return answer;
}

const server = new Server({ name: "mcp-doubao", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ask_doubao", description: "Use Doubao (doubao.com) free version.", inputSchema: { type: "object", properties: { question: { type: "string" } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "ask_doubao") throw new Error("Unknown tool");
  const q = typeof req.params.arguments?.question === "string" ? req.params.arguments.question : "";
  try {
    const answer = await askDoubao(q);
    return { content: [{ type: "text", text: `【Doubao answer】\n\n${answer}` }] };
  } catch (e: unknown) {
    return { content: [{ type: "text", text: `Doubao call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
});

async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("Doubao MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
