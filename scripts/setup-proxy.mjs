#!/usr/bin/env node
// 一键配置 HTTP 代理
// Windows 系统代理由 VPN 软件管理，脚本只确保各工具跟随系统设置
import fs from "fs";
import path from "path";
import os from "os";

const HOME = os.homedir();

// ── 1. 写入 Claude settings（当前会话生效） ──
const claudeSettings = path.join(HOME, ".claude", "settings.json");
try {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(claudeSettings, "utf-8")); } catch {}
  if (!cfg.env) cfg.env = {};
  // 不设固定值，写空让动态检测接管
  delete cfg.env.HTTP_PROXY;
  delete cfg.env.HTTPS_PROXY;
  fs.writeFileSync(claudeSettings, JSON.stringify(cfg, null, 2), "utf-8");
  console.log(`  ✅ Claude settings: ${claudeSettings}`);
} catch (e) {
  console.error(`  ❌ Failed to write ${claudeSettings}: ${e.message}`);
}

// ── 2. 确保 .bashrc 有 source proxy-detect.sh ──
const scriptDir = path.dirname(process.argv[1]).replace(/\\/g, "/");
const bashrc = path.join(HOME, ".bashrc");
const bashSourceLine = `source "${scriptDir}/proxy-detect.sh"`;
try {
  let content = "";
  try { content = fs.readFileSync(bashrc, "utf-8"); } catch {}
  if (content.includes("proxy-detect.sh")) {
    console.log(`  ⏭️ .bashrc: already configured`);
  } else {
    content += `\n# Proxy — 动态检测 Windows 系统代理\n${bashSourceLine}\n`;
    fs.writeFileSync(bashrc, content, "utf-8");
    console.log(`  ✅ .bashrc: ${bashrc}`);
  }
} catch (e) {
  console.error(`  ❌ Failed to write ${bashrc}: ${e.message}`);
}

// ── 3. 清理 VS Code 中的显式 http.proxy（走系统代理） ──
const vscodeSettings = path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Code", "User", "settings.json");
try {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(vscodeSettings, "utf-8")); } catch {}
  delete cfg["http.proxy"];
  delete cfg["http.proxyStrictSSL"];
  cfg["http.proxySupport"] = "on";
  delete cfg.claudeCode;
  const envKey = "claudeCode.environmentVariables";
  if (cfg[envKey]) {
    cfg[envKey] = cfg[envKey].filter(e => e.name !== "HTTP_PROXY" && e.name !== "HTTPS_PROXY");
  }
  fs.writeFileSync(vscodeSettings, JSON.stringify(cfg, null, 4), "utf-8");
  console.log(`  ✅ VS Code settings: ${vscodeSettings} (uses system proxy)`);
} catch (e) {
  console.error(`  ❌ Failed to write ${vscodeSettings}: ${e.message}`);
}

console.log("\n✅ Configured. Proxy follows Windows system settings automatically.");
console.log("   New terminals: via .bashrc dynamic detection");
console.log("   VS Code: via system proxy");
console.log("   VPN on → proxy active   VPN off → direct connect");
