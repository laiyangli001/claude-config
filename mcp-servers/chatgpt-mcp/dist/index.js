import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync } from "child_process";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
function getProfileDir(target) {
    if (process.env.CHATGPT_USER_DATA_DIR) {
        return path.join(process.env.CHATGPT_USER_DATA_DIR, target);
    }
    const dir = target === "official" ? ".chatgpt-official-profile" : ".chatgpt-mirror-profile";
    return path.join(PROJECT_ROOT, dir);
}
const HEADLESS = process.env.CHATGPT_HEADLESS === "true";
const DEBUG = process.env.CHATGPT_DEBUG === "true";
const _idleMs = parseInt(process.env.CHATGPT_IDLE_LIMIT_MS || "1500", 10);
const IDLE_LIMIT_MS = Number.isNaN(_idleMs) ? 1500 : _idleMs;
const CONSTRAINTS = `
【强制约束】
1. 最小修改原则：只改 bug 相关行，禁止顺手重构、禁止提取新函数、禁止加新注释。
2. 禁止编造：没看到的文件/API 不要假设存在，不确定就先问。
3. 安全红线：禁止拼接 SQL，禁止 XSS，禁止硬编码密钥。
4. 输出格式：先给修复后的代码块，再简述改了什么。不要问候语。`;
// 需要施加约束的代码修改意图关键词
const CODE_MODIFY_RE = /写代码|帮我写|修复|改\b|修改|重构|优化|实现|加个|删掉|替换|调整|改下|修下|补一下|添加|移除|fix(?:ing|es)?|implement(?:s|ing|ed)?|refactor(?:s|ing|ed)?|modify(?:ing|ed)?|change[sd]?|updat[esd]|rewrite[sdn]?|correct(?:s|ing|ed)?|add[sd]?|remov[esd]|delet[esd]|replac[esd]|optimiz[esd]|patch(?:es|ing|ed)?|debug(?:s|ing|ed)?|(?:write|code)\s+(?:this|the|some|a|code)/i;
const EXPLAIN_ONLY_RE = /解释|说明|分析原因|为什么|是什么|怎么回事|什么意思|作用|原理|how\s+does|what\s+does|explain|clarify/i;
// --- Role system ---
const ROLES_DIR = process.env.CHATGPT_ROLES_DIR || path.resolve(PROJECT_ROOT, "../roles");
async function loadRole(roleName) {
    if (!/^[a-zA-Z0-9_-]+$/.test(roleName)) {
        throw new Error(`Invalid role name: ${roleName}`);
    }
    const filePath = path.join(ROLES_DIR, `${roleName}.md`);
    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
        return await fs.promises.readFile(filePath, "utf-8");
    }
    catch {
        return null;
    }
}
function log(...args) {
    if (DEBUG)
        console.error("[ask_chatgpt]", ...args);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// --- Centralized selectors ---
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
const _lockTimeout = parseInt(process.env.CHATGPT_LOCK_TIMEOUT_MS || "300000", 10);
const LOCK_TIMEOUT_MS = Number.isNaN(_lockTimeout) || _lockTimeout < 1000 ? 300000 : _lockTimeout;
// Queue-based serial lock for concurrent requests
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
            // Don't release the lock — the still-running task would corrupt global state.
            // The task's finally block will call release() when it eventually completes.
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
                    // 超时的任务可能已污染全局状态；强制下次请求重建浏览器
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
// --- Browser ---
let browserContext = null;
let page = null;
let isPageReady = false;
let initPromise = null;
let activeRole = null;
let activeTarget = null;
async function closeBrowserResources() {
    browserContext = null;
    page = null;
    initPromise = null;
    isPageReady = false;
    // 不关闭浏览器进程 — 保持打开以便后续复用
}
async function findChatPage(ctx, target) {
    const targetUrl = target === "official" ? "chatgpt.com" : SEL.MIRROR_URL;
    for (let pass = 0; pass < 2; pass++) {
        for (const p of ctx.pages()) {
            try {
                const url = p.url();
                if (!url || url === "about:blank")
                    continue;
                if (url.includes(targetUrl) && (await p.locator(SEL.CHAT_INPUT).count()) > 0) {
                    return p;
                }
            }
            catch { /* page not ready */ }
        }
        if (pass === 0)
            await sleep(500);
    }
    return null;
}
async function ensureBrowser(target = "mirror") {
    if (browserContext && page && !page.isClosed()) {
        // Verify the cached page actually has the chat input
        try {
            const hasInput = await page.locator(SEL.CHAT_INPUT).count();
            if (hasInput > 0)
                return { page, context: browserContext };
        }
        catch { /* page state invalid, fall through */ }
        log("Cached page invalid, reinitializing");
        await closeBrowserResources();
        isPageReady = false;
    }
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        try {
            await closeBrowserResources();
            // 清理上次崩溃遗留的 Chrome 锁文件
            const profileDir = getProfileDir(target);
            for (const f of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
                try {
                    await fs.promises.unlink(path.join(profileDir, f));
                }
                catch { }
            }
            // 杀掉占用本配置目录的旧 chrome.exe（孤儿进程），释放锁
            try {
                const result = execSync(`wmic process where "name='chrome.exe' and commandline like '%${profileDir}%'" get processid /format:csv 2>nul`, { encoding: "utf8", timeout: 10000 });
                const pids = result.trim().split(/\s*\n\s*/).slice(1).filter(id => id && id !== "ProcessId").map(l => l.split(",").pop() || "").filter(id => /^\d+$/.test(id));
                for (const pid of pids) {
                    try {
                        execSync("taskkill /f /pid " + pid + " 2>nul", { timeout: 3000 });
                    }
                    catch { }
                }
                if (pids.length > 0)
                    await sleep(1500);
            }
            catch { /* no orphan process */ }
            browserContext = await chromium.launchPersistentContext(profileDir, {
                headless: HEADLESS,
                viewport: { width: 1280, height: 800 },
                args: ["--disable-blink-features=AutomationControlled"],
            });
            // 轮询等待持久化页面还原（最长 3s，尽可能短）
            for (let i = 0; i < 6; i++) {
                const existing = await findChatPage(browserContext, target);
                if (existing) {
                    page = existing;
                    isPageReady = true;
                    log(`Reusing existing page: ${existing.url()}`);
                    return { page, context: browserContext };
                }
                await sleep(500);
            }
            page = await browserContext.newPage();
            isPageReady = false;
            return { page, context: browserContext };
        }
        catch (firstErr) {
            log("First launch failed, retrying after close...");
            await closeBrowserResources();
            await sleep(2000);
            try {
                // 重试前再次清理锁文件
                for (const f of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
                    try {
                        await fs.promises.unlink(path.join(getProfileDir(target), f));
                    }
                    catch { }
                }
                browserContext = await chromium.launchPersistentContext(getProfileDir(target), {
                    headless: HEADLESS,
                    viewport: { width: 1280, height: 800 },
                    args: ["--disable-blink-features=AutomationControlled"],
                });
                // Poll for existing pages (max 3s)
                for (let i = 0; i < 6; i++) {
                    const existing = await findChatPage(browserContext, target);
                    if (existing) {
                        page = existing;
                        isPageReady = true;
                        log(`Reusing page after retry: ${existing.url()}`);
                        return { page, context: browserContext };
                    }
                    await sleep(500);
                }
                page = await browserContext.newPage();
                isPageReady = false;
                return { page, context: browserContext };
            }
            catch (secondErr) {
                initPromise = null;
                throw new Error(`Failed to launch browser: ${secondErr instanceof Error ? secondErr.message : String(secondErr)}`);
            }
        }
    })();
    return initPromise;
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
                catch (e) {
                    log("Error closing browser on exit:", e);
                }
            }
        })(),
        new Promise((r) => setTimeout(r, 15000)),
    ]).finally(() => setTimeout(() => process.exit(), 200));
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (err) => {
    console.error("[ask_chatgpt] uncaughtException:", err);
    cleanup();
});
process.on("unhandledRejection", (err) => {
    console.error("[ask_chatgpt] unhandledRejection:", err);
    cleanup();
});
// --- Role dispatch ---
async function sendRoleTemplate(pg, roleName) {
    const template = await loadRole(roleName);
    if (!template) {
        throw new Error(`Role file not found: ${roleName}`);
    }
    log(`Sending role template: ${roleName}`);
    await pg.locator(SEL.CHAT_INPUT).first().evaluate((el, text) => {
        el.innerText = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }, template);
    await sleep(500);
    const sendBtn = pg.locator(SEL.SEND_BTN).first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
        await sendBtn.click();
    }
    else {
        await pg.locator(SEL.CHAT_INPUT).first().evaluate((el) => {
            el.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await pg.keyboard.press("Enter");
        await sleep(200);
    }
    // Wait for the first assistant answer to appear
    try {
        const roleAnswerSel = await findAnswerSelector(pg);
        await pg.waitForSelector(roleAnswerSel, { timeout: 60000, state: "visible" });
        await waitForAnswerComplete(pg, roleAnswerSel);
    }
    catch {
        log("Role template answer wait timeout, continuing anyway");
    }
    activeRole = roleName;
    log(`Role template sent: ${roleName}`);
}
// --- Upload ---
async function uploadFilesToChatGPT(page, filePaths) {
    if (filePaths.length === 0)
        return;
    for (const fp of filePaths) {
        if (!path.isAbsolute(fp))
            throw new Error(`Path must be absolute: ${fp}`);
        try {
            await fs.promises.access(fp, fs.constants.R_OK);
        }
        catch {
            throw new Error(`File not found: ${fp}`);
        }
        const stat = await fs.promises.stat(fp);
        if (!stat.isFile())
            throw new Error(`Not a regular file: ${fp}`);
    }
    // ChatGPT: use hidden file input for upload
    const fileInput = page.locator(SEL.FILE_INPUT);
    if ((await fileInput.count()) === 0) {
        const plusBtn = page.locator(SEL.PLUS_BTN);
        if ((await plusBtn.count()) > 0 && (await plusBtn.isVisible())) {
            await plusBtn.click();
            await page.waitForSelector(SEL.FILE_INPUT, { timeout: 5000 });
        }
    }
    const uploadInput = page.locator(SEL.FILE_INPUT).first();
    await uploadInput.setInputFiles([]); // clear previous
    await uploadInput.setInputFiles(filePaths);
    await uploadInput.evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
    // Handle "You already uploaded this file" dialog
    try {
        const duplicateBtn = page.locator(SEL.DUPLICATE_BTN);
        if ((await duplicateBtn.count()) > 0 && (await duplicateBtn.first().isVisible())) {
            await duplicateBtn.first().click();
            log("Dismissed duplicate file dialog");
            await sleep(500);
        }
    }
    catch (e) {
        log("Duplicate dialog check error:", e);
    }
    // Wait for all attachments to appear (count matches)
    for (let i = 0; i < 15; i++) {
        const count = await page.locator(SEL.ATTACHMENT).count().catch(() => 0);
        if (count >= filePaths.length)
            break;
        await sleep(1000);
    }
}
// --- Answer ---
const ANSWER_SELECTORS = [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] .prose',
    '[data-message-author-role="assistant"]',
];
async function findAnswerSelector(page) {
    for (const sel of ANSWER_SELECTORS) {
        if ((await page.locator(sel).count()) > 0)
            return sel;
    }
    // 新对话还没有 assistant 消息，返回默认选择器（之后会匹配上）
    log("No existing assistant messages, using default selector");
    return ANSWER_SELECTORS[0];
}
async function waitForContentStable(page, selector) {
    await page.waitForFunction(({ sel, idleMs }) => {
        const els = document.querySelectorAll(sel);
        if (els.length === 0)
            return false;
        const last = els[els.length - 1];
        const curLen = (last.textContent || "").length;
        const prevLen = parseInt(last.dataset._ws || "", 10);
        const prevTime = parseInt(last.dataset._wt || "", 10);
        if (Number.isNaN(prevLen) || curLen > prevLen) {
            last.dataset._ws = String(curLen);
            last.dataset._wt = String(Date.now());
            return false;
        }
        return (Date.now() - prevTime) >= idleMs;
    }, { sel: selector, idleMs: IDLE_LIMIT_MS }, { timeout: 600000, polling: 1000 });
}
async function waitForAnswerComplete(page, answerSelector) {
    try {
        await waitForContentStable(page, answerSelector);
    }
    catch {
        log("waitForAnswerComplete timeout, continuing anyway");
    }
}
async function extractNewAnswers(page, answerSelector, startIndex) {
    return page.evaluate(({ sel, start }) => {
        const els = document.querySelectorAll(sel);
        const parts = [];
        for (let i = start; i < els.length; i++) {
            const el = els[i];
            // innerText 丢失格式，改用 innerHTML 转 Markdown
            const html = el.innerHTML || "";
            if (!html)
                continue;
            // 简单 HTML→Markdown 转换：<code> → ``, <strong> → **, <br> → 换行
            const text = html
                // 先解码实体，确保后续处理（如代码块包装）拿到正确的字符
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/p>/gi, "\n")
                .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
                .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
                .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
                .replace(/<[^>]+>/g, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            if (text)
                parts.push(text);
        }
        return parts.join("\n\n");
    }, { sel: answerSelector, start: startIndex });
}
// --- Core (unified: target="mirror" | "official") ---
async function askChatGPT(question, target = "mirror", attachments, role) {
    let retries = 2;
    let lastError;
    while (retries > 0) {
        try {
            // Health check: reset if page died or unresponsive
            if (isPageReady && (!page || page.isClosed() || !browserContext)) {
                log("Page invalid, reinitializing");
                await closeBrowserResources();
                isPageReady = false;
            }
            // Heartbeat — detect crashed-but-not-closed pages
            if (isPageReady && page) {
                try {
                    await Promise.race([
                        page.evaluate(() => 1 + 1),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Heartbeat timeout")), 2000)),
                    ]);
                }
                catch (e) {
                    const hsMsg = e instanceof Error ? e.message : "";
                    if (hsMsg.includes("detached") || hsMsg.includes("closed") || hsMsg.includes("Target")) {
                        log("Page crashed, resetting");
                        await closeBrowserResources();
                        isPageReady = false;
                    }
                    else {
                        log("Heartbeat timeout (non-critical), skipping reset");
                    }
                }
            }
            // Session expiry detection (branch by target)
            if (isPageReady && page) {
                try {
                    let expired = false;
                    if (target === "official") {
                        const url = page.url();
                        expired = url.includes("auth0") || url.includes("login");
                    }
                    else {
                        expired = await page.locator(SEL.EXPIRED_SESSION).first().isVisible().catch(() => false) || page.url().includes("/list");
                    }
                    if (expired) {
                        const siteLabel = target === "official" ? "ChatGPT" : "镜像站";
                        log(`Session expired (${siteLabel}), waiting for re-login...`);
                        console.error(`=== ${siteLabel}会话已过期，请在浏览器中重新登录 ===`);
                        try {
                            await page.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
                            isPageReady = true;
                            log("Session restored after re-login");
                        }
                        catch {
                            throw new Error("Session expired. Please log in again in the browser window.");
                        }
                    }
                }
                catch (e) {
                    if (e instanceof Error && !e.message.includes("Session expired"))
                        throw e;
                }
            }
            // 切换 target 时重建浏览器（不同 profile）
            if (target !== activeTarget) {
                log(`Target switch: ${activeTarget} → ${target}`);
                await closeBrowserResources();
                isPageReady = false;
                initPromise = null;
                activeTarget = target;
                activeRole = null;
            }
            let { page: pg } = await ensureBrowser(target);
            if (!isPageReady) {
                // 在所有页面中查找已有的对话页（每次重新查找，不依赖缓存）
                let foundPage = await findChatPage(browserContext, target);
                if (foundPage) {
                    pg = foundPage;
                    page = foundPage;
                    isPageReady = true;
                    log("Reusing existing chat page");
                }
                else if (target === "official") {
                    // 官方站：直接导航到 chatgpt.com
                    log("Navigating to official ChatGPT...");
                    await pg.goto(SEL.OFFICIAL_URL, { waitUntil: "domcontentloaded" });
                    const ready = await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false);
                    if (ready) {
                        isPageReady = true;
                        log("Official ChatGPT page ready");
                    }
                    else {
                        const loginBtn = await pg.locator(SEL.OFFICIAL_LOGIN).first().isVisible().catch(() => false);
                        if (loginBtn) {
                            if (!HEADLESS)
                                await pg.bringToFront();
                            console.error("=== 请登录 ChatGPT，等待页面加载完成 ===");
                            await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
                            isPageReady = true;
                        }
                        else {
                            throw new Error("Cannot access ChatGPT — page did not load and no login prompt detected.");
                        }
                    }
                }
                else {
                    // === 镜像站：导航到聊天页 ===
                    log("Opening mirror chat...");
                    await pg.goto(SEL.INVITE_URL, { waitUntil: "domcontentloaded" });
                    await pg.waitForTimeout(3000);
                    // 点击"立即开始"（无论是否已登录）
                    const startBtn = pg.locator(SEL.START_BTN);
                    if ((await startBtn.count()) > 0 && (await startBtn.isVisible())) {
                        log("Auto-clicking 立即开始");
                        await startBtn.first().evaluate((el) => {
                            el.disabled = false;
                        });
                        await sleep(200);
                        await startBtn.first().click();
                    }
                    else {
                        // Fallback
                        if (!HEADLESS)
                            await pg.bringToFront();
                        console.error("=== 请点击「立即开始」按钮 ===");
                    }
                    // 等待页面跳转（不再弹 popup，而是当前页跳转到套餐页或聊天页）
                    await sleep(3000);
                    const currentUrl = pg.url();
                    log("After click URL: " + currentUrl);
                    // 无论去了套餐页还是哪里，直接导航到聊天页
                    await pg.goto(SEL.CHAT_URL, { waitUntil: "domcontentloaded" });
                    const chatReady = await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false);
                    if (chatReady) {
                        isPageReady = true;
                        log("Mirror chat page ready");
                    }
                    else {
                        if (!HEADLESS)
                            await pg.bringToFront();
                        console.error("=== 请在镜像站登录，等待页面加载完成 ===");
                        await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 120000 });
                        isPageReady = true;
                    }
                    log("Mirror site navigation complete");
                } // close mirror else
            }
            else {
                // 继续使用当前对话，但验证页面状态
                const chatReady = await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
                if (!chatReady) {
                    // 页面可能变成空白页，重新查找或导航
                    log("Page lost chat input, re-finding...");
                    const found = await findChatPage(browserContext, target);
                    if (found) {
                        pg = found;
                        page = found;
                        isPageReady = true;
                    }
                    else {
                        // 直接导航当前页面到聊天页
                        log("No chat page found, navigating directly");
                        const fallbackUrl = target === "official" ? SEL.OFFICIAL_URL : SEL.CHAT_URL;
                        await pg.goto(fallbackUrl, { waitUntil: "domcontentloaded" }).catch(() => { });
                        const restored = await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
                        if (restored)
                            isPageReady = true;
                    }
                }
            }
            // --- Role dispatch (first call or role change) ---
            const effectiveRole = role || null;
            if (effectiveRole && effectiveRole !== activeRole) {
                log(`Role switch: ${activeRole} → ${effectiveRole}`);
                // Fresh conversation for new role
                try {
                    const newChatBtn = pg.locator(SEL.NEW_CHAT_BTN).first();
                    if ((await newChatBtn.count()) > 0 && (await newChatBtn.isVisible())) {
                        await newChatBtn.click();
                        await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 10000 }).catch(() => { });
                    }
                }
                catch { /* ignore */ }
                await sendRoleTemplate(pg, effectiveRole);
            }
            if (attachments && attachments.length > 0) {
                await uploadFilesToChatGPT(pg, attachments);
            }
            // Type into ProseMirror editor (clear first to prevent cross-request pollution)
            // 只在代码修改意图时加 CONSTRAINTS（纯解释类不加）
            const q = (question && question.trim()) || "Please analyze this file";
            const hasModifyIntent = CODE_MODIFY_RE.test(q);
            const hasExplainIntent = EXPLAIN_ONLY_RE.test(q);
            const finalQuestion = q + (hasModifyIntent && !hasExplainIntent ? CONSTRAINTS : "");
            await pg.locator(SEL.CHAT_INPUT).first().evaluate((el) => {
                el.innerText = "";
            });
            await pg.locator(SEL.CHAT_INPUT).first().evaluate((el, text) => {
                el.innerText = text;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }, finalQuestion);
            let prevCountSel = await findAnswerSelector(pg);
            let prevMsgCount = await pg.locator(prevCountSel).count();
            // Click send button
            await sleep(500);
            const sendBtn = pg.locator(SEL.SEND_BTN).first();
            if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
                await sendBtn.click();
            }
            else {
                await pg.locator(SEL.CHAT_INPUT).first().evaluate((el) => {
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                });
                await pg.keyboard.press("Enter");
                await sleep(200);
            }
            if (!HEADLESS)
                await pg.bringToFront();
            // 最多 3 次尝试：提取为空则 F5 恢复页面后重发
            let answerText = "";
            for (let attempt = 1; attempt <= 3; attempt++) {
                if (attempt > 1) {
                    log(`Answer empty (attempt ${attempt - 1}), refreshing and retrying...`);
                    await pg.reload({ waitUntil: "domcontentloaded" });
                    await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 30000 }).catch(() => { });
                    prevCountSel = await findAnswerSelector(pg);
                    prevMsgCount = await pg.locator(prevCountSel).count();
                    // 重发问题
                    await pg.locator(SEL.CHAT_INPUT).first().evaluate((el) => {
                        el.innerText = "";
                    });
                    await pg.locator(SEL.CHAT_INPUT).first().evaluate((el, text) => {
                        el.innerText = text;
                        el.dispatchEvent(new Event("input", { bubbles: true }));
                    }, finalQuestion);
                    await sleep(500);
                    const sendBtn = pg.locator(SEL.SEND_BTN).first();
                    if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
                        await sendBtn.click();
                    }
                    else {
                        await pg.keyboard.press("Enter");
                        await sleep(200);
                    }
                }
                // 等待新消息数量增加（确认是新生成的回答）
                const countIncreaseWait = async () => {
                    for (let i = 0; i < 300; i++) {
                        const cnt = await pg.locator(prevCountSel).count();
                        if (cnt > prevMsgCount)
                            return;
                        await sleep(500);
                    }
                };
                await countIncreaseWait().catch(() => { });
                // 新消息出现后检查 stop 按钮: 可见→等它消失(生成完成), 不可见/不存在→直接提取
                const stopBtn = pg.locator(SEL.STOP_BTN).first();
                try {
                    const visible = await stopBtn.isVisible().catch(() => false);
                    if (visible) {
                        await stopBtn.waitFor({ state: "hidden", timeout: 60000 });
                        await sleep(300);
                    }
                }
                catch { /* stop btn never appeared, answer done */ }
                answerText = await extractNewAnswers(pg, prevCountSel, prevMsgCount);
                const ansCount = await pg.locator(prevCountSel).count();
                log(`extract: sel=${prevCountSel} start=${prevMsgCount} total=${ansCount} len=${answerText.length} attempt=${attempt}`);
                if (answerText)
                    break;
            }
            if (!answerText) {
                throw new Error("多次尝试后仍未获取到 ChatGPT 回答，请检查网络连接或页面状态。");
            }
            return answerText;
        }
        catch (error) {
            lastError = error;
            const msg = error instanceof Error ? error.message : String(error);
            const recoverable = msg.includes("closed")
                || msg.includes("Navigation timeout") || msg.includes("Target page")
                || msg.includes("detached") || msg.includes("Timeout") || msg.includes("Timed out")
                || msg.includes("net::ERR_") || msg.includes("Session");
            if (recoverable && retries > 1) {
                log(`Recoverable error, resetting and retrying: ${msg}`);
                await closeBrowserResources();
                isPageReady = false;
                initPromise = null;
                retries--;
                continue;
            }
            // Only close browser for actual browser-level errors; keep it alive for operational failures
            if (msg.includes("closed") || msg.includes("detached") || msg.includes("Target")) {
                await closeBrowserResources();
            }
            isPageReady = false;
            throw error;
        }
    }
    // all retries exhausted — not closing browser so subsequent calls can reuse it
    isPageReady = false;
    throw lastError;
}
// --- MCP Server ---
const server = new Server({ name: "chatgpt-mcp", version: "2.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "ask_chatgpt",
            description: "Use ChatGPT (chatgpt.com or mirror 2233.ai) free web version (zero API token). Supports file attachments, multiple files allowed.",
            inputSchema: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Question to ask ChatGPT (required if no attachments)." },
                    attachments: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional absolute file paths to upload as attachments.",
                    },
                    role: {
                        type: "string",
                        description: "角色文件名（不含 .md），如 python_tutor。留空则自动检测。",
                    },
                    target: {
                        type: "string",
                        enum: ["mirror", "official"],
                        description: '目标站点: "mirror" (chatgpt.2233.ai, 默认) 或 "official" (chatgpt.com).',
                    },
                },
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "ask_chatgpt") {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const raw = request.params.arguments;
    let question;
    let attachments;
    let role;
    let target = "mirror";
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        if ("question" in raw) {
            if (typeof raw.question !== "string")
                throw new Error("'question' must be a string");
            question = raw.question;
        }
        if ("attachments" in raw && Array.isArray(raw.attachments)) {
            attachments = raw.attachments
                .filter((v) => typeof v === "string" && v.trim().length > 0)
                .map((v) => v.trim());
        }
        if ("role" in raw && typeof raw.role === "string" && raw.role.trim()) {
            role = raw.role.trim();
        }
        if ("target" in raw && typeof raw.target === "string") {
            if (raw.target === "official" || raw.target === "mirror") {
                target = raw.target;
            }
        }
    }
    if (!question && (!attachments || attachments.length === 0)) {
        throw new Error("At least one of 'question' or 'attachments' is required");
    }
    return withLock(async () => {
        try {
            const answer = await askChatGPT(question || "", target, attachments, role);
            const siteLabel = target === "official" ? "ChatGPT" : "ChatGPT Mirror";
            let source = "";
            if (attachments && attachments.length > 0) {
                source = ` (${attachments.length} attachment(s))`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `【${siteLabel} answer】${source}${(() => { try {
                            if (page && !page.isClosed()) {
                                let u = page.url();
                                return u ? "\n[当前页面: " + u + "]" : "";
                            }
                            return "";
                        }
                        catch {
                            return "";
                        } })()}\n[activeTarget: ${activeTarget}]\n\n${answer}\n\n---\nGenerated by ${target === "official" ? "chatgpt.com" : "chatgpt.2233.ai"}. Zero API token consumed.`,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `ChatGPT call failed (${target}): ${message}` }],
                isError: true,
            };
        }
    });
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("ChatGPT MCP Server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
