// 共享：回答检测与提取

/**
 * 等待回答完成：先看 stop 按钮是否可见，可见等消失，不可见直接完成
 * @param {import("playwright").Page} page
 * @param {string} answerSelector
 * @param {string} stopBtnSelector
 */
export async function waitForAnswer(page, answerSelector, stopBtnSelector) {
  await page.waitForSelector(answerSelector, { timeout: 300000, state: "visible" });
  const stopBtn = page.locator(stopBtnSelector).first();
  try {
    const visible = await stopBtn.isVisible().catch(() => false);
    if (visible) {
      await stopBtn.waitFor({ state: "hidden", timeout: 600000 });
    }
  } catch { /* done */ }
  await new Promise(r => setTimeout(r, 200));
}

/**
 * 提取新消息
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {number} startIndex
 * @returns {Promise<string>}
 */
export async function extractNewAnswers(page, selector, startIndex) {
  return page.evaluate(({ sel, start }) => {
    const els = document.querySelectorAll(sel);
    return Array.from(els).slice(start).map(el => (el.innerText || el.textContent || "").trim()).join("\n\n");
  }, { sel: selector, start: startIndex });
}

/**
 * 检测等待新消息出现
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {number} prevCount
 */
export async function waitForNewMessage(page, selector, prevCount) {
  for (let i = 0; i < 300; i++) {
    const cnt = await page.locator(selector).count();
    if (cnt > prevCount) return;
    await new Promise(r => setTimeout(r, 500));
  }
}
