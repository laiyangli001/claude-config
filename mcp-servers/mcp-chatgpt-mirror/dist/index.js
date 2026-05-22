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
// @ts-ignore
import { uploadFiles } from "../../shared/upload.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".chatgpt-mirror-profile");
const HEADLESS = process.env.CHATGPT_HEADLESS === "true";
const SEL = {
    CHAT_INPUT: "#prompt-textarea",
    SEND_BTN: 'button.composer-submit-button-color, button[aria-label="Send"], [data-testid="send-button"]',
    STOP_BTN: 'button[aria-label*="stop" i], [data-testid="stop-button"]',
    FILE_INPUT: "#upload-files",
    PLUS_BTN: '[data-testid="composer-plus-btn"]',
    DUPLICATE_BTN: 'button:has-text("确定"), button:has-text("OK")',
    START_BTN: 'button:has-text("立即开始"), a:has-text("立即开始")',
    INVITE_URL: "https://2233.ai/?code=FC8XHSCH",
    CHAT_URL: "https://chatgpt.2233.ai/",
};
const PROFILE_DIR2 = PROFILE_DIR;
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
        browserContext = await launchBrowser(chromium, PROFILE_DIR2, HEADLESS);
        for (const p of browserContext.pages())
            try {
                await p.close();
            }
            catch { }
        page = await browserContext.newPage();
        isPageReady = false;
        return { page: page, context: browserContext };
    })();
    return initPromise;
}
async function askChatGPT(question, attachments, role) {
    const { page: pg } = await ensureBrowser();
    if (!isPageReady) {
        await pg.goto(SEL.INVITE_URL, { waitUntil: "domcontentloaded" });
        const btn = pg.locator(SEL.START_BTN);
        if ((await btn.count()) > 0 && (await btn.isVisible())) {
            await btn.first().evaluate((el) => (el.disabled = false));
            await sleep(200);
            await btn.first().click();
        }
        await pg.goto(SEL.CHAT_URL, { waitUntil: "domcontentloaded" });
        if (!(await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false))) {
            if (!HEADLESS)
                await pg.bringToFront();
            await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
        }
        isPageReady = true;
    }
    if (attachments?.length)
        await uploadFiles(pg, attachments, { fileInputSelector: SEL.FILE_INPUT, duplicateBtnSelector: SEL.DUPLICATE_BTN });
    const answerSel = '[data-message-author-role="assistant"]';
    let prev = await pg.locator(answerSel).count();
    await pg.locator(SEL.CHAT_INPUT).first().evaluate((el, t) => { el.innerText = t; el.dispatchEvent(new Event("input", { bubbles: true })); }, question);
    const btn = pg.locator(SEL.SEND_BTN).first();
    if ((await btn.count()) > 0 && (await btn.isVisible()))
        await btn.click();
    else
        await pg.keyboard.press("Enter");
    await waitForNewMessage(pg, answerSel, prev);
    await waitForAnswer(pg, answerSel, SEL.STOP_BTN);
    const answer = await extractNewAnswers(pg, answerSel, prev);
    if (!answer)
        throw new Error("Failed to extract answer");
    return answer;
}
const server = new Server({ name: "chatgpt-mirror-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ask_chatgpt_mirror", description: "Use ChatGPT mirror (chatgpt.2233.ai) free version.", inputSchema: { type: "object", properties: { question: { type: "string" }, attachments: { type: "array", items: { type: "string" } } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "ask_chatgpt_mirror")
        throw new Error("Unknown tool");
    const raw = req.params.arguments || {};
    const q = typeof raw.question === "string" ? raw.question : "";
    const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v) => typeof v === "string") : undefined;
    try {
        const answer = await askChatGPT(q, files);
        return { content: [{ type: "text", text: `【ChatGPT Mirror answer】\n\n${answer}` }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `ChatGPT Mirror call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
});
async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("ChatGPT Mirror MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
