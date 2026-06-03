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
    SCREENSHOT_BTN: 'button[aria-label="截屏"]',
    SEND_BTN: 'button[aria-label="Send message"]',
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
        // 当前 page 失效，扫描所有标签页
        if (browserContext) {
            for (const p of browserContext.pages()) {
                try {
                    if (!p.isClosed() && p.url().includes("claude.2233.ai") && (await p.locator(SEL.CHAT_INPUT).count()) > 0) {
                        page = p;
                        isPageReady = true; // 找到有效聊天页，保持 ready 状态
                        try {
                            await p.bringToFront();
                        }
                        catch { }
                        return { page: p, context: browserContext };
                    }
                }
                catch { }
            }
        }
        // 找不到有效聊天页，重置状态重新初始化
        isPageReady = false;
        await closeB();
    }
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        await closeB();
        browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS);
        const existing = browserContext.pages();
        page = existing[0] || await browserContext.newPage();
        isPageReady = false;
        return { page: page, context: browserContext };
    })();
    return initPromise;
}
async function configureSettings(pg) {
    // 1. 点"选择风格"→ 选"简洁"
    try {
        const styleBtn = pg.locator('[data-testid="style-selector-dropdown"]').first();
        if (await styleBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await styleBtn.click({ force: true, timeout: 1500 });
            await sleep(500);
            const concise = pg.locator('[role="menuitemradio"]:has-text("简洁"), [role="menuitemradio"]:has-text("Concise")').first();
            if ((await concise.count().catch(() => 0)) > 0)
                await concise.click({ force: true, timeout: 1500 });
            await pg.keyboard.press("Escape").catch(() => { });
        }
    }
    catch { }
    await sleep(300);
    // 2. 打开模型菜单
    try {
        const modelBtn = pg.locator('[data-testid="model-selector-dropdown"]').first();
        if (!(await modelBtn.isVisible({ timeout: 3000 }).catch(() => false)))
            return;
        // 检查当前是否已是 Opus + High，跳过操作
        const currentLabel = await modelBtn.getAttribute("aria-label").catch(() => "");
        if (currentLabel?.includes("Opus") && currentLabel?.includes("High")) {
            console.error("[claude-mirror] 已是 Opus High，跳过设置");
            return;
        }
        await modelBtn.click({ force: true, timeout: 2000 });
        await sleep(1500);
        // 2a. 先点 Effort → High
        const effortTrigger = pg.locator('[data-testid="effort-menu-trigger"]').first();
        if (await effortTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
            await effortTrigger.click({ force: true, timeout: 1500 });
            await sleep(1000);
            const high = pg.locator('[role="menuitemradio"]:has-text("High"), [role="menuitem"]:has-text("High")').first();
            if (await high.isVisible({ timeout: 2000 }).catch(() => false)) {
                await high.click({ force: true, timeout: 1500 });
                await sleep(800);
            }
        }
        // 2b. 模型菜单可能被 effort 操作关掉，重新打开
        if (!(await pg.locator('[role="menuitemradio"]:has-text("Opus")').isVisible({ timeout: 1500 }).catch(() => false))) {
            await modelBtn.click({ force: true, timeout: 2000 });
            await sleep(1500);
        }
        // 2c. 选 Opus 4.8
        const opus = pg.locator('[role="menuitemradio"]:has-text("Opus")').first();
        if (await opus.isVisible({ timeout: 2000 }).catch(() => false)) {
            await opus.click({ force: true, timeout: 1500 });
            await sleep(800);
        }
        await pg.keyboard.press("Escape").catch(() => { });
        await sleep(800);
        // 验证：读取模型按钮当前文字
        const finalLabel = await modelBtn.getAttribute("aria-label").catch(() => "");
        const finalText = await modelBtn.textContent().catch(() => "");
        console.error(`[claude-mirror] 模型设置结果: label="${finalLabel}" text="${finalText?.trim()}"`);
        if (!finalLabel?.includes("Opus") || !finalLabel?.includes("High")) {
            console.error("[claude-mirror] ⚠️ 模型/Effort 设置可能未成功，当前:", finalLabel);
        }
        else {
            console.error("[claude-mirror] ✅ 模型/Effort 设置成功");
        }
    }
    catch (e) {
        console.error("[claude-mirror] configureSettings error:", e instanceof Error ? e.message : e);
    }
    await sleep(200);
}
async function ensurePageReady(pg) {
    if (isPageReady)
        return;
    // 监听新标签页（网站可能在新 tab 打开聊天页）
    let chatPage = pg;
    browserContext.on("page", (newPg) => {
        newPg.url(); // 触发 URL 获取
        setTimeout(async () => {
            const url = newPg.url();
            if (url.includes("claude.2233.ai")) {
                chatPage = newPg;
                page = newPg; // 更新全局 page 引用
            }
        }, 1000);
    });
    await withRetry(() => navigateWithToast(pg, SITE_URL, "Claude 镜像站"));
    await sleep(4000);
    // 等 Cloudflare 验证（最多 60 秒）
    for (let i = 0; i < 60; i++) {
        const title = await chatPage.title().catch(() => "");
        if (!title.includes("Just a moment"))
            break;
        if (i === 0)
            await showToast(chatPage, "🤖 遇到人机验证，请手动完成后等待自动继续…");
        await sleep(1000);
    }
    // 等聊天框出现（覆盖新标签页场景，最多 5 分钟）
    if ((await chatPage.locator(SEL.CHAT_INPUT).count().catch(() => 0)) === 0) {
        if (!HEADLESS)
            await chatPage.bringToFront().catch(() => { });
        await showToast(chatPage, "🔑 请在此浏览器窗口登录 Claude 镜像站，登录完成后将自动继续…").catch(() => { });
        for (let i = 0; i < 300; i++) {
            await sleep(1000);
            // 同时检查所有已打开的标签页
            for (const p of browserContext.pages()) {
                if (p.url().includes("claude.2233.ai") && (await p.locator(SEL.CHAT_INPUT).count().catch(() => 0)) > 0) {
                    chatPage = p;
                    page = p;
                    break;
                }
            }
            if ((await chatPage.locator(SEL.CHAT_INPUT).count().catch(() => 0)) > 0)
                break;
        }
    }
    if ((await chatPage.locator(SEL.CHAT_INPUT).count().catch(() => 0)) === 0) {
        throw new Error("Cannot access Claude mirror.");
    }
    page = chatPage; // 确保全局 page 指向聊天标签页
    await configureSettings(chatPage).catch(() => { });
    isPageReady = true;
}
async function takeScreenshot(pg, question, attachments) {
    await ensurePageReady(pg);
    // 使用全局 page（可能已切换到新标签页）
    const chatPg = page || pg;
    if (attachments?.length) {
        await uploadFiles(chatPg, attachments);
        await sleep(1000);
    }
    // 2. 设置问题文本（如果有）
    if (question) {
        await chatPg.locator(SEL.CHAT_INPUT).first().evaluate((el, t) => { el.innerText = t; el.dispatchEvent(new Event("input", { bubbles: true })); }, question);
        await sleep(500);
    }
    // 3. 点击截图按钮（失败也不报错，提示用户手动操作）
    const btn = chatPg.locator(SEL.SCREENSHOT_BTN).first();
    const btnFound = (await btn.count()) > 0;
    if (btnFound) {
        await btn.click({ force: true, timeout: 3000 }).catch(() => { });
    }
    await showToast(chatPg, btnFound
        ? "📸 请选择窗口 → 点击「分享」→ 截图上传后点击「发送」"
        : "📸 请手动点击截图按钮 → 选择窗口 → 点击「分享」→ 截图上传后点击「发送」");
    // 4. 等用户手动完成：检测页面内容增长（新回答出现）
    await showToast(chatPg, "⏳ 等待回答...");
    const oldBodyLen = await chatPg.evaluate(() => document.body.innerText.length).catch(() => 0);
    for (let i = 0; i < 180; i++) {
        await sleep(1000);
        const curLen = await chatPg.evaluate(() => document.body.innerText.length).catch(() => 0);
        if (curLen > oldBodyLen + 50) {
            for (let s = 0; s < 10; s++) {
                await sleep(1000);
                const after = await chatPg.evaluate(() => document.body.innerText.length).catch(() => 0);
                if (after === curLen)
                    break;
            }
            break;
        }
    }
    // 5. 提取回答
    const answer = await chatPg.evaluate(() => {
        const msgs = [...document.querySelectorAll('[class*="message"], [class*="chat"], article, [role="article"]')];
        const last = msgs[msgs.length - 1];
        return last ? last.textContent?.trim() || "" : document.body.innerText.slice(-2000);
    });
    await showToast(chatPg, "✅ 回答完成", 2000);
    return answer || "screenshot_captured";
}
async function askClaude(question, attachments) {
    const { page: pg } = await ensureBrowser();
    await ensurePageReady(pg);
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
    tools: [
        { name: "ask_claude_mirror", description: "Use Claude Mirror (claude.2233.ai) free version.", inputSchema: { type: "object", properties: { template: { type: "string" }, question: { type: "string" }, attachments: { type: "array", items: { type: "string" } } } } },
        { name: "take_screenshot", description: "Click the screenshot button in Claude chat to capture a window/tab/screen.", inputSchema: { type: "object", properties: { windowTitle: { type: "string", description: "Optional: window title to activate before capturing (e.g. 'CC Switch')" }, question: { type: "string", description: "Optional: question to send after screenshot" }, attachments: { type: "array", items: { type: "string" }, description: "Optional: files to upload before screenshot" } } } },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    async function handleAskClaude(raw) {
        const tpl = typeof raw.template === "string" ? raw.template : "";
        const q = typeof raw.question === "string" ? raw.question : "";
        const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v) => typeof v === "string") : undefined;
        let finalQuestion = q;
        if (tpl) {
            const content = loadTemplate(TEMPLATES_DIR, tpl);
            if (content)
                finalQuestion = `${content}\n\n---\n\n${q}`;
        }
        const answer = await askClaude(finalQuestion, files);
        return { content: [{ type: "text", text: `【Claude Mirror answer】\n\n${answer}` }] };
    }
    if (req.params.name === "ask_claude_mirror")
        return handleAskClaude(req.params.arguments || {});
    if (req.params.name === "take_screenshot") {
        try {
            const raw = req.params.arguments || {};
            const q = typeof raw.question === "string" ? raw.question : undefined;
            const files = Array.isArray(raw.attachments) ? raw.attachments.filter((v) => typeof v === "string") : undefined;
            const { page: pg } = await ensureBrowser();
            const answer = await takeScreenshot(pg, q, files);
            return { content: [{ type: "text", text: answer && answer.length > 20 ? `【Claude Mirror answer】\n\n${answer}` : "Screenshot captured and shared with Claude." }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Screenshot failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
        }
    }
    throw new Error("Unknown tool");
});
async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("Claude Mirror MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
