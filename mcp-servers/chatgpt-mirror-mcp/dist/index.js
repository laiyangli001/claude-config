import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const USER_DATA_DIR = path.join(PROJECT_ROOT, ".chatgpt-mirror-profile");
const HEADLESS = process.env.CHATGPT_HEADLESS === "true";
const DEBUG = process.env.CHATGPT_DEBUG === "true";
const _idleMs = parseInt(process.env.CHATGPT_IDLE_LIMIT_MS || "12000", 10);
const IDLE_LIMIT_MS = Number.isNaN(_idleMs) ? 12000 : _idleMs;
const CONSTRAINTS = `
【强制约束】
1. 最小修改原则：只改 bug 相关行，禁止顺手重构、禁止提取新函数、禁止加新注释。
2. 禁止编造：没看到的文件/API 不要假设存在，不确定就先问。
3. 安全红线：禁止拼接 SQL，禁止 XSS，禁止硬编码密钥。
4. 输出格式：先给修复后的代码块，再简述改了什么。不要问候语。`;
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
    return null;
}
function log(...args) {
    if (DEBUG)
        console.error("[ask_chatgpt_mirror]", ...args);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Serialize concurrent requests
let activeRequestPromise = Promise.resolve();
function withLock(fn) {
    const result = activeRequestPromise.then(() => fn(), () => fn());
    activeRequestPromise = result.catch(() => { });
    return result;
}
// --- Browser ---
let browserContext = null;
let page = null;
let isPageReady = false;
let initPromise = null;
let activeRole = null;
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
async function ensureBrowser() {
    if (browserContext && page && !page.isClosed()) {
        return { page, context: browserContext };
    }
    // Fix: page was closed but initPromise still cached — reset so we can recreate
    if (initPromise) {
        initPromise = null;
    }
    initPromise = (async () => {
        try {
            await closeBrowserResources();
            browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: HEADLESS,
                viewport: { width: 1280, height: 800 },
                args: ["--disable-blink-features=AutomationControlled"],
            });
            page = await browserContext.newPage();
            isPageReady = false;
            return { page, context: browserContext };
        }
        catch {
            initPromise = null;
            throw new Error("Failed to launch browser.");
        }
    })();
    return initPromise;
}
function cleanup() {
    if (browserContext) {
        Promise.race([
            browserContext.close(),
            new Promise((r) => setTimeout(r, 2000)),
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
    await pg.locator("#prompt-textarea").first().evaluate((el) => {
        el.innerText = "";
    });
    await pg.locator("#prompt-textarea").first().evaluate((el, text) => {
        el.innerText = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }, template);
    await sleep(500);
    const sendBtn = pg.locator('button.composer-submit-button-color, button[aria-label="Send"], [data-testid="send-button"]').first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
        await sendBtn.click();
    }
    else {
        await pg.locator("#prompt-textarea").first().evaluate((el) => {
            el.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await pg.keyboard.press("Enter");
        await sleep(200);
    }
    await pg.waitForSelector(ANSWER_SELECTORS.join(", "), { timeout: 300000, state: "visible" });
    const answerSelector = await findAnswerSelector(pg);
    await waitForAnswerComplete(pg, answerSelector);
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
        if (!fs.existsSync(fp))
            throw new Error(`File not found: ${fp}`);
    }
    // ChatGPT: use hidden #upload-files input for file upload
    const fileInput = page.locator("#upload-files");
    if ((await fileInput.count()) === 0) {
        const plusBtn = page.locator('[data-testid="composer-plus-btn"]');
        if ((await plusBtn.count()) > 0 && (await plusBtn.isVisible())) {
            await plusBtn.click();
            await page.waitForSelector("#upload-files", { timeout: 5000 });
        }
    }
    const uploadInput = page.locator("#upload-files").first();
    await uploadInput.setInputFiles([]); // clear previous
    await uploadInput.setInputFiles(filePaths);
    await uploadInput.evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
    // Handle "You already uploaded this file" dialog
    const duplicateBtn = page.locator('button:has-text("确定"), button:has-text("OK"), [data-testid="confirm-button"]');
    if ((await duplicateBtn.count()) > 0 && (await duplicateBtn.isVisible().catch(() => false))) {
        await duplicateBtn.first().click();
        log("Dismissed duplicate file dialog");
        await sleep(500);
    }
    // Brief settle for upload processing
    try {
        await page.waitForSelector('[class*="attachment"], [class*="file-preview"]', { timeout: 5000 });
    }
    catch {
        await sleep(500);
    }
}
// --- Answer ---
const ANSWER_SELECTORS = [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] .prose',
    '[data-message-author-role="assistant"] .chatgpt-message',
    '[role="document"] div[data-id]',
];
async function findAnswerSelector(page) {
    for (const sel of ANSWER_SELECTORS) {
        if ((await page.locator(sel).count()) > 0)
            return sel;
    }
    throw new Error("Cannot find answer element — ChatGPT UI may have changed");
}
async function waitForAnswerComplete(page, answerSelector) {
    // Try stop button
    try {
        const stopBtn = page.locator('button[aria-label*="stop" i], button[aria-label*="Stop"], button[aria-label*="停止"], [data-testid="stop-button"]').first();
        await stopBtn.waitFor({ state: "visible", timeout: 10000 });
        await stopBtn.waitFor({ state: "hidden", timeout: 600000 });
        await sleep(500);
        return;
    }
    catch { /* fallback */ }
    // Fallback: idle detection on latest message
    let lastLen = 0;
    let idleMs = 0;
    while (idleMs < IDLE_LIMIT_MS) {
        await sleep(2000);
        const latestLen = await page.evaluate((sel) => {
            const els = document.querySelectorAll(sel);
            const last = els[els.length - 1];
            return last ? (last.textContent || "").length : 0;
        }, answerSelector);
        if (latestLen > lastLen) {
            idleMs = 0;
            lastLen = latestLen;
        }
        else {
            idleMs += 2000;
        }
    }
}
async function extractNewAnswers(page, answerSelector, startIndex) {
    return page.evaluate(({ sel, start }) => {
        const els = document.querySelectorAll(sel);
        const parts = [];
        for (let i = start; i < els.length; i++) {
            const el = els[i];
            const text = (el.innerText || el.textContent || "").trim();
            if (text)
                parts.push(text);
        }
        return parts.join("\n\n");
    }, { sel: answerSelector, start: startIndex });
}
// --- Core (mirror version with special navigation) ---
async function askChatGPTMirror(question, attachments, role) {
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
            if (!isPageReady) {
                // === Mirror site navigation flow ===
                log("Navigating to mirror site...");
                await pg.goto("https://chatgpt.2233.ai/", { waitUntil: "domcontentloaded" });
                await pg.waitForTimeout(5000);
                // If on /list page, select first car and click 访问
                const pageUrl = pg.url();
                log("Current URL:", pageUrl);
                if (pageUrl.includes("/list")) {
                    log("Car list page detected, selecting first car...");
                    await pg.locator('table.tiny-grid__body tbody tr:first-child td:last-child button')
                        .first().waitFor({ state: "attached", timeout: 15000 });
                    await pg.locator('table.tiny-grid__body tbody tr:first-child td:last-child button')
                        .first().click({ force: true });
                    log("Clicked first car's visit button");
                    await sleep(3000);
                }
                // Wait for prompt-textarea to appear (auto if session exists, or after manual login)
                if (!HEADLESS)
                    await pg.bringToFront();
                console.error("=== 如果需要登录，请完成登录。等待页面加载对话框 ===");
                await pg.waitForSelector("#prompt-textarea", { timeout: 300000 });
                isPageReady = true;
                log("Mirror site navigation complete");
            }
            else {
                // Start new chat to avoid stale attachments from previous call
                try {
                    const newChatBtn = pg.locator('button:has-text("New chat"), [data-testid="new-chat-button"], a:has-text("New chat")').first();
                    if ((await newChatBtn.count()) > 0 && (await newChatBtn.isVisible())) {
                        await newChatBtn.click();
                        await pg.waitForTimeout(1000);
                        await pg.waitForSelector("#prompt-textarea", { timeout: 10000 });
                    }
                }
                catch { /* new chat button may not exist */ }
            }
            // --- Role dispatch (first call or role change) ---
            const effectiveRole = role || detectRole(question) || null;
            if (effectiveRole && effectiveRole !== activeRole) {
                log(`Role switch: ${activeRole} → ${effectiveRole}`);
                // Fresh conversation for new role
                try {
                    const newChatBtn = pg.locator('button:has-text("New chat"), [data-testid="new-chat-button"], a:has-text("New chat")').first();
                    if ((await newChatBtn.count()) > 0 && (await newChatBtn.isVisible())) {
                        await newChatBtn.click();
                        await pg.waitForTimeout(1000);
                        await pg.waitForSelector("#prompt-textarea", { timeout: 10000 });
                    }
                }
                catch { /* ignore */ }
                await sendRoleTemplate(pg, effectiveRole);
            }
            // Count messages AFTER role template (so we don't extract it as answer)
            let prevMsgCount = 0;
            if (attachments && attachments.length > 0) {
                await uploadFilesToChatGPT(pg, attachments);
            }
            // Type into ProseMirror editor (clear first to prevent cross-request pollution)
            const finalQuestion = ((question && question.trim()) || "Please analyze this file") + CONSTRAINTS;
            await pg.locator("#prompt-textarea").first().evaluate((el) => {
                el.innerText = "";
            });
            await pg.locator("#prompt-textarea").first().evaluate((el, text) => {
                el.innerText = text;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }, finalQuestion);
            prevMsgCount = await pg.locator(ANSWER_SELECTORS.join(", ")).count();
            // Click send button
            await sleep(500);
            const sendBtn = pg.locator('button.composer-submit-button-color, button[aria-label="Send"], [data-testid="send-button"]').first();
            if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
                await sendBtn.click();
            }
            else {
                await pg.locator("#prompt-textarea").first().evaluate((el) => {
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                });
                await pg.keyboard.press("Enter");
                await sleep(200);
            }
            if (!HEADLESS)
                await pg.bringToFront();
            await pg.waitForSelector(ANSWER_SELECTORS.join(", "), {
                timeout: 300000,
                state: "visible",
            });
            const answerSelector = await findAnswerSelector(pg);
            await waitForAnswerComplete(pg, answerSelector);
            const answerText = await extractNewAnswers(pg, ANSWER_SELECTORS.join(", "), prevMsgCount);
            if (!answerText)
                throw new Error("Failed to extract ChatGPT answer");
            return answerText;
        }
        catch (error) {
            lastError = error;
            const msg = error instanceof Error ? error.message : String(error);
            const recoverable = msg.includes("closed")
                || msg.includes("Navigation timeout") || msg.includes("Target page")
                || msg.includes("waitForURL") || msg.includes("car");
            if (recoverable && retries > 1) {
                log(`Recoverable error, resetting and retrying: ${msg}`);
                await closeBrowserResources();
                isPageReady = false;
                initPromise = null;
                retries--;
                continue;
            }
            isPageReady = false;
            throw error;
        }
    }
    // all retries exhausted — reset so next call starts fresh
    isPageReady = false;
    throw lastError;
}
// --- MCP Server ---
const server = new Server({ name: "chatgpt-mirror-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "ask_chatgpt_mirror",
            description: "Use ChatGPT mirror site (chatgpt.2233.ai) free web version (zero API token). Supports file attachments, multiple files allowed.",
            inputSchema: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Question to ask ChatGPT." },
                    attachments: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional absolute file paths to upload as attachments.",
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
    if (request.params.name !== "ask_chatgpt_mirror") {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const raw = request.params.arguments;
    let question;
    let attachments;
    let role;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        if ("question" in raw) {
            question = typeof raw.question === "string" ? raw.question : String(raw.question);
        }
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
            const answer = await askChatGPTMirror(question || "", attachments, role);
            let source = "";
            if (attachments && attachments.length > 0) {
                source = ` (${attachments.length} attachment(s))`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `【ChatGPT Mirror answer】${source}\n\n${answer}\n\n---\nGenerated by ChatGPT mirror site (chatgpt.2233.ai). Zero API token consumed.`,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `ChatGPT mirror call failed: ${message}` }],
                isError: true,
            };
        }
    });
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("ChatGPT Mirror MCP Server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
