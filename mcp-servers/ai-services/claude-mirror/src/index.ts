import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium, BrowserContext, Page } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
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
const PROFILE_DIR = path.join(PROJECT_ROOT, ".claude-mirror-profile");
const SITE_URL = "https://claude.2233.ai/new";
const HEADLESS = process.env.CLAUDE_MIRROR_HEADLESS === "true";
const TEMPLATES_DIR = path.resolve(__dirname, "../../shared/templates");

const SEL = {
  CHAT_INPUT: "div.ProseMirror",
  STOP_BTN: 'button[aria-label*="stop" i]',
  SCREENSHOT_BTN: 'button[aria-label="截屏"]',
  SEND_BTN: 'button[aria-label="Send message"]',
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
    browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS);
    const existing = browserContext!.pages();
    page = existing[0] || await browserContext!.newPage();
    for (let i = 1; i < existing.length; i++) try { await existing[i].close(); } catch {}
    isPageReady = false;
    return { page: page!, context: browserContext! };
  })();
  return initPromise;
}

async function configureSettings(pg: Page) {
  // 1. 点"选择风格"→ 选"简洁"
  try {
    const styleBtn = pg.locator('button:has-text("选择风格"), button:has-text("Style")').first();
    if (await styleBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await styleBtn.click({ force: true, timeout: 1500 });
      await sleep(500);
      const concise = pg.locator('text=简洁').first();
      if ((await concise.count().catch(() => 0)) > 0)
        await concise.click({ force: true, timeout: 1500 });
    }
  } catch {}
  await sleep(200);

  // 2. 模型 → Opus 4.8 + Effort High
  try {
    const modelBtn = pg.locator('button:has-text("Sonnet"), button:has-text("Opus")').first();
    if (!(await modelBtn.isVisible({ timeout: 2000 }).catch(() => false))) return;
    await modelBtn.click({ force: true, timeout: 1500 });
    await sleep(800);

    // 先设 Effort → High（在选 Opus 之前，防止改模型关菜单）
    const effort = pg.locator('[data-testid="effort-menu-trigger"]').first();
    if (effort) {
      try { await effort.waitFor({ state: "visible", timeout: 2000 }); } catch {}
      await effort.click({ force: true, timeout: 1500 });
      await sleep(500);
      const high = pg.locator('[role=menuitemradio]:has-text("High")').first();
      if (high) {
        try { await high.waitFor({ state: "visible", timeout: 2000 }); } catch {}
        await high.click({ force: true, timeout: 1500 });
        await sleep(300); // 等待子菜单关闭
      }
    }

    // 再选 Opus 4.8（菜单应该还在）
    const opus = pg.locator('[role=menuitemradio]:has-text("Opus")').first();
    if (opus) {
      try { await opus.waitFor({ state: "visible", timeout: 2000 }); } catch {}
      await opus.click({ force: true, timeout: 1500 });
    }
    await sleep(300);

    // 关菜单
    await pg.mouse.click(5, 5).catch(() => {});
  } catch {}
  await sleep(200);
}

async function ensurePageReady(pg: Page): Promise<void> {
  if (isPageReady) return;
  await withRetry(() => navigateWithToast(pg, SITE_URL, "Claude 镜像站"));
  await sleep(4000);
  await configureSettings(pg).catch(() => {});
  for (let i = 0; i < 30; i++) {
    if (await pg.locator(SEL.CHAT_INPUT).count() > 0) break;
    await sleep(1000);
  }
  if ((await pg.locator(SEL.CHAT_INPUT).count()) === 0) throw new Error("Cannot access Claude mirror.");
  isPageReady = true;
}

async function takeScreenshot(pg: Page, question?: string, attachments?: string[]): Promise<string> {
  await ensurePageReady(pg);

  // 1. 先上传附件（如果有）
  if (attachments?.length) {
    await uploadFiles(pg, attachments);
    await sleep(1000);
  }

  // 2. 设置问题文本（如果有）
  if (question) {
    await pg.locator(SEL.CHAT_INPUT).first().evaluate(
      (el: HTMLElement, t: string) => { el.innerText = t; el.dispatchEvent(new Event("input", { bubbles: true })); },
      question
    );
    await sleep(500);
  }

  // 3. 点击截图按钮
  const btn = pg.locator(SEL.SCREENSHOT_BTN).first();
  if ((await btn.count()) === 0) throw new Error("No screenshot button");
  await showToast(pg, "📸 请选择窗口 → 点击「分享」→ 截图上传后点击「发送」");
  await btn.click({ force: true, timeout: 3000 });

  // 5. 等用户手动完成：检测页面内容增长（新回答出现）
  await showToast(pg, "⏳ 等待回答...");
  const oldBodyLen = await pg.evaluate(() => document.body.innerText.length).catch(() => 0);
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    const curLen = await pg.evaluate(() => document.body.innerText.length).catch(() => 0);
    if (curLen > oldBodyLen + 50) {
      // 内容增长，可能正在生成回答，等稳定
      for (let s = 0; s < 10; s++) {
        await sleep(1000);
        const after = await pg.evaluate(() => document.body.innerText.length).catch(() => 0);
        if (after === curLen) break;
      }
      break;
    }
  }

  // 6. 提取回答
  const answer = await pg.evaluate(() => {
    const msgs = [...document.querySelectorAll('[class*="message"], [class*="chat"], article, [role="article"]')];
    const last = msgs[msgs.length - 1];
    return last ? last.textContent?.trim() || "" : document.body.innerText.slice(-2000);
  });

  await showToast(pg, "✅ 回答完成", 2000);
  return answer || "screenshot_captured";
}

