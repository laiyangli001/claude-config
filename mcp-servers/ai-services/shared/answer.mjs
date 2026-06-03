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
 * 检测等待新消息出现（最长 60s，每 500ms 轮询）
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {number} prevCount
 */
export async function waitForNewMessage(page, selector, prevCount) {
  for (let i = 0; i < 120; i++) {
    const cnt = await page.locator(selector).count();
    if (cnt > prevCount) return;
    await new Promise(r => setTimeout(r, 500));
  }
}

/**
 * 安装页面错误监听（stderr 日志）
 * @param {import("playwright").Page} page
 */
export function setupPageErrorMonitor(page) {
  page.on("pageerror", (err) => console.error("[page error]", err.message));
  page.on("crash", () => console.error("[page crash] page crashed"));
}

/**
 * 在页面内浮动提示（非阻塞）：所有 MCP 服务共用
 * @param {import("playwright").Page} page
 * @param {string} msg
 * @param {number} [duration=0] 0 表示不自动消失
 */
export async function showToast(page, msg, duration = 0) {
  try {
    await page.evaluate(({ msg, duration }) => {
      const id = "_mcp_toast";
      let d = document.getElementById(id);
      if (!d) {
        d = document.createElement("div");
        d.id = id;
        d.style.cssText = `
          position:fixed; left:16px; top:16px; z-index:2147483647;
          background:rgba(26,26,46,0.92); color:#e2e8f0;
          padding:16px 24px; border-radius:12px; font-size:18px;
          font-family:'Segoe UI',sans-serif; line-height:1.6;
          box-shadow:0 8px 32px rgba(0,0,0,0.5);
          border:1px solid rgba(99,102,241,0.3);
          max-width:360px; cursor:grab; user-select:none;
          transition:opacity 0.3s;
          pointer-events:auto;
        `;
        // 鼠标拖拽
        let offX = 0, offY = 0;
        d.addEventListener("mousedown", (e) => {
          offX = e.clientX - d.getBoundingClientRect().left;
          offY = e.clientY - d.getBoundingClientRect().top;
          d.style.cursor = "grabbing";
          const onMove = (ev) => {
            d.style.left = Math.max(0, ev.clientX - offX) + "px";
            d.style.top = Math.max(0, ev.clientY - offY) + "px";
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", () => {
            document.removeEventListener("mousemove", onMove);
            d.style.cursor = "grab";
          }, { once: true });
        });
        document.body.appendChild(d);
      }
      d.textContent = msg;
      d.style.opacity = "1";
      if (duration > 0) {
        if (d._timer) clearTimeout(d._timer);
        d._timer = setTimeout(() => { d.style.opacity = "0"; }, duration);
      }
    }, { msg, duration });
  } catch (e) { console.error("[toast] error:", e.message); }
}
