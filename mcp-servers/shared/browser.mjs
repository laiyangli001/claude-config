// 共享：浏览器生命周期管理
import { execSync } from "child_process";
import * as fs from "fs";
import https from "https";
import http from "http";

// ── 网络健康检测 ──

/**
 * 检测目标网站是否可达
 * @param {string} url
 * @param {number} timeout 毫秒
 * @returns {Promise<void>}
 */
export async function checkSiteReachable(url, timeout = 10000) {
  const proto = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = proto.get(url, { timeout }, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode < 500) resolve();
      else reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on("error", (e) => reject(new Error(`网络不可达: ${e.message}`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("连接超时")); });
  });
}

// ── 孤儿进程清理 ──

/** @param {string} profileDir */
async function killOrphanChrome(profileDir) {
  try {
    const result = execSync(
      `wmic process where "name='chrome.exe' and commandline like '%${profileDir.replace(/\\/g, '\\\\')}%'" get processid /format:csv 2>nul`,
      { encoding: "utf8", timeout: 10000 }
    );
    const pids = result.trim().split(/\s*\n\s*/).slice(1)
      .filter(id => id && id !== "ProcessId")
      .map(l => (l.split(",").pop() || "").trim())
      .filter(id => /^\d+$/.test(id));
    for (const pid of pids) {
      try { execSync("taskkill /f /pid " + pid + " 2>nul", { timeout: 3000 }); } catch {}
    }
    if (pids.length > 0) await new Promise(r => setTimeout(r, 1500));
  } catch {}
}

// ── 指数退避重试 ──

/**
 * 判断错误是否为瞬时性（可重试）
 * @param {Error} err
 */
export function isTransientError(err) {
  const msg = (err && err.message) || "";
  return /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EPIPE|ENETUNREACH|closed|timeout|net::ERR_/i.test(msg);
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
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (!isTransientError(err)) break; // 永久错误不重试

      const delay = backoffDelay(attempt, baseDelay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── 浏览器启动 ──

/**
 * @param {object} chromium - playwright.chromium
 * @param {string} profileDir
 * @param {boolean} headless
 * @param {string} [siteUrl] - 可选，启动前检测站点可达性
 */
export async function launchBrowser(chromium, profileDir, headless = false, siteUrl) {
  // 先检测网络
  if (siteUrl) {
    await checkSiteReachable(siteUrl);
  }

  for (const f of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { fs.unlinkSync(profileDir + "/" + f); } catch {}
  }
  await killOrphanChrome(profileDir);
  return await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/** @param {object} ctx */
export async function closeBrowser(ctx) {
  if (ctx) {
    try { await ctx.close(); } catch {}
  }
}
