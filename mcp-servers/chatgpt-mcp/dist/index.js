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
// @ts-ignore
import { loadRole } from "../../shared/role.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
function getProfileDir(target) {
    if (process.env.CHATGPT_USER_DATA_DIR)
        return path.join(process.env.CHATGPT_USER_DATA_DIR, target);
    const dir = target === "official" ? ".chatgpt-official-profile" : ".chatgpt-mirror-profile";
    return path.join(PROJECT_ROOT, dir);
}
const HEADLESS = process.env.CHATGPT_HEADLESS === "true";
const DEBUG = process.env.CHATGPT_DEBUG === "true";
const CONSTRAINTS = `【强制约束】\n1. 最小修改原则：只改 bug 相关行。\n2. 禁止编造。\n3. 安全红线。`;
const CODE_MODIFY_RE = /写代码|帮我写|修复|改\b|修改|重构|优化|实现|加个|删掉|替换|调整|改下|修下|补一下|添加|移除|fix(?:ing|es)?|implement(?:s|ing|ed)?|refactor(?:s|ing|ed)?|modify(?:ing|ed)?|change[sd]?|updat[esd]|rewrite[sdn]?|correct(?:s|ing|ed)?|add[sd]?|remov[esd]|delet[esd]|replac[esd]|optimiz[esd]|patch(?:es|ing|ed)?|debug(?:s|ing|ed)?|(?:write|code)\s+(?:this|the|some|a|code)/i;
const EXPLAIN_ONLY_RE = /解释|说明|分析原因|为什么|是什么|怎么回事|什么意思|作用|原理|how\s+does|what\s+does|explain|clarify/i;
const SEL = {
    CHAT_INPUT: "#prompt-textarea",
    SEND_BTN: 'button.composer-submit-button-color, button[aria-label="Send"], [data-testid="send-button"]',
    FILE_INPUT: "#upload-files",
    PLUS_BTN: '[data-testid="composer-plus-btn"]',
    EXPIRED_SESSION: '#modal-expired-session, .login-required, [data-testid*="login"]',
    NEW_CHAT_BTN: 'button:has-text("New chat"), [data-testid="new-chat-button"], a:has-text("New chat")',
    DUPLICATE_BTN: 'button:has-text("确定"), button:has-text("OK"), [data-testid="confirm-button"]',
    STOP_BTN: 'button[aria-label*="stop" i], button[aria-label*="Stop"], button[aria-label*="停止"], [data-testid="stop-button"]',
    ATTACHMENT: '[class*="attachment"], [class*="file-preview"]',
    START_BTN: 'button:has-text("立即开始"), a:has-text("立即开始")',
    MIRROR_URL: "chatgpt.2233.ai",
    INVITE_URL: "https://2233.ai/?code=FC8XHSCH",
    CHAT_URL: "https://chatgpt.2233.ai/",
    OFFICIAL_URL: "https://chatgpt.com/",
    OFFICIAL_LOGIN: 'a[href*="login"], [data-testid="login-button"], [href*="auth0"]',
};
const LOCK_TIMEOUT_MS = 300000;
const lockQueue = [];
async function withLock(fn) {
    return new Promise((resolve, reject) => {
        let released = false;
        let timedOut = false;
        const release = () => {
            if (released)
                return;
            released = true;
            lockQueue.shift();
            if (lockQueue.length > 0)
                lockQueue[0]();
        };
        const timer = setTimeout(() => {
            timedOut = true;
            reject(new Error("Lock timeout — operation took too long"));
        }, LOCK_TIMEOUT_MS);
        lockQueue.push(async () => {
            try {
                resolve(await fn());
            }
            catch (e) {
                reject(e);
            }
            finally {
                clearTimeout(timer);
                if (timedOut) {
                    await closeBrowserResources();
                    isPageReady = false;
                }
                release();
            }
        });
        if (lockQueue.length === 1)
            lockQueue[0]();
    });
}
let browserContext = null;
let page = null;
let isPageReady = false;
let initPromise = null;
let activeRole = null;
let activeTarget = null;
function log(...args) { if (DEBUG)
    console.error("[ask_chatgpt]", ...args); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function closeBrowserResources() {
    browserContext = null;
    page = null;
    initPromise = null;
    isPageReady = false;
}
let cleaning = false;
function cleanup() {
    if (cleaning)
        return;
    cleaning = true;
    process.exitCode = 0;
    const ctx = browserContext;
    Promise.race([
        (async () => {
            await closeBrowserResources();
            if (ctx) {
                try {
                    await ctx.close();
                }
                catch { }
            }
        })(),
        new Promise(r => setTimeout(r, 15000)),
    ]).finally(() => setTimeout(() => process.exit(), 200));
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (err) => { console.error("[ask_chatgpt] uncaughtException:", err); cleanup(); });
process.on("unhandledRejection", (err) => { console.error("[ask_chatgpt] unhandledRejection:", err); cleanup(); });
async function findChatPage(ctx, target) {
    const targetUrl = target === "official" ? "chatgpt.com" : SEL.MIRROR_URL;
    for (let pass = 0; pass < 2; pass++) {
        for (const p of ctx.pages()) {
            try {
                const url = p.url();
                if (!url || url === "about:blank")
                    continue;
                if (url.includes(targetUrl) && (await p.locator(SEL.CHAT_INPUT).count()) > 0)
                    return p;
            }
            catch { }
        }
        if (pass === 0)
            await sleep(500);
    }
    return null;
}
async function ensureBrowser(target = "mirror") {
    if (browserContext && page) {
        try {
            if (!page.isClosed() && (await page.locator(SEL.CHAT_INPUT).count()) > 0)
                return { page: page, context: browserContext };
        }
        catch { }
        await closeBrowserResources();
    }
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        try {
            await closeBrowserResources();
            const profileDir = getProfileDir(target);
            browserContext = await launchBrowser(chromium, profileDir, HEADLESS);
            for (const p of browserContext.pages()) {
                try {
                    await p.close();
                }
                catch { }
            }
            page = await browserContext.newPage();
            isPageReady = false;
            return { page: page, context: browserContext };
        }
        catch (firstErr) {
            console.error("[ensureBrowser] launch failed:", firstErr instanceof Error ? firstErr.message : String(firstErr));
            await closeBrowserResources();
            // retry一次
            try {
                browserContext = await launchBrowser(chromium, getProfileDir(target), HEADLESS);
                page = await browserContext.newPage();
                isPageReady = false;
                return { page: page, context: browserContext };
            }
            catch (secondErr) {
                initPromise = null;
                throw new Error(`Failed to launch browser: ${secondErr instanceof Error ? secondErr.message : String(secondErr)}`);
            }
        }
    })();
    return initPromise;
}
// --- Core ---
async function askChatGPT(question, target = "mirror", attachments, role) {
    let retries = 2;
    let lastError;
    while (retries > 0) {
        try {
            // Health check
            if (isPageReady) {
                const pageDead = !page || !browserContext ? true : (() => { try {
                    return page.isClosed();
                }
                catch {
                    return true;
                } })();
                if (pageDead) {
                    await closeBrowserResources();
                    isPageReady = false;
                }
            }
            if (isPageReady && page) {
                try {
                    await Promise.race([page.evaluate(() => 1 + 1), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 2000))]);
                }
                catch { }
            }
            // Target switch
            if (target !== activeTarget) {
                await closeBrowserResources();
                isPageReady = false;
                initPromise = null;
                activeTarget = target;
                activeRole = null;
            }
            const { page: pg } = await ensureBrowser(target);
            if (!isPageReady) {
                let foundPage = await findChatPage(browserContext, target);
                if (foundPage) {
                    page = foundPage;
                    isPageReady = true;
                    log("Reusing existing chat page");
                }
                else if (target === "official") {
                    await pg.goto(SEL.OFFICIAL_URL, { waitUntil: "domcontentloaded" });
                    if (await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false)) {
                        isPageReady = true;
                    }
                    else if (await pg.locator(SEL.OFFICIAL_LOGIN).first().isVisible().catch(() => false)) {
                        if (!HEADLESS)
                            await pg.bringToFront();
                        await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
                        isPageReady = true;
                    }
                    else {
                        throw new Error("Cannot access ChatGPT.");
                    }
                }
                else {
                    // Mirror: navigate to invite URL → click → then direct to chat
                    await pg.goto(SEL.INVITE_URL, { waitUntil: "domcontentloaded" });
                    const startBtn = pg.locator(SEL.START_BTN);
                    if ((await startBtn.count()) > 0 && (await startBtn.isVisible())) {
                        await startBtn.first().evaluate((el) => (el.disabled = false));
                        await sleep(200);
                        await startBtn.first().click();
                    }
                    await pg.goto(SEL.CHAT_URL, { waitUntil: "domcontentloaded" });
                    if (await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false)) {
                        isPageReady = true;
                    }
                    else {
                        if (!HEADLESS)
                            await pg.bringToFront();
                        console.error("=== 请在镜像站登录 ===");
                        await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
                        isPageReady = true;
                    }
                }
            }
            else {
                // Session already ready, verify chat input
                const ready = await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
                if (!ready) {
                    const found = await findChatPage(browserContext, target);
                    if (found) {
                        page = found;
                        isPageReady = true;
                    }
                    else {
                        await pg.goto(SEL.CHAT_URL, { waitUntil: "domcontentloaded" }).catch(() => { });
                        isPageReady = false;
                    }
                }
            }
            // Role dispatch
            const effectiveRole = role || null;
            if (effectiveRole && effectiveRole !== activeRole) {
                try {
                    const newChatBtn = pg.locator(SEL.NEW_CHAT_BTN).first();
                    if ((await newChatBtn.count()) > 0 && (await newChatBtn.isVisible()))
                        await newChatBtn.click();
                }
                catch { }
                const tmpl = loadRole(path.resolve(PROJECT_ROOT, "..", "roles"), effectiveRole);
                if (tmpl) {
                    await pg.locator(SEL.CHAT_INPUT).first().evaluate((el) => (el.innerText = tmpl));
                    const btn = pg.locator(SEL.SEND_BTN).first();
                    if ((await btn.count()) > 0 && (await btn.isVisible()))
                        await btn.click();
                    else
                        await pg.keyboard.press("Enter");
                    await sleep(200);
                }
                activeRole = effectiveRole;
            }
            if (attachments?.length)
                await uploadFiles(pg, attachments, { fileInputSelector: SEL.FILE_INPUT, duplicateBtnSelector: SEL.DUPLICATE_BTN });
            const prevMsgSel = '[data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"] .prose, [data-message-author-role="assistant"]';
            let prevMsgCount = await pg.locator(prevMsgSel).count();
            const q = (question || "Please analyze this file").trim();
            const hasModify = CODE_MODIFY_RE.test(q);
            const hasExplain = EXPLAIN_ONLY_RE.test(q);
            const finalQ = q + (hasModify && !hasExplain ? CONSTRAINTS : "");
            await pg.locator(SEL.CHAT_INPUT).first().evaluate((el) => (el.innerText = ""));
            await pg.locator(SEL.CHAT_INPUT).first().evaluate((el, text) => {
                el.innerText = text;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }, finalQ);
            const sendBtn = pg.locator(SEL.SEND_BTN).first();
            if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible()))
                await sendBtn.click();
            else {
                await pg.keyboard.press("Enter");
            }
            if (!HEADLESS)
                await pg.bringToFront();
            await waitForNewMessage(pg, prevMsgSel, prevMsgCount);
            await waitForAnswer(pg, prevMsgSel, SEL.STOP_BTN);
            const answerText = await extractNewAnswers(pg, prevMsgSel, prevMsgCount);
            if (!answerText)
                throw new Error("Failed to extract answer");
            return answerText;
        }
        catch (error) {
            lastError = error;
            const msg = error instanceof Error ? error.message : String(error);
            const recoverable = msg.includes("closed") || msg.includes("timeout") || msg.includes("Target") || msg.includes("detached") || msg.includes("net::ERR_");
            if (recoverable && retries > 1) {
                console.error("[askChatGPT] retrying:", msg);
                await closeBrowserResources();
                isPageReady = false;
                initPromise = null;
                retries--;
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
// --- MCP Server ---
const server = new Server({ name: "chatgpt-mcp", version: "2.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
            name: "ask_chatgpt",
            description: "Use ChatGPT (chatgpt.com or mirror 2233.ai) free web version (zero API token).",
            inputSchema: {
                type: "object",
                properties: {
                    question: { type: "string" },
                    attachments: { type: "array", items: { type: "string" } },
                    role: { type: "string" },
                    target: { type: "string", enum: ["mirror", "official"] },
                },
            },
        }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "ask_chatgpt")
        throw new Error("Unknown tool");
    const raw = request.params.arguments || {};
    const question = typeof raw.question === "string" ? raw.question : "";
    const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter((v) => typeof v === "string") : undefined;
    const role = typeof raw.role === "string" && raw.role.trim() ? raw.role.trim() : undefined;
    let target = "mirror";
    if (raw.target === "official" || raw.target === "mirror")
        target = raw.target;
    return withLock(async () => {
        try {
            const answer = await askChatGPT(question, target, attachments, role);
            const siteLabel = target === "official" ? "ChatGPT" : "ChatGPT Mirror";
            let pgUrl = "";
            try {
                if (page && !page.isClosed())
                    pgUrl = page.url();
            }
            catch { }
            const urlInfo = pgUrl ? `\n[当前页面: ${pgUrl}]\n[activeTarget: ${activeTarget}]` : "";
            return { content: [{ type: "text", text: `【${siteLabel} answer】${urlInfo}\n\n${answer}` }] };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `ChatGPT call failed (${target}): ${msg}` }], isError: true };
        }
    });
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("ChatGPT MCP Server running on stdio");
}
main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
