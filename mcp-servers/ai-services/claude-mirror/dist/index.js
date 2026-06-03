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
    // 1. 选择风格 → 简洁（用 JS 直接点）
    try {
        const styleBtn = pg.locator('[data-testid="style-selector-dropdown"]').first();
        if (await styleBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            const currentText = await styleBtn.textContent().catch(() => "");
            if (currentText?.includes("简洁")) {
                console.error("[claude-mirror] 已是简洁风格，跳过");
            }
            else {
                await styleBtn.click({ force: true, timeout: 2000 });
                await sleep(1000);
                // 用 visible text 直接点（菜单项无 role=menuitemradio）
                const clicked = await pg.evaluate(() => {
                    const allDivs = [...document.querySelectorAll("div")];
                    const target = allDivs.find(d => d.textContent?.trim() === "简洁" && d.offsetParent !== null);
                    if (target) {
                        target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                        return true;
                    }
                    return false;
                }).catch(() => false);
                console.error("[claude-mirror] 风格设置:", clicked ? "✅" : "❌");
                await sleep(500);
            }
            // 关菜单
            await pg.evaluate(() => document.body.click()).catch(() => { });
            await pg.keyboard.press("Escape").catch(() => { });
            await sleep(300);
        }
    }
    catch { }
    await sleep(500);
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
        // 验证
        const finalLabel = await modelBtn.getAttribute("aria-label").catch(() => "");
        console.error(`[claude-mirror] 模型设置结果: "${finalLabel}"`);
        if (finalLabel?.includes("Opus") && finalLabel?.includes("High")) {
            console.error("[claude-mirror] ✅ 设置成功");
        }
        else {
            console.error("[claude-mirror] ⚠️ 设置可能未成功:", finalLabel);
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
    // 先扫描所有现有标签页，找已有的聊天页
    let chatPage = pg;
    if (browserContext) {
        for (const p of browserContext.pages()) {
            if (p.url().includes("claude.2233.ai") && (await p.locator(SEL.CHAT_INPUT).count().catch(() => 0)) > 0) {
                chatPage = p;
                page = p;
                isPageReady = true;
                return; // 已有聊天页，直接复用
            }
        }
    }
    // 监听新标签页
    browserContext.on("page", (newPg) => {
        newPg.url();
        setTimeout(async () => {
            if (newPg.url().includes("claude.2233.ai")) {
                chatPage = newPg;
                page = newPg;
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
        let loginToastShown = false;
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
            // 如果停在 dashboard，点击 Claude 的 "Use" 按钮
            const url = chatPage.url();
            if (url.includes("2233.ai/dashboard") || url.includes("2233.ai/claude")) {
                // dashboard 上有两个 Use 按钮，Claude 的在 /claude/renew 旁边（第二个）
                const useBtn = chatPage.locator('button:has-text("Use"), button:has-text("使用")').nth(1);
                if (await useBtn.count() > 0 && await useBtn.isVisible().catch(() => false)) {
                    await useBtn.click({ timeout: 3000 }).catch(() => { });
                    await sleep(4000);
                }
                else {
                    // 兜底：直接导航
                    await chatPage.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => { });
                    await sleep(3000);
                }
                continue;
            }
            // 未登录才提示
            if (!loginToastShown) {
                loginToastShown = true;
                await showToast(chatPage, "🔑 请在此浏览器窗口登录 Claude 镜像站，登录完成后将自动继续…").catch(() => { });
            }
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
    // 使用全局 page（可能已切换到新标签页）
    const chatPg = page || pg;
    if (attachments?.length)
        await uploadFiles(chatPg, attachments);
    await showToast(chatPg, "📤 发送中...");
    // 设置文本，确保输入框内容正确
    for (let i = 0; i < 3; i++) {
        await chatPg.locator(SEL.CHAT_INPUT).first().evaluate((el, t) => {
            el.innerText = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.innerText = t;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }, question);
        await sleep(200);
        const setText = await chatPg.locator(SEL.CHAT_INPUT).first().evaluate((el) => el.innerText).catch(() => "");
        if (setText?.includes(question.slice(0, 10)))
            break;
    }
    // 鼠标点击发送按钮（最可靠）
    await sleep(500);
    const sent = await chatPg.evaluate(() => {
        const btns = [...document.querySelectorAll("button")];
        const send = btns.find(b => {
            const label = b.getAttribute("aria-label") || "";
            const html = b.innerHTML || "";
            return !b.disabled && (label.toLowerCase().includes("send") || html.toLowerCase().includes("send") || html.includes("发送"));
        });
        if (send) {
            send.click();
            return true;
        }
        return false;
    }).catch(() => false);
    // 找不到发送按钮，尝试 Enter
    if (!sent) {
        await chatPg.locator(SEL.CHAT_INPUT).first().focus().catch(() => { });
        await sleep(200);
        await chatPg.keyboard.press("Enter");
    }
    await sleep(1500);
    await showToast(chatPg, "⏳ 等待回答...");
    // 等待回答：检测 "用户消息" 后面的内容开始增长
    const questionHead = question.slice(0, 10);
    let lastAfterLen = 0, stableCount = 0;
    for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const body = await chatPg.evaluate(() => document.body.innerText);
        const idx = body.lastIndexOf(questionHead);
        if (idx < 0)
            continue; // 用户消息还没出现在 body 中
        const after = body.slice(idx + questionHead.length);
        if (after.length <= 5)
            continue; // 回复还没来
        if (after.length === lastAfterLen)
            stableCount++;
        else {
            stableCount = 0;
            lastAfterLen = after.length;
        }
        if (stableCount >= 5)
            break; // 连续 5 秒无变化，回复完成
    }
    // 返回 body 全部文本
    const answer = await chatPg.evaluate(() => document.body.innerText.trim());
    if (!answer || answer.length < 5)
        throw new Error("Failed to extract answer");
    await showToast(chatPg, "✅ 回答完成", 2000);
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
