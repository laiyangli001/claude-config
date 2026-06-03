import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import { launchBrowser, navigateWithToast, withRetry, closeBrowser } from "../../shared/browser.mjs";
// @ts-ignore
import { setupPageErrorMonitor, showToast } from "../../shared/answer.mjs";
// @ts-ignore
import { loadTemplate } from "../../shared/role.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".doubao-profile");
const HEADLESS = process.env.DOUBDAO_HEADLESS === "true";
const CDP_PORT = 9222;
const TEMPLATES_DIR = path.resolve(__dirname, "../../shared/templates");
const SEL = {
    CHAT_INPUT: 'textarea[placeholder*="发消息"]',
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
        browserContext = await launchBrowser(chromium, PROFILE_DIR, HEADLESS, CDP_PORT);
        const existing = browserContext.pages();
        // 扫描已有聊天页复用（CDP 不关用户其他页）
        let found = false;
        for (const p of existing) {
            try {
                if (!p.isClosed() && (await p.locator(SEL.CHAT_INPUT).count()) > 0) {
                    page = p;
                    isPageReady = true;
                    found = true;
                    break;
                }
            }
            catch { }
        }
        if (!found) {
            page = await browserContext.newPage();
            setupPageErrorMonitor(page);
            isPageReady = false;
        }
        return { page: page, context: browserContext };
    })();
    return initPromise;
}
async function askDoubao(question, attachments) {
    const { page: pg } = await ensureBrowser();
    if (!isPageReady) {
        await showToast(pg, "⏳ 打开豆包...");
        await withRetry(() => navigateWithToast(pg, SEL.URL, "豆包"));
        await sleep(2000);
        // 检测是否有登录 session（通过 cookie 判断）
        const cookies = await browserContext.cookies();
        const hasSession = cookies.some(c => c.name === "flow_cur_user_sec_id" && c.value.length > 10);
        if (!hasSession && await pg.locator(SEL.LOGIN_BTN).first().isVisible().catch(() => false)) {
            if (!HEADLESS)
                await pg.bringToFront();
            await showToast(pg, "🔑 请登录豆包（登录后自动继续）");
            try {
                await pg.locator(SEL.LOGIN_BTN).first().waitFor({ state: "hidden", timeout: 180000 });
            }
            catch {
                throw new Error("登录超时，请重新调用并在浏览器中完成登录");
            }
        }
        // 登录验证：确认聊天输入框已出现
        if (!(await pg.locator(SEL.CHAT_INPUT).waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false))) {
            throw new Error("未检测到聊天输入框，请确保已登录");
        }
        isPageReady = true;
    }
    // 根据关键词进入对应功能模式（如表格→数据分析、PPT→PPT 生成等）
    const funcMap = {
        "表格": "AI 表格", "excel": "AI 表格", "csv": "AI 表格",
        "ppt": "PPT 生成", "演示": "PPT 生成",
        "翻译": "翻译", "编程": "编程", "代码": "编程",
    };
    const ql = question.toLowerCase();
    for (const [kw, btn] of Object.entries(funcMap)) {
        if (ql.includes(kw)) {
            const moreBtn = pg.locator('button:has-text("更多")');
            if (await moreBtn.isVisible().catch(() => false)) {
                await moreBtn.click();
                await sleep(500);
                const btns = await pg.locator('button').all();
                for (const b of btns) {
                    if ((await b.textContent() || "").trim() === btn && await b.isVisible().catch(() => false)) {
                        await b.click();
                        await sleep(1500);
                        break;
                    }
                }
            }
            break;
        }
    }
    await showToast(pg, "📤 发送中...");
    // 找输入框：支持 textarea、contenteditable、或其他可输入控件
    const inputLocators = [
        SEL.CHAT_INPUT,
        'textarea',
        '[contenteditable="true"]',
        'input:not([type="hidden"]):not([type="file"])',
    ];
    let input = pg.locator(inputLocators.join(", ")).first();
    await input.click().catch(() => { });
    try {
        await input.fill(question);
    }
    catch {
        // fill 失败时用原生 setter 设值
        await input.evaluate((el, text) => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
            if (setter)
                setter.call(el, text);
            else
                el.value = text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }, question);
    }
    // 附件：打完字后设文件，避免 React 重渲染重置文件输入
    if (attachments?.length) {
        await showToast(pg, "📎 上传附件...");
        await pg.locator('input[type="file"]').first().setInputFiles(attachments);
        await sleep(1500);
    }
    await sleep(300);
    await pg.keyboard.press("Enter");
    // 发送后检测真人验证弹窗
    const verifyTexts = ["拖拽", "到这里", "符合上文描述"];
    const checkVerify = async () => {
        const t = await pg.evaluate(() => document.body.innerText);
        return verifyTexts.some(v => t.includes(v));
    };
    if (await checkVerify()) {
        if (!HEADLESS)
            await pg.bringToFront();
        await showToast(pg, "🧑 请完成页面上的真人验证（拖拽操作）");
        // 等弹窗消失（用户处理完或关闭）
        for (let i = 0; i < 180; i++) {
            await sleep(1000);
            if (!(await checkVerify()))
                break;
        }
        // 弹窗消失后判断是否真的通过验证：
        // 1. 停止按钮出现（说明正在生成回答）
        // 2. 或新消息出现
        let verified = false;
        for (let i = 0; i < 30; i++) {
            await sleep(1000);
            const stopVisible = await pg.locator(SEL.STOP_BTN).first().isVisible().catch(() => false);
            if (stopVisible) {
                verified = true;
                break;
            }
            const newMsg = await pg.evaluate(() => document.querySelectorAll('[class*="message"], article, [role="article"]').length);
            if (newMsg > 0) {
                verified = true;
                break;
            }
        }
        if (!verified)
            throw new Error("真人验证未完成，请重新尝试");
    }
    // 等回答生成：文本增长 → stop 按钮消失 → 提取
    await showToast(pg, "⏳ 等待回答...");
    const textBefore = await pg.evaluate(() => document.body.innerText.length);
    for (let i = 0; i < 120; i++) {
        await sleep(500);
        if ((await pg.evaluate(() => document.body.innerText.length)) > textBefore)
            break;
    }
    // 等 stop 按钮消失（不管出没出现过）
    await pg.locator(SEL.STOP_BTN).first().waitFor({ state: "hidden", timeout: 60000 }).catch(() => { });
    // 等内容不再增长（连续 3 秒稳定 = 回答完成）
    await showToast(pg, "⏳ 等待输出完毕...");
    let stableCount = 0, lastLen = await pg.evaluate(() => document.body.innerText.length);
    for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const curLen = await pg.evaluate(() => document.body.innerText.length);
        if (curLen === lastLen) {
            stableCount++;
            if (stableCount >= 3)
                break;
        }
        else {
            stableCount = 0;
            lastLen = curLen;
        }
    }
    await showToast(pg, "✅ 回答完成", 2000);
    let answer = await pg.evaluate(() => {
        const msgs = document.querySelectorAll('[class*="message"], article, [role="article"]');
        const texts = [];
        for (const el of msgs) {
            const t = (el.textContent || "").trim();
            if (t.length > 5)
                texts.push(t);
        }
        return texts.length > 0 ? texts[texts.length - 1] : "";
    });
    if (!answer || answer.length < 5)
        throw new Error("Failed to extract answer");
    return answer;
}
/** 检测并下载豆包生成的 PPT 等文件（需先调 ask_doubao，同会话内使用） */
async function checkDoubaoDownloads() {
    if (!page || page.isClosed())
        throw new Error("浏览器未打开，请先调用 ask_doubao 生成 PPT");
    const pg = page;
    // 确保在豆包页面
    if (!pg.url().includes("doubao.com")) {
        await navigateWithToast(pg, SEL.URL, "豆包").catch(() => { });
        await sleep(2000);
    }
    // 关闭可能的弹窗（恢复页面等）
    pg.on("dialog", (d) => d.dismiss().catch(() => { }));
    await pg.keyboard.press("Escape").catch(() => { });
    await sleep(1000);
    // 找下载按钮（在 PPT 生成结果区域）
    const dlBtn = pg.locator('button:has-text("下载"), a:has-text("下载")').first();
    if (!(await dlBtn.isVisible().catch(() => false)))
        throw new Error("未检测到可下载的文件");
    // 点击下载 → 弹出格式选择菜单（PPTX/PDF）
    await dlBtn.click();
    await sleep(1000);
    // 选 PPTX 格式开始下载
    let result = "";
    const p1 = pg.waitForEvent("download", { timeout: 20000 }).then(async (d) => {
        const dir = (process.env.USERPROFILE || "C:/Users/default") + "\\Downloads";
        result = dir + "\\" + d.suggestedFilename();
        await d.saveAs(result).catch(() => { });
    }).catch(() => { });
    const p2 = pg.waitForEvent("popup", { timeout: 20000 }).then(async (popup) => {
        await popup.waitForLoadState();
        result = await popup.url();
    }).catch(() => { });
    // 点 PPTX 选项（按钮或菜单项）
    await pg.locator('button:has-text("PPTX"), [class*="pptx"], [role="menuitem"]:has-text("PPTX")').first().click().catch(() => { });
    await Promise.race([p1, p2, new Promise(r => setTimeout(r, 20000))]);
    if (!result)
        throw new Error("下载失败");
    return `文件已下载: ${result}`;
}
const server = new Server({ name: "mcp-doubao", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        { name: "ask_doubao", description: "Use Doubao (doubao.com) free version. Supports image/file attachments.", inputSchema: { type: "object", properties: { template: { type: "string" }, question: { type: "string" }, attachments: { type: "array", items: { type: "string" } } } } },
        { name: "download_doubao_file", description: "Download files (PPT etc.) generated by Doubao.", inputSchema: { type: "object", properties: {} } },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "download_doubao_file") {
        return checkDoubaoDownloads().then(r => ({ content: [{ type: "text", text: r }] })).catch(e => ({ content: [{ type: "text", text: e.message }], isError: true }));
    }
    if (req.params.name !== "ask_doubao")
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
        const answer = await askDoubao(finalQuestion, files);
        return { content: [{ type: "text", text: `【Doubao answer】\n\n${answer}` }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Doubao call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
});
async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("Doubao MCP running"); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
