// 共享：浏览器生命周期管理
import { execSync } from "child_process";
import * as fs from "fs";

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

/**
 * @param {object} chromium - playwright.chromium
 * @param {string} profileDir
 * @param {boolean} headless
 */
export async function launchBrowser(chromium, profileDir, headless = false) {
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
