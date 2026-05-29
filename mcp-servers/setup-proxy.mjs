#!/usr/bin/env node
// 一键配置 HTTP 代理：检测可用端口，写入 settings.json + .bashrc + VS Code
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const COMMON_PORTS = [7890, 7891, 7892, 10809, 1080, 1081, 8888, 8080];
const HOME = os.homedir();

// ── 解析参数 ──
let proxyHost = "127.0.0.1";
let proxyPort = 0;
let skipDetect = false;

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--proxy" && i + 1 < process.argv.length) {
    const u = new URL(process.argv[++i]);
    proxyHost = u.hostname;
    proxyPort = parseInt(u.port) || 0;
    skipDetect = true;
  } else if (a === "--port" && i + 1 < process.argv.length) {
    proxyPort = parseInt(process.argv[++i]);
    skipDetect = true;
  }
}

// ── 扫描代理端口 ──
function scanPorts() {
  console.log("🔍 Scanning common proxy ports...");
  for (const port of COMMON_PORTS) {
    try {
      execSync(`curl -s --connect-timeout 1 --proxy http://${proxyHost}:${port} -o /dev/null -w "%{http_code}" https://www.google.com`, {
        timeout: 3000, stdio: "pipe",
      });
      console.log(`  ✅ ${proxyHost}:${port} — available`);
      return port;
    } catch {
      // try next
    }
  }
  return 0;
}

if (!skipDetect || proxyPort === 0) {
  const found = scanPorts();
  if (found) { proxyPort = found; }
  else {
    proxyPort = 7892;
    console.log(`  ⚠️  No proxy detected, defaulting to ${proxyPort}`);
  }
}

const proxyUrl = `http://${proxyHost}:${proxyPort}`;
console.log(`\n📌 Using proxy: ${proxyUrl}`);

// ── 1. 写入 ~/.claude/settings.json ──
const claudeSettings = path.join(HOME, ".claude", "settings.json");
try {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(claudeSettings, "utf-8")); } catch {}
  if (!cfg.env) cfg.env = {};
  cfg.env.HTTP_PROXY = proxyUrl;
  cfg.env.HTTPS_PROXY = proxyUrl;
  fs.writeFileSync(claudeSettings, JSON.stringify(cfg, null, 2), "utf-8");
  console.log(`  ✅ Claude settings: ${claudeSettings}`);
} catch (e) {
  console.error(`  ❌ Failed to write ${claudeSettings}: ${e.message}`);
}

// ── 2. 写入 ~/.bashrc ──
const bashrc = path.join(HOME, ".bashrc");
try {
  let content = "";
  try { content = fs.readFileSync(bashrc, "utf-8"); } catch {}
  // 删除旧的 proxy 行和注释，重新添加
  const lines = content.split("\n").filter(l => {
    const t = l.trim();
    return !/^export (HTTP_PROXY|HTTPS_PROXY)=/.test(t) && t !== "# Proxy" && t !== "# Proxy (auto-configured)";
  });
  // 移除末尾空行
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("", "# Proxy", `export HTTP_PROXY="${proxyUrl}"`, `export HTTPS_PROXY="${proxyUrl}"`);
  fs.writeFileSync(bashrc, lines.join("\n"), "utf-8");
  console.log(`  ✅ .bashrc: ${bashrc}`);
} catch (e) {
  console.error(`  ❌ Failed to write ${bashrc}: ${e.message}`);
}

// ── 3. 写入 VS Code settings.json ──
// VS Code 使用 flat 键名（如 "http.proxy"、"claudeCode.environmentVariables"），不是嵌套对象
const vscodeSettings = path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Code", "User", "settings.json");
try {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(vscodeSettings, "utf-8")); } catch {}
  cfg["http.proxy"] = proxyUrl;
  cfg["http.proxySupport"] = "on";
  cfg["http.proxyStrictSSL"] = false;
  // 清除旧的嵌套格式（如果有），VS Code 使用 flat 键名
  delete cfg.claudeCode;
  // 确保 claudeCode.environmentVariables 里有代理（flat key）
  const envKey = "claudeCode.environmentVariables";
  if (!cfg[envKey]) cfg[envKey] = [];
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY"]) {
    const existing = cfg[envKey].findIndex(e => e.name === name);
    if (existing >= 0) cfg[envKey][existing].value = proxyUrl;
    else cfg[envKey].push({ name, value: proxyUrl });
  }
  fs.writeFileSync(vscodeSettings, JSON.stringify(cfg, null, 4), "utf-8");
  console.log(`  ✅ VS Code settings: ${vscodeSettings}`);
} catch (e) {
  console.error(`  ❌ Failed to write ${vscodeSettings}: ${e.message}`);
}

console.log(`\n✅ Proxy configured: ${proxyUrl}`);
console.log("   Reload VS Code or open new terminal to apply.");
