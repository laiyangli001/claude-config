import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import { launchBrowser } from "../../shared/browser.mjs";
// @ts-ignore
import { waitForAnswer, extractNewAnswers, waitForNewMessage } from "../../shared/answer.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".doubao-profile");
const HEADLESS = process.env.DOUBDAO_HEADLESS === "true";
const SEL = {
    CHAT_INPUT: '[contenteditable="true"]',
    // 发送按钮选择器（登录后出现）
    SEND_BTN: 'button:has-text("发送"), button[aria-label*="send" i], button[aria-label*="Send"]',
    STOP_BTN: 'button[aria-label*="stop" i], button[aria-label*="Stop"]',
    LOGIN_BTN: 'button:has-text("登录"), a:has-text("登录")',
    URL: "https://www.doubao.com/chat/",
};
let browserContext = null;
let page = null;
let isPageReady = false;
let initPromise = null;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function closeB() { browserContext = null; page = null; initPromise = null; isPageReady = false; }
let cleaning = false;
function cleanup() {
    if (cleaning)
        return;
    cleaning = true;
    process.exitCode = 0;
    const ctx = browserContext;
    Promise.race([(async () => { await closeB(); if (ctx)
            try {
                await ctx.close();
            }
            catch { } })(), new Promise(r => setTimeout(r, 15000))])
        .finally(() => setTimeout(() => process.exit(), 200));
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
async function ensureBrowser() {
    if (browserContext && page) {
        try {
            if (!page.isClosed() && (await page.locator(SEL.CHAT_INPUT).count()) > 0)
                return { page: page, context: browserContext };
        }
        catch { }
        await closeB();
    }
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        await closeB();
        browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS);
        const existing = browserContext.pages();
        page = existing[0] || await browserContext.newPage();
        for (let i = 1; i < existing.length; i++)
            try {
                await existing[i].close();
            }
            catch { }
        isPageReady = false;
        return { page: page, context: browserContext };
    })();
    return initPromise;
}
async function askDoubao(question) {
    const { page: pg } = await ensureBrowser();
    if (!isPageReady) {
        await pg.goto(SEL.URL, { waitUntil: "domcontentloaded" });
        // 检测是否需要登录
        if (await pg.locator(SEL.LOGIN_BTN).first().isVisible().catch(() => false)) {
            if (!HEADLESS)
                await pg.bringToFront();
            // 等待登录（最多 3 分钟）
            await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 180000 }).catch(() => { });
        }
        if (!(await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false))) {
            if (!HEADLESS)
                await pg.bringToFront();
            await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
        }
        isPageReady = true;
    }
    // 输入问题
    await pg.locator(SEL.CHAT_INPUT).first().evaluate((el, t) => {
        el.innerText = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }, question);
    // 点击发送按钮（或回车）
    const btn = pg.locator(SEL.SEND_BTN).first();
    if ((await btn.count()) > 0 && (await btn.isVisible()))
        await btn.click();
    else
        await pg.keyboard.press("Enter");
    // 等待回答
    const answerSel = '[class*="message"], [class*="answer"], [class*="reply"]';
    const prevCount = await pg.locator(answerSel).count();
    await waitForNewMessage(pg, answerSel, prevCount);
    await waitForAnswer(pg, answerSel, SEL.STOP_BTN);
    const answer = await extractNewAnswers(pg, answerSel, prevCount);
    if (!answer)
        throw new Error("Failed to extract answer");
    return answer;
}
const server = new Server({ name: "mcp-doubao", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ask_doubao", description: "Use Doubao (doubao.com) free version.", inputSchema: { type: "object", properties: { question: { type: "string" } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "ask_doubao")
        throw new Error("Unknown tool");
    const q = typeof req.params.arguments?.question === "string" ? req.params.arguments.question : "";
    try {
        const answer = await askDoubao(q);
        return { content: [{ type: "text", text: `【Doubao answer】\n\n${answer}` }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Doubao call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
});
async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("Doubao MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
