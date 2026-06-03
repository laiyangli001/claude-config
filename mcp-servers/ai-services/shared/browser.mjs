// 共享：浏览器生命周期管理
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import https from "https";
import http from "http";

function log(...args) { console.error("[browser]", ...args); }
function escapeHtml(s) { return (s+"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

// ── 网络检测（走系统代理需各服务自行处理）──

/**
 * 检测目标网站是否可达（Node.js 直连，仅作参考，不阻断流程）
 */
export async function checkSite(url, timeout = 10000) {
  const proto = url.startsWith("https") ? https : http;
  return new Promise((resolve) => {
    const req = proto.get(url, { timeout }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

// ── 孤儿进程清理 ──

/** @param {string} profileDir */
function sanitizePath(p) { return p.replace(/[^a-zA-Z0-9:_\\\/.\-]/g, ''); }

/** @param {string} profileDir */
async function killOrphanChrome(profileDir) {
  try {
    const safeDir = sanitizePath(profileDir);
    // 写临时 .ps1 文件，避免 shell 引号转义问题
    const tmpFile = path.join(os.tmpdir(), "_kill_chrome_" + Date.now() + ".ps1");
    const psContent = 'Get-CimInstance Win32_Process -Filter "name=\'chrome.exe\'" | Where-Object { $_.CommandLine -like \'*' + safeDir.replace(/\\/g, '\\\\') + '*\' } | Select-Object -ExpandProperty ProcessId';
    fs.writeFileSync(tmpFile, psContent, "utf-8");
    const result = execSync(
      `powershell -NoProfile -File "${tmpFile}"`,
      { encoding: "utf8", timeout: 15000 }
    );
    try { fs.unlinkSync(tmpFile); } catch {}
    const pids = result.trim().split(/\s*\n\s*/).filter(id => /^\d+$/.test(id));
    for (const pid of pids) {
      try { execSync("taskkill /f /t /pid " + pid + " 2>nul", { timeout: 5000 }); log("杀孤儿进程树:", pid); } catch {}
    }
    if (pids.length > 0) await new Promise(r => setTimeout(r, 2000));
  } catch (e) { log("killOrphanChrome 错误:", e.message); }
}

// ── 指数退避重试 ──

/**
 * 判断错误是否为瞬时性（可重试）
 * @param {Error} err
 */
export function isTransientError(err) {
  const msg = (err && err.message) || "";
  return /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EPIPE|ENETUNREACH|net::ERR_CONNECTION|net::ERR_TIMEOUT|net::ERR_NAME_NOT_RESOLVED/i.test(msg);
}

/**
 * 判断是否为限流
 */
export function isRateLimitError(err) {
  const msg = (err && err.message) || "";
  return msg.includes("429") || msg.includes("503") || msg.includes("Too Many Requests") || msg.includes("系统繁忙");
}

/**
 * 指数退避延迟计算
 * @param {number} attempt 从 1 开始
 * @param {number} base 基础延迟 ms
 * @returns {number}
 */
function backoffDelay(attempt, base = 500) {
  return Math.min(base * Math.pow(2, attempt - 1), 8000) + Math.random() * 200;
}

/**
 * 带指数退避的异步重试
 * @param {Function} fn 异步函数
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelay=500]
 */
export async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts || 3;
  const baseDelay = opts.baseDelay || 500;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;

      if (isRateLimitError(err)) {
        await new Promise(r => setTimeout(r, 60000 + Math.random() * 10000));
        continue;
      }
      if (!isTransientError(err)) break;

      const delay = backoffDelay(attempt, baseDelay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── 浏览器启动 ──

/**
 * 删除 profile 目录下的所有 Chrome 锁文件
 * @param {string} profileDir
 */
function removeLockFiles(profileDir) {
  // 无条件删所有锁文件（不检查进程，避免误判导致锁残留）
  const lockFiles = [
    "lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket",
    "SingletonLock.tmp", "SingletonCookie.tmp",
    "First Run", "First Last",
  ];
  for (const f of lockFiles) {
    try { const p = path.join(profileDir, f); if (fs.existsSync(p)) { fs.unlinkSync(p); log("删锁:", f); } } catch (e) { log("删锁失败:", f, e.message); }
  }
  try {
    const singDir = path.join(profileDir, "Singleton");
    if (fs.existsSync(singDir)) { fs.rmSync(singDir, { recursive: true, force: true }); log("删 Singleton 目录"); }
  } catch {}
}

/**
 * 激进清理：杀所有 Chrome 进程 + 删锁文件（仅在 profile 已确认被锁时调用）
 */
async function aggressiveCleanup(profileDir) {
  try { execSync("taskkill /f /t /im chrome.exe 2>nul", { timeout: 10000 }); } catch {}
  await new Promise(r => setTimeout(r, 3000));
  removeLockFiles(profileDir);
  await new Promise(r => setTimeout(r, 1000));
}

/**
 * 尝试连接已运行的 Chrome（CDP 端口）
 */
export async function tryConnectCDP(chromium, port = 9222) {
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`, { timeout: 3000 });
    const ctxs = browser.contexts();
    const ctx = ctxs[0] || await browser.newContext();
    log(`已连接到运行中的 Chrome (端口 ${port})`);
    return { ctx, connected: true, browser };
  } catch (e) {
    log(`端口 ${port} 无 Chrome 运行`);
    return { ctx: null, connected: false, browser: null };
  }
}

/**
 * 启动浏览器（不包含网络检测，各服务自行导航时走系统代理）
 * @param {object} opts
 * @param {number} [opts.cdpPort] - 指定 CDP 端口，非零时尝试连接已有 Chrome
 */
export async function launchBrowser(chromium, profileDir, headless = false, cdpPort = 0) {
  // 如果指定了 CDP 端口，先尝试连接已有 Chrome
  if (cdpPort) {
    const { ctx, connected } = await tryConnectCDP(chromium, cdpPort);
    if (connected && ctx) return ctx;
  }

  log("正在清理旧进程...");
  removeLockFiles(profileDir);
  await killOrphanChrome(profileDir);

  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`正在启动浏览器(尝试 ${attempt})...`);
    try {
      const launchArgs = ['--disable-blink-features=AutomationControlled'];
      if (cdpPort) launchArgs.push(`--remote-debugging-port=${cdpPort}`);
      const ctx = await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        args: launchArgs,
      });
      log('浏览器已启动' + (cdpPort ? ` (CDP 端口 ${cdpPort})` : ''));
      return ctx;
    } catch (err) {
      const msg = (err && err.message) || "";
      log("浏览器启动失败:", msg);
      if (attempt >= 2) throw err;
      const profileLocked = msg.includes("已被占用") || msg.includes("in use") ||
        msg.includes("already in use") || msg.includes("锁");
      const browserClosed = msg.includes("Target page, context or browser has been closed");
      if (profileLocked || (browserClosed && attempt === 1)) {
        log("profile 被占用或浏览器异常关闭，执行清理后重试...");
        await aggressiveCleanup(profileDir);
        continue;
      }
      throw err;
    }
  }
}

// ── 浏览器内导航（带页面提示）──

/**
 * 在浏览器页面中显示 toast 并导航到目标网址，用户可看到检测过程
 * @param {import("playwright").Page} page
 * @param {string} url
 * @param {string} [label] 站点名称
 */
export async function navigateWithToast(page, url, label = "") {
  const siteName = label || new URL(url).hostname;
  try { await page.bringToFront(); } catch {}
  // 先加载一个简单的本地页面，确保 DOM 存在且不被 Chrome 错误页覆盖
  await page.setContent("<html><body></body></html>");
  await showPageToast(page, `正在连接 ${siteName}...`, "info");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await showPageToast(page, `已连接到 ${siteName}`, "ok");
  } catch (e) {
    const msg = e.message || "";
    let hint = "";
    if (msg.includes("ERR_CONNECTION_TIMED_OUT") || msg.includes("ERR_TIMED_OUT")) {
      hint = "请检查 VPN/代理是否开启，或稍后重试";
    } else if (msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("ERR_CONNECTION_REFUSED")) {
      hint = "网站不可达，请检查网络连接";
    } else if (msg.includes("ERR_CERT") || msg.includes("SSL")) {
      hint = "证书错误，可能是代理或网络问题";
    } else {
      hint = msg.length > 40 ? "请检查网络或 VPN 设置" : msg;
    }
    // 新开标签页显示错误提示，避免 Chrome 错误页 JS 限制
    try {
      const ctx = page.context();
      const errPage = await ctx.newPage();
      await errPage.setContent(`<html><head><meta charset="utf-8"></head><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center;padding:40px"><div style="font-size:48px;margin-bottom:16px">⚠️</div><div style="font-size:22px;font-weight:600">${escapeHtml(siteName)} 连接失败</div><div style="font-size:16px;color:#f87171;margin-top:16px">${escapeHtml(hint)}</div><div style="font-size:13px;color:#888;margin-top:32px">请关闭此标签页并重试</div></div></body></html>`);
      try { await errPage.bringToFront(); } catch {}
      // 不关闭调用方的 page，由调用方自己管理生命周期
    } catch (e) { log("navigateWithToast 错误页创建失败:", e.message); }
    throw new Error(`${siteName} 不可达: ${hint}`);
  }
}

async function showPageToast(page, msg, type) {
  try {
    // 确保 body 存在
    await page.evaluate(() => {
      if (!document.body) {
        const b = document.createElement("body");
        document.documentElement.appendChild(b);
      }
    });
    await page.evaluate(({ msg, type }) => {
      const id = "_mcp_toast";
      let d = document.getElementById(id);
      if (!d) {
        d = document.createElement("div");
        d.id = id;
        const isError = type === "error";
        d.style.cssText = `
          position:fixed; left:16px; top:16px; z-index:2147483647;
          background:` + (isError ? "rgba(220,38,38,0.95)" : "rgba(26,26,46,0.94)") + `; color:#fff;
          padding:18px 28px; border-radius:12px; font-size:18px;
          font-family:system-ui,sans-serif; font-weight:600;
          box-shadow:0 4px 24px rgba(0,0,0,0.6);
          border:2px solid ` + (isError ? "#ef4444" : "rgba(99,102,241,0.5)") + `;
          pointer-events:none;
        `;
        document.body.appendChild(d);
      }
      d.textContent = msg;
      void d.offsetHeight;
    }, { msg, type });
  } catch (e) {
    console.error("[browser] showPageToast failed:", e.message);
  }
}

/**
 * 关闭并保证销毁浏览器进程（通过 PID force kill）
 * @param {object} ctx Playwright BrowserContext
 */
export async function closeBrowser(ctx) {
  if (!ctx) return;
  let pid = null;
  try {
    const browser = ctx.browser();
    if (browser) {
      const proc = browser.process();
      if (proc) pid = proc.pid;
    }
  } catch {}
  try { await ctx.close({ timeout: 10000 }); } catch (e) { log("closeBrowser close error:", e.message); }
  // 等进程自然退出
  if (pid) {
    try {
      for (let i = 0; i < 10; i++) {
        try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 500)); } catch { pid = null; break; }
      }
    } catch {}
    if (pid) {
      try { execSync("taskkill /f /pid " + pid + " 2>nul", { timeout: 5000 }); } catch (e) { log("closeBrowser kill error:", e.message); }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
