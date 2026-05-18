import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const USER_DATA_DIR = path.join(PROJECT_ROOT, ".chatgpt-chrome-profile");
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
function log(...args) {
    if (DEBUG)
        console.error("[ask_chatgpt]", ...args);
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
async function ensureBrowser() {
    if (browserContext && page && !page.isClosed()) {
        return { page, context: browserContext };
    }
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        try {
            if (browserContext) {
                await browserContext.close().catch(() => { });
                browserContext = null;
                page = null;
            }
            browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: HEADLESS,
                // no channel = default chromium
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
// --- Core ---
async function askChatGPT(question, attachments) {
    const { page: pg } = await ensureBrowser();
    if (!isPageReady) {
        await pg.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
        await pg.waitForTimeout(3000);
        await pg.waitForSelector("#prompt-textarea", { timeout: 30000 });
        isPageReady = true;
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
    // Record existing message count before sending
    const prevMsgCount = await pg.locator(ANSWER_SELECTORS.join(", ")).count();
    // Click send button (the submit button, changes from voice when text is entered)
    await sleep(500); // let the send button switch from voice to send
    const sendBtn = pg.locator('button.composer-submit-button-color, button[aria-label="Send"], [data-testid="send-button"]').first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
        await sendBtn.click();
    }
    else {
        // Fallback: trigger input event then Enter (ProseMirror needs input before Enter)
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
// --- MCP Server ---
const server = new Server({ name: "chatgpt-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "ask_chatgpt",
            description: "Use ChatGPT free web version (zero API token). Supports file attachments, multiple files allowed.",
            inputSchema: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Question to ask ChatGPT." },
                    attachments: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional absolute file paths to upload as attachments.",
                    },
                },
                required: [],
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
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        if ("question" in raw) {
            question = typeof raw.question === "string" ? raw.question : String(raw.question);
        }
        if ("attachments" in raw && Array.isArray(raw.attachments)) {
            attachments = raw.attachments
                .filter((v) => typeof v === "string" && v.trim().length > 0)
                .map((v) => v.trim());
        }
    }
    if (!question && (!attachments || attachments.length === 0)) {
        throw new Error("At least one of 'question' or 'attachments' is required");
    }
    return withLock(async () => {
        try {
            const answer = await askChatGPT(question || "", attachments);
            let source = "";
            if (attachments && attachments.length > 0) {
                source = ` (${attachments.length} attachment(s))`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `【ChatGPT free answer】${source}\n\n${answer}\n\n---\nGenerated by ChatGPT web version. Zero API token consumed.`,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `ChatGPT call failed: ${message}` }],
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
