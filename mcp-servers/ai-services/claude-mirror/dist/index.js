import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import { launchBrowser, navigateWithToast, withRetry, closeBrowser } from "../../shared/browser.mjs";
// @ts-ignore
import { showToast } from "../../shared/answer.mjs";
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
};
let browserContext = null;
let page = null;
let isPageReady = false;
let initPromise = null;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function closeB() {
    const ctx = browserContext;
    browserContext = null;
    page = null;
    initPromise = null;
    isPageReady = false;
    if (ctx)
        await closeBrowser(ctx);
}
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
            if (!page.isClosed() && (await page.locator(SEL.CHAT_INPUT).count()) > 0) {
                try {
                    await page.bringToFront();
                }
                catch { }
                return { page: page, context: browserContext };
            }
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
async function configureSettings(pg) {
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
    }
    catch { }
    await sleep(200);
    // 2. 模型 → Opus 4.8 + Effort High
    try {
        const modelBtn = pg.locator('button:has-text("Sonnet"), button:has-text("Opus")').first();
        if (!(await modelBtn.isVisible({ timeout: 2000 }).catch(() => false)))
            return;
        await modelBtn.click({ force: true, timeout: 1500 });
        await sleep(800);
        // 先设 Effort → High（在选 Opus 之前，防止改模型关菜单）
        const effort = pg.locator('[data-testid="effort-menu-trigger"]').first();
        if (effort) {
            try {
                await effort.waitFor({ state: "visible", timeout: 2000 });
            }
            catch { }
            await effort.click({ force: true, timeout: 1500 });
            await sleep(500);
            const high = pg.locator('[role=menuitemradio]:has-text("High")').first();
            if (high) {
                try {
                    await high.waitFor({ state: "visible", timeout: 2000 });
                }
                catch { }
                await high.click({ force: true, timeout: 1500 });
                await sleep(300); // 等待子菜单关闭
            }
        }
        // 再选 Opus 4.8（菜单应该还在）
        const opus = pg.locator('[role=menuitemradio]:has-text("Opus")').first();
        if (opus) {
            try {
                await opus.waitFor({ state: "visible", timeout: 2000 });
            }
            catch { }
            await opus.click({ force: true, timeout: 1500 });
        }
        await sleep(300);
        // 关菜单
        await pg.mouse.click(5, 5).catch(() => { });
    }
    catch { }
    await sleep(200);
}
async function askClaude(question, attachments) {
    const { page: pg } = await ensureBrowser();
    if (!isPageReady) {
        await withRetry(() => navigateWithToast(pg, SITE_URL, "Claude 镜像站"));
        await sleep(4000);
        // 配置设置
        await configureSettings(pg).catch(() => { });
        // 等聊天输入框
        for (let i = 0; i < 30; i++) {
            if (await pg.locator(SEL.CHAT_INPUT).count() > 0)
                break;
            await sleep(1000);
        }
        if ((await pg.locator(SEL.CHAT_INPUT).count()) === 0)
            throw new Error("Cannot access Claude mirror.");
        isPageReady = true;
    }
    if (attachments?.length)
        await uploadFiles(pg, attachments);
    // 发送消息：设置文本 + 尝试多种发送方式
    await showToast(pg, "📤 发送中...");
    await pg.locator(SEL.CHAT_INPUT).first().evaluate((el, t) => { el.innerText = t; el.dispatchEvent(new Event("input", { bubbles: true })); }, question);
    await sleep(500);
    // 依次尝试 Enter、Ctrl+Enter、查找发送按钮
    let sent = false;
    for (const method of ["Enter", "Control+Enter"]) {
        await pg.keyboard.press(method);
        await sleep(800);
        const txt = await pg.locator(SEL.CHAT_INPUT).first().evaluate((el) => el.innerText).catch(() => "");
        if (!txt || txt.length < 5) {
            sent = true;
            break;
        }
    }
    if (!sent) {
        // 兜底：找页面上所有可能的发送按钮
        await pg.evaluate(() => {
            const btns = [...document.querySelectorAll("button")];
            const sendBtn = btns.find(b => b.textContent?.includes("Send") || b.textContent?.includes("发送") ||
                b.getAttribute("aria-label")?.toLowerCase().includes("send"));
            if (sendBtn)
                sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }).catch(() => { });
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
                if (after === curLen)
                    break;
            }
            break;
        }
    }
    const answer = await pg.evaluate(() => {
        const msgs = [...document.querySelectorAll('[class*="message"], [class*="chat"], article, [role="article"]')];
        const last = msgs[msgs.length - 1];
        return last ? last.textContent?.trim() || "" : document.body.innerText.slice(-2000);
    });
    if (!answer)
        throw new Error("Failed to extract answer");
    await showToast(pg, "✅ 回答完成", 2000);
    return answer;
}
const server = new Server({ name: "claude-mirror-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ask_claude_mirror", description: "Use Claude Mirror (claude.2233.ai) free version.", inputSchema: { type: "object", properties: { template: { type: "string" }, question: { type: "string" }, attachments: { type: "array", items: { type: "string" } } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "ask_claude_mirror")
        throw new Error("Unknown tool");
    const raw = req.params.arguments || {};
    const tpl = typeof raw.template === "string" ? raw.template : "";
    const q = typeof raw.question === "string" ? raw.question : "";
    const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v) => typeof v === "string") : undefined;
    let finalQuestion = q;
    if (tpl) {
        const content = loadTemplate(TEMPLATES_DIR, tpl);
        if (content)
            finalQuestion = `${content}\n\n---\n\n${q}`;
    }
    try {
        const answer = await askClaude(finalQuestion, files);
        return { content: [{ type: "text", text: `【Claude Mirror answer】\n\n${answer}` }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Claude Mirror call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
});
async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("Claude Mirror MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
