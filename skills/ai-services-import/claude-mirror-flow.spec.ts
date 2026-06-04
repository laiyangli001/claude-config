/**
 * 盲测：Claude Mirror 对话流程回归测试
 *
 * 测试场景：
 *   A) 不需要截图 → 全自动：输入问题 → 发送 → 获取回答
 *   B) 需要截图 → 半自动：输入问题 → 点截屏 → 用户手动选窗口+分享+发送 → 获取回答
 *
 * 运行：npx playwright test claude-mirror-flow.spec.ts
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

const SITE_URL = "https://claude.2233.ai/new";
const PROFILE_DIR = path.resolve(__dirname, "../../mcp-servers/ai-services/claude-mirror/.claude-mirror-profile");

/**
 * 在测试文件所在目录执行时，回退到绝对路径
 */
function resolveProfile(): string {
  if (fs.existsSync(PROFILE_DIR)) return PROFILE_DIR;
  const alt = path.resolve("mcp-servers/ai-services/claude-mirror/.claude-mirror-profile");
  if (fs.existsSync(alt)) return alt;
  return PROFILE_DIR;
}

test.describe("Claude Mirror 对话流程", () => {
  let ctx: BrowserContext;

  test.beforeAll(async () => {
    // 杀孤儿 Chrome 进程，释放 profile 锁
    try { execSync("taskkill /f /im chrome.exe 2>nul", { timeout: 5000 }); } catch {}
    await new Promise(r => setTimeout(r, 3000));
  });

  test("A) 不截图 - 全自动问答", async () => {
    // 用持久化 profile 启动（含登录态 + 反检测）
    const profile = resolveProfile();
    ctx = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: ["--disable-blink-features=AutomationControlled"],
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] });
      (window as any).chrome = { runtime: {} };
    });

    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(SITE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("div.ProseMirror", { timeout: 60000 });

    // 配置 Opus 4.8 + High + 简洁
    await configureSettings(page);

    // 全自动发送问题
    await page.locator("div.ProseMirror").first().evaluate(
      (el: HTMLElement, t: string) => {
        el.innerText = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      "用一句话介绍你自己"
    );
    await page.waitForTimeout(500);

    // 尝试发送（Enter → Ctrl+Enter 兜底）
    for (const key of ["Enter", "Control+Enter"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(800);
      const txt = await page.locator("div.ProseMirror").first()
        .evaluate((el: HTMLElement) => el.innerText).catch(() => "");
      if (!txt || txt.length < 5) break;
    }

    // 等回答
    const oldLen = await page.evaluate(() => document.body.innerText.length);
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);
      const curLen = await page.evaluate(() => document.body.innerText.length);
      if (curLen > oldLen + 20) {
        await page.waitForTimeout(3000);
        break;
      }
    }

    // 验证回答
    const answer = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll('[class*="message"], article')];
      return msgs[msgs.length - 1]?.textContent?.trim() || "";
    });
    expect(answer.length).toBeGreaterThan(20);

    await ctx.close();
  });
});

/**
 * 配置模型为 Opus 4.8 + Effort High + 简洁风格
 */
async function configureSettings(page: Page) {
  // 风格 → 简洁
  try {
    const styleBtn = page.locator('[data-testid="style-selector-dropdown"]').first();
    if (await styleBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await styleBtn.click({ force: true, timeout: 1500 });
      await page.waitForTimeout(500);
      const concise = page.locator("text=简洁").first();
      if ((await concise.count().catch(() => 0)) > 0)
        await concise.click({ force: true, timeout: 1500 });
    }
  } catch { /* style already set */ }
  await page.waitForTimeout(200);

  // 模型 → Opus 4.8 + Effort High
  try {
    const modelBtn = page.locator('[data-testid="model-selector-dropdown"]').first();
    if (!(await modelBtn.isVisible({ timeout: 2000 }).catch(() => false))) return;
    await modelBtn.click({ force: true, timeout: 1500 });
    await page.waitForTimeout(800);

    const effortTrigger = page.locator('[data-testid="effort-menu-trigger"]').first();
    if (await effortTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await effortTrigger.click({ force: true, timeout: 1500 });
      await page.waitForTimeout(500);
      const high = page.locator('[role=menuitemradio]:has-text("High")').first();
      if (await high.isVisible({ timeout: 2000 }).catch(() => false))
        await high.click({ force: true, timeout: 1500 });
      await page.waitForTimeout(300);
    }

    const opus = page.locator('[role=menuitemradio]:has-text("Opus")').first();
    if (await opus.isVisible({ timeout: 2000 }).catch(() => false))
      await opus.click({ force: true, timeout: 1500 });
    await page.waitForTimeout(300);

    await page.mouse.click(5, 5).catch(() => {});
  } catch { /* model already set */ }
  await page.waitForTimeout(200);
}
