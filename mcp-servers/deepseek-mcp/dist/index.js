import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const USER_DATA_DIR = path.join(PROJECT_ROOT, ".deepseek-browser-profile");
// --- Config ---
const HEADLESS = process.env.DEEPSEEK_HEADLESS === "true";
const DEBUG = process.env.DEEPSEEK_DEBUG === "true";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // per-file limit
const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // total upload limit (matches DeepSeek)
const MAX_FILE_COUNT = 10;
// Fix 4: extended idle limit, configurable via env
const _idleMs = parseInt(process.env.DEEPSEEK_IDLE_LIMIT_MS || "8000", 10);
const IDLE_LIMIT_MS = Number.isNaN(_idleMs) ? 8000 : _idleMs;
const CONSTRAINTS = `
【强制约束】
1. 最小修改原则：只改 bug 相关行，禁止顺手重构、禁止提取新函数、禁止加新注释。
2. 禁止编造：没看到的文件/API 不要假设存在，不确定就先问。
3. 安全红线：禁止拼接 SQL，禁止 XSS，禁止硬编码密钥。
4. 输出格式：先给修复后的代码块，再简述改了什么。不要问候语。`;
const CODE_MODIFY_RE = /写代码|帮我写|修复|改\b|修改|重构|优化|实现|加个|删掉|替换|调整|改下|修下|补一下|添加|移除|fix(?:ing|es)?|implement(?:s|ing|ed)?|refactor(?:s|ing|ed)?|modify(?:ing|ed)?|change[sd]?|updat[esd]|rewrite[sdn]?|correct(?:s|ing|ed)?|add[sd]?|remov[esd]|delet[esd]|replac[esd]|optimiz[esd]|patch(?:es|ing|ed)?|debug(?:s|ing|ed)?|(?:write|code)\s+(?:this|the|some|a|code)|review\s+this\s+(?:code|file)/i;
const EXPLAIN_ONLY_RE = /解释|说明|分析原因|为什么|是什么|怎么回事|什么意思|作用|原理|how\s+does|what\s+does|explain|clarify/i;
// --- Role system ---
const ROLES_DIR = path.resolve(PROJECT_ROOT, "..", "roles");
function loadRole(roleName) {
    const filePath = path.join(ROLES_DIR, `${roleName}.md`);
    if (!fs.existsSync(filePath))
        return null;
    return fs.readFileSync(filePath, "utf-8");
}
function detectRole(question) {
    const q = question.toLowerCase();
    if (/python|django|flask|pep\s*8|pandas|numpy|asyncio|装饰器/.test(q))
        return "python_tutor";
    if (/node\.js|nodejs|javascript|express|nestjs|typescript|npm|js\b|回调|异步|event loop/.test(q))
        return "nodejs_tutor";
    return null;
}
function log(...args) {
    if (DEBUG)
        console.error("[ask_deepseek]", ...args);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Fix: serialize concurrent requests to prevent race on shared browser page
let activeRequestPromise = Promise.resolve();
function withLock(fn) {
    const result = activeRequestPromise.then(() => fn(), () => fn());
    // keep chain alive even on error so next request proceeds
    activeRequestPromise = result.then(() => { }, () => { });
    return result;
}
// --- Browser state ---
let browserContext = null;
let page = null;
let isPageReady = false;
let initPromise = null;
let activeRole = null;
// Close browser resources before nulling state
async function closeBrowserResources() {
    if (browserContext) {
        try {
            await browserContext.close();
        }
        catch (e) {
            log("Error closing browser:", e);
        }
        browserContext = null;
        page = null;
    }
}
function cleanup() {
    if (browserContext) {
        Promise.race([
            browserContext.close(),
            new Promise((resolve) => setTimeout(resolve, 2000)),
        ]).finally(() => process.exit(0));
    }
    else {
        process.exit(0);
    }
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
// --- Role dispatch ---
async function sendRoleTemplate(pg, roleName) {
    const template = loadRole(roleName);
    if (!template) {
        log(`Role file not found: ${roleName}`);
        return;
    }
    log(`Sending role template: ${roleName}`);
    const inputSelector = 'textarea, [contenteditable="true"]';
    const inputEl = pg.locator(inputSelector).first();
    // Clear and type role template
    await inputEl.evaluate((el) => { el.innerText = ""; }).catch(() => { });
    try {
        await inputEl.fill("");
    }
    catch { /* not a fillable element */ }
    const isContentEditableDiv = await inputEl.evaluate((el) => {
        return el.tagName === "DIV" && el.getAttribute("contenteditable") === "true";
    });
    if (isContentEditableDiv) {
        await inputEl.evaluate((el, text) => { el.innerText = text; }, template);
    }
    else {
        await inputEl.fill(template);
    }
    // Send
    const sendBtn = pg.locator('button[type="submit"], button:has-text("Send"), button:has-text("发送")').first();
    const hasSendBtn = (await sendBtn.count()) > 0 && (await sendBtn.isVisible());
    if (hasSendBtn) {
        await sendBtn.click();
        log("Clicked send button for role template");
    }
    else if (isContentEditableDiv) {
        await pg.keyboard.press("Control+Enter");
    }
    else {
        await pg.keyboard.press("Enter");
    }
    // Wait for response
    await pg.waitForSelector(ANSWER_SELECTORS.join(", "), { timeout: 300000, state: "visible" });
    const answerSelector = await findAnswerSelector(pg);
    await waitForAnswerComplete(pg, answerSelector);
    activeRole = roleName;
    log(`Role template sent: ${roleName}`);
}
// Fix 2: reset initPromise on error so future calls can retry
async function ensureBrowser() {
    if (browserContext && page && !page.isClosed()) {
        return { page, context: browserContext };
    }
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        try {
            await closeBrowserResources();
            browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: HEADLESS,
                viewport: { width: 1280, height: 800 },
                args: ["--disable-background-timer-throttling"],
            });
            page = await browserContext.newPage();
            isPageReady = false;
            return { page, context: browserContext };
        }
        catch {
            initPromise = null; // allow retry on next call
            throw new Error("Failed to launch browser. Close any running Chrome instances and try again.");
        }
    })();
    return initPromise;
}
// --- File upload ---
async function uploadFilesToDeepseek(page, filePaths) {
    if (filePaths.length === 0)
        return;
    // Validate file count, per-file size, and total size
    if (filePaths.length > MAX_FILE_COUNT) {
        throw new Error(`Too many files: ${filePaths.length} (max ${MAX_FILE_COUNT})`);
    }
    let totalSize = 0;
    for (const fp of filePaths) {
        if (!path.isAbsolute(fp))
            throw new Error(`Path must be absolute: ${fp}`);
        if (!fs.existsSync(fp))
            throw new Error(`File not found: ${fp}`);
        const size = fs.statSync(fp).size;
        if (size > MAX_FILE_SIZE) {
            const mb = (size / 1024 / 1024).toFixed(1);
            throw new Error(`File ${path.basename(fp)} exceeds 100MB (${mb}MB)`);
        }
        totalSize += size;
    }
    if (totalSize > MAX_TOTAL_SIZE) {
        const totalMB = (totalSize / 1024 / 1024).toFixed(1);
        throw new Error(`Total upload ${totalMB}MB exceeds 100MB limit`);
    }
    const totalKB = (filePaths.reduce((s, fp) => s + fs.statSync(fp).size, 0) / 1024).toFixed(1);
    log(`Uploading ${filePaths.length} file(s) (${totalKB} KB)`);
    const fileInput = page.locator('input[type="file"]').first();
    if ((await fileInput.count()) === 0) {
        throw new Error("No input[type='file'] found — please log in to DeepSeek first");
    }
    // setInputFiles + manual change event dispatch for React compatibility
    log("Uploading files...");
    await fileInput.setInputFiles([]); // clear previous
    await fileInput.setInputFiles(filePaths);
    await fileInput.evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
    // Wait for all file names to appear in DOM
    const fileNames = filePaths.map(fp => path.basename(fp));
    try {
        await page.waitForFunction((names) => names.every((n) => document.body.innerText.includes(n)), fileNames, { timeout: 60000, polling: 500 });
        log("All file names detected, upload confirmed");
    }
    catch {
        log("File name not detected, continuing...");
        if (DEBUG) {
            const debugScreenshot = path.join(PROJECT_ROOT, `upload_debug_${Date.now()}.png`);
            await page.screenshot({ path: debugScreenshot }).catch(() => { });
        }
    }
    // Brief settle: wait for loading indicator to clear, with short timeout
    try {
        const spinner = page.locator('[class*="uploading"], [class*="loading"]');
        if ((await spinner.count()) > 0) {
            await spinner.first().waitFor({ state: "hidden", timeout: 30000 });
            log("Upload spinner cleared");
        }
    }
    catch { /* spinner not found or timed out */ }
    // Additional: wait for network idle (upload XHRs)
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => { });
    await sleep(1000);
}
// --- Answer extraction ---
// Multi-selector fallback (DeepSeek may change class names)
const ANSWER_SELECTORS = [
    ".ds-assistant-message-main-content",
    ".ds-markdown.ds-assistant-message-main-content",
    '[data-testid="assistant-message"]',
    ".chat-message-assistant",
];
async function findAnswerSelector(page) {
    for (const sel of ANSWER_SELECTORS) {
        if ((await page.locator(sel).count()) > 0)
            return sel;
    }
    throw new Error("Cannot find answer element — DeepSeek UI may have changed");
}
// Fix 4 + 6: use exact role locator for stop button, idle-ms fallback
async function waitForAnswerComplete(page, answerSelector) {
    // Fix 3: match both English "Stop" and Chinese "停止"
    try {
        const stopBtn = page.locator('button:has-text("Stop"), button:has-text("停止"), [aria-label*="stop" i], [aria-label*="Stop"], [aria-label*="停止"]').first();
        await stopBtn.waitFor({ state: "visible", timeout: 10000 });
        log("Stop button visible, waiting for it to disappear...");
        await stopBtn.waitFor({ state: "hidden", timeout: 600000 });
        log("Stop button gone, generation complete");
        await sleep(500);
        return;
    }
    catch {
        log("Stop button not detected, falling back to idle tracking");
    }
    // Fallback: track only the latest message element, not all history
    let lastLen = 0;
    let idleMs = 0;
    const POLL_MS = 2000;
    while (idleMs < IDLE_LIMIT_MS) {
        await sleep(POLL_MS);
        const latestLen = await page.evaluate((sel) => {
            const els = document.querySelectorAll(sel);
            const last = els[els.length - 1];
            return last ? (last.textContent || "").length : 0;
        }, answerSelector);
        if (latestLen > lastLen) {
            log(`Latest message growing: ${lastLen} → ${latestLen}`);
            idleMs = 0;
            lastLen = latestLen;
        }
        else {
            idleMs += POLL_MS;
            log(`Idle ${idleMs}/${IDLE_LIMIT_MS}ms (${lastLen} chars)`);
        }
    }
    log(`Generation complete, latest message: ${lastLen} chars`);
}
// Extract messages starting from startIndex (to skip previous conversation)
async function extractNewAnswers(page, answerSelector, startIndex) {
    return page.evaluate(({ sel, start }) => {
        const els = document.querySelectorAll(sel);
        const parts = [];
        for (let i = start; i < els.length; i++) {
            const el = els[i];
            parts.push((el.innerText || el.textContent || "").trim());
        }
        return parts.join("\n\n");
    }, { sel: answerSelector, start: startIndex });
}
// --- Core ---
async function askFree(question, attachments, role) {
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
                    await page.evaluate("1+1", { timeout: 2000 });
                }
                catch {
                    log("Page unresponsive, resetting");
                    await closeBrowserResources();
                    isPageReady = false;
                }
            }
            const { page: pg } = await ensureBrowser();
            const inputSelector = 'textarea, [contenteditable="true"]';
            // Fix 2: detect session expiry even when isPageReady is true
            if (isPageReady) {
                const logoutHint = pg.locator('button:has-text("Log in"), button:has-text("Sign in")').first();
                if (await logoutHint.isVisible().catch(() => false)) {
                    log("Session expired, resetting");
                    isPageReady = false;
                }
            }
            if (!isPageReady) {
                await pg.goto("https://chat.deepseek.com/", { waitUntil: "networkidle" });
                const loginBtn = pg.locator('button:has-text("Log in"), button:has-text("Sign in"), a:has-text("Log in")').first();
                if ((await loginBtn.count()) > 0 && (await loginBtn.isVisible())) {
                    throw new Error("DeepSeek is not logged in. Please log in once in the opened browser window, then restart the MCP server.");
                }
                await pg.waitForSelector(inputSelector, { timeout: 30000 });
                isPageReady = true;
            }
            // --- Role dispatch (first call or role change) ---
            const effectiveRole = role || detectRole(question) || null;
            if (effectiveRole && effectiveRole !== activeRole) {
                log(`Role switch: ${activeRole} → ${effectiveRole}`);
                // Reset page to get a fresh conversation
                await pg.goto("https://chat.deepseek.com/", { waitUntil: "networkidle" });
                await pg.waitForSelector(inputSelector, { timeout: 30000 });
                await sendRoleTemplate(pg, effectiveRole);
            }
            // Count messages AFTER role template (so we don't extract it as answer)
            let prevMsgCount = 0;
            if (attachments && attachments.length > 0) {
                await uploadFilesToDeepseek(pg, attachments);
            }
            await pg.waitForSelector(inputSelector, { timeout: 10000 });
            const inputEl = pg.locator(inputSelector).first();
            // 只在代码修改意图时加 CONSTRAINTS（纯解释类不加）
            const q = (question && question.trim()) || "Please analyze this file";
            const needC = !EXPLAIN_ONLY_RE.test(q) && CODE_MODIFY_RE.test(q);
            const finalQuestion = q + (needC ? CONSTRAINTS : "");
            const isContentEditableDiv = await inputEl.evaluate((el) => {
                return el.tagName === "DIV" && el.getAttribute("contenteditable") === "true";
            });
            // Clear previous input to prevent cross-request pollution
            await inputEl.evaluate((el) => { el.innerText = ""; }).catch(() => { });
            try {
                await inputEl.fill("");
            }
            catch { /* not a fillable element */ }
            if (isContentEditableDiv) {
                await inputEl.evaluate((el, text) => { el.innerText = text; }, finalQuestion);
            }
            else {
                await inputEl.fill(finalQuestion);
            }
            prevMsgCount = await pg.locator(ANSWER_SELECTORS.join(", ")).count();
            // Prefer send button, fallback to Enter / Ctrl+Enter
            const sendBtn = pg.locator('button[type="submit"], button:has-text("Send"), button:has-text("发送")').first();
            const hasSendBtn = (await sendBtn.count()) > 0 && (await sendBtn.isVisible());
            if (hasSendBtn) {
                await sendBtn.click();
                log("Clicked send button");
            }
            else if (isContentEditableDiv) {
                await pg.keyboard.press("Control+Enter");
                log("Pressed Ctrl+Enter for contenteditable");
            }
            else {
                await pg.keyboard.press("Enter");
                log("Pressed Enter for textarea");
            }
            if (!HEADLESS)
                await pg.bringToFront();
            await pg.waitForSelector(ANSWER_SELECTORS.join(", "), {
                timeout: 300000,
                state: "visible",
            });
            const answerSelector = await findAnswerSelector(pg);
            await waitForAnswerComplete(pg, answerSelector);
            const answerText = (await extractNewAnswers(pg, ANSWER_SELECTORS.join(", "), prevMsgCount));
            if (!answerText)
                throw new Error("Failed to extract DeepSeek answer");
            return answerText;
        }
        catch (error) {
            lastError = error;
            const msg = error instanceof Error ? error.message : String(error);
            const recoverable = msg.includes("closed")
                || msg.includes("Navigation timeout") || msg.includes("Target page");
            if (recoverable && retries > 1) {
                log(`Recoverable error, resetting and retrying: ${msg}`);
                await closeBrowserResources();
                isPageReady = false;
                initPromise = null;
                retries--;
                continue;
            }
            isPageReady = false; // reset for fresh start on next call
            throw error;
        }
    }
    // all retries exhausted — reset so next call starts fresh
    isPageReady = false;
    throw lastError;
}
// --- MCP Server ---
const server = new Server({ name: "deepseek-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "ask_deepseek",
            description: "Use DeepSeek free web version (zero API token). Supports file attachments up to 100MB total, multiple files allowed.",
            inputSchema: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "Question to ask DeepSeek. Defaults to 'Please analyze this file' if omitted.",
                    },
                    attachments: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional absolute file paths to upload as attachments. DeepSeek web supports up to 100MB total.",
                    },
                    role: {
                        type: "string",
                        description: "角色文件名（不含 .md），如 python_tutor。留空则自动检测。",
                    },
                },
                required: [],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "ask_deepseek") {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
    // Runtime argument validation
    const raw = request.params.arguments;
    let question;
    let attachments;
    let role;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        if ("question" in raw) {
            question = typeof raw.question === "string"
                ? raw.question
                : String(raw.question);
        }
        // Fix 7: filter and validate attachment strings
        if ("attachments" in raw && Array.isArray(raw.attachments)) {
            attachments = raw.attachments
                .filter((v) => typeof v === "string" && v.trim().length > 0)
                .map((v) => v.trim());
        }
        if ("role" in raw && typeof raw.role === "string" && raw.role.trim()) {
            role = raw.role.trim();
        }
    }
    if (!question && (!attachments || attachments.length === 0)) {
        throw new Error("At least one of 'question' or 'attachments' is required");
    }
    return withLock(async () => {
        try {
            const answer = await askFree(question || "", attachments, role);
            let source = "";
            if (attachments && attachments.length > 0) {
                const names = attachments.map((fp) => path.basename(fp)).join(", ");
                source = ` (${attachments.length} attachment(s): ${names})`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `【DeepSeek free answer】${source}\n\n${answer}\n\n---\nGenerated by DeepSeek web version. Zero API token consumed.`,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: `DeepSeek call failed: ${message}\nPlease ensure you are logged in to DeepSeek (browser window opened) and the network is available.`,
                    },
                ],
                isError: true,
            };
        }
    });
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("DeepSeek MCP Server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