async function askClaude(question: string, attachments?: string[]): Promise<string> {
  const { page: pg } = await ensureBrowser();

  await ensurePageReady(pg);

  if (attachments?.length) await uploadFiles(pg, attachments);

  // 发送消息：设置文本 + 尝试多种发送方式
  await showToast(pg, "📤 发送中...");
  await pg.locator(SEL.CHAT_INPUT).first().evaluate(
    (el: HTMLElement, t: string) => { el.innerText = t; el.dispatchEvent(new Event("input", { bubbles: true })); },
    question
  );
  await sleep(500);

  // 依次尝试 Enter、Ctrl+Enter、查找发送按钮
  let sent = false;
  for (const method of ["Enter", "Control+Enter"]) {
    await pg.keyboard.press(method);
    await sleep(800);
    const txt = await pg.locator(SEL.CHAT_INPUT).first().evaluate((el: HTMLElement) => el.innerText).catch(() => "");
    if (!txt || txt.length < 5) { sent = true; break; }
  }
  if (!sent) {
    // 兜底：找页面上所有可能的发送按钮
    await pg.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const sendBtn = btns.find(b =>
        b.textContent?.includes("Send") || b.textContent?.includes("发送") ||
        b.getAttribute("aria-label")?.toLowerCase().includes("send")
      );
      if (sendBtn) sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }).catch(() => {});
    await sleep(500);
  }

  // 等回复
  await showToast(pg, "⏳ 等待回答...");
  const oldLen = await pg.evaluate(() => document.body.innerText.length);
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    const curLen = await pg.evaluate(() => document.body.innerText.length);
    if (curLen > oldLen + 20) {
      // 内容开始增长，等稳定
      for (let s = 0; s < 5; s++) {
        await sleep(1000);
        const after = await pg.evaluate(() => document.body.innerText.length);
        if (after === curLen) break;
      }
      break;
    }
  }

  const answer = await pg.evaluate(() => {
    const msgs = [...document.querySelectorAll('[class*="message"], [class*="chat"], article, [role="article"]')];
    const last = msgs[msgs.length - 1];
    return last ? last.textContent?.trim() || "" : document.body.innerText.slice(-2000);
  });
  if (!answer) throw new Error("Failed to extract answer");
  await showToast(pg, "✅ 回答完成", 2000);
  return answer;
}

const server = new Server({ name: "claude-mirror-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "ask_claude_mirror", description: "Use Claude Mirror (claude.2233.ai) free version.", inputSchema: { type: "object", properties: { template: { type: "string" }, question: { type: "string" }, attachments: { type: "array", items: { type: "string" } } } } },
    { name: "take_screenshot", description: "Click the screenshot button in Claude chat to capture a window/tab/screen.", inputSchema: { type: "object", properties: { windowTitle: { type: "string", description: "Optional: window title to activate before capturing (e.g. 'CC Switch')" }, question: { type: "string", description: "Optional: question to send after screenshot" }, attachments: { type: "array", items: { type: "string" }, description: "Optional: files to upload before screenshot" } } } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  async function handleAskClaude(raw: any) {
    const tpl = typeof raw.template === "string" ? raw.template : "";
    const q = typeof raw.question === "string" ? raw.question : "";
    const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v: any): v is string => typeof v === "string") : undefined;
    let finalQuestion = q;
    if (tpl) {
      const content = loadTemplate(TEMPLATES_DIR, tpl);
      if (content) finalQuestion = `${content}\n\n---\n\n${q}`;
    }
    const answer = await askClaude(finalQuestion, files);
    return { content: [{ type: "text", text: `【Claude Mirror answer】\n\n${answer}` }] };
  }
  if (req.params.name === "ask_claude_mirror") return handleAskClaude(req.params.arguments || {});
  if (req.params.name === "take_screenshot") {
    try {
      const raw = req.params.arguments || {};
      const q = typeof raw.question === "string" ? raw.question : undefined;
      const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v: any): v is string => typeof v === "string") : undefined;
      const { page: pg } = await ensureBrowser();
      const answer = await takeScreenshot(pg, q, files);
      return { content: [{ type: "text", text: answer && answer.length > 20 ? `【Claude Mirror answer】\n\n${answer}` : "Screenshot captured and shared with Claude." }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Screenshot failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
  throw new Error("Unknown tool");
});

async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("Claude Mirror MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
