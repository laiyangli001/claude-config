/**
 * Headroom 常驻服务
 *
 * 1. 读取 settings.json 当前 ANTHROPIC_BASE_URL
 * 2. 启动 Headroom proxy 转发到该地址
 * 3. 监听 settings.json 变化（CC Switch 切换时自动重启）
 * 4. 把 settings.json 的 URL 改为 localhost:8787
 *
 * 关闭：node scripts/headroom-service.mjs stop
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const PORT = 8787;
const PID_FILE = path.join(os.homedir(), ".claude", ".headroom-service.pid");

function readSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS, "utf-8"));
}
function writeSettings(c) {
  fs.writeFileSync(SETTINGS, JSON.stringify(c, null, 2), "utf-8");
}

// 停止
if (process.argv[2] === "stop") {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim());
    process.kill(pid, "SIGTERM");
    console.log("已停止 Headroom 服务");
  } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
  // 恢复原始地址
  const c = readSettings();
  const orig = c.env?._HEADROOM_ORIGINAL_URL;
  if (orig) {
    c.env.ANTHROPIC_BASE_URL = orig;
    delete c.env._HEADROOM_ORIGINAL_URL;
    writeSettings(c);
    console.log("已恢复 API 地址:", orig);
  }
  process.exit(0);
}

let proxyProcess = null;

function startProxy(targetUrl) {
  if (proxyProcess) {
    proxyProcess.kill("SIGTERM");
    proxyProcess = null;
  }
  console.log(`[headroom] 启动 proxy → ${targetUrl}`);
  const LOG_FILE = path.join(os.homedir(), ".claude", ".headroom-proxy.log");
  proxyProcess = spawn("headroom", [
    "proxy", "--port", String(PORT),
    "--anthropic-api-url", targetUrl,
    "--code-aware",
    "--log-file", LOG_FILE,
    "--log-messages",
  ], { stdio: "inherit", detached: false });
  proxyProcess.on("exit", (code) => {
    console.log(`[headroom] proxy 退出 (code=${code})`);
    proxyProcess = null;
  });
}

// 初次启动
const config = readSettings();
const target = config.env?.ANTHROPIC_BASE_URL;
if (!target || target.includes("localhost:8787")) {
  // 已是代理模式，不重复启动
  process.exit(0);
}

// 保存原始地址，指向本地代理
config.env._HEADROOM_ORIGINAL_URL = target;
config.env.ANTHROPIC_BASE_URL = `http://localhost:${PORT}/v1`;
writeSettings(config);

startProxy(target);

// 写 PID 文件
fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
console.log(`[headroom] 服务已启动 (PID: ${process.pid}), 监听 settings.json 变化...`);

// 监听 settings.json 变化
let lastMtime = fs.statSync(SETTINGS).mtimeMs;
setInterval(() => {
  try {
    const mtime = fs.statSync(SETTINGS).mtimeMs;
    if (mtime === lastMtime) return;
    lastMtime = mtime;

    const c = readSettings();
    const newTarget = c.env?.ANTHROPIC_BASE_URL;
    if (newTarget && !newTarget.includes("localhost:8787") && newTarget !== target) {
      console.log(`[headroom] 检测到 URL 变更: ${target} → ${newTarget}`);
      // 更新保存的原始地址
      c.env._HEADROOM_ORIGINAL_URL = newTarget;
      c.env.ANTHROPIC_BASE_URL = `http://localhost:${PORT}/v1`;
      writeSettings(c);
      startProxy(newTarget);
    }
  } catch {}
}, 2000);
