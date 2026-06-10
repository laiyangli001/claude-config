/**
 * Headroom 代理启动器
 *
 * 读取 settings.json 当前 ANTHROPIC_BASE_URL → 启动 Headroom proxy
 * 指向该地址 → 把 settings.json 的 URL 改为 localhost:8787。
 *
 * 用法：
 *   node scripts/headroom-proxy.mjs         启动
 *   node scripts/headroom-proxy.mjs off     关闭并恢复
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const PORT = 8787;

function read() {
  return JSON.parse(fs.readFileSync(SETTINGS, "utf-8"));
}
function write(c) {
  fs.writeFileSync(SETTINGS, JSON.stringify(c, null, 2), "utf-8");
}

const cmd = process.argv[2];

if (cmd === "off") {
  const c = read();
  const orig = c.env?._HEADROOM_ORIGINAL_URL;
  if (orig) {
    c.env.ANTHROPIC_BASE_URL = orig;
    delete c.env._HEADROOM_ORIGINAL_URL;
    write(c);
    console.log(`已恢复: ${orig}`);
  }
  process.exit(0);
}

// 读取当前 API 地址
const config = read();
const target = config.env?.ANTHROPIC_BASE_URL;
if (!target) {
  console.error("settings.json 中未找到 ANTHROPIC_BASE_URL");
  process.exit(1);
}

// 保存原始地址，将 settings 指向本地代理
config.env._HEADROOM_ORIGINAL_URL = target;
config.env.ANTHROPIC_BASE_URL = `http://localhost:${PORT}/v1`;
write(config);

console.log(`目标 API: ${target}`);
console.log(`代理端口: ${PORT}`);

// 启动 Headroom proxy
const proc = spawn("headroom", [
  "proxy",
  "--port", String(PORT),
  "--anthropic-api-url", target,
  "--code-aware",
], {
  stdio: "inherit",
  detached: true,
});

proc.unref();
console.log(`Headroom proxy 已启动 (PID: ${proc.pid})`);
console.log(`关闭: node scripts/headroom-proxy.mjs off`);
