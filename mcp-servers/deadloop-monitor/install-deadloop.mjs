#!/usr/bin/env node
// 安装死循环监控：装扩展 + 注册 Stop Hook
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 1. 安装 VS Code 扩展 ──
console.log("[1/2] Installing deadloop VS Code extension...");
try {
  execSync("node install-extension.mjs", { cwd: __dirname, stdio: "inherit" });
} catch {
  console.error("[ERROR] Extension installation failed.");
  process.exit(1);
}

// ── 2. 注册 Stop Hook 到 settings.json ──
console.log("[2/2] Registering Stop Hook in settings.json...");
const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
const hookPath = path.join(__dirname, "stop-hook.mjs").replace(/\\/g, "/");

const hookConfig = {
  Stop: [{
    hooks: [{
      type: "command",
      command: "node",
      args: [hookPath],
      timeout: 15,
    }],
  }],
};

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
} catch {
  // settings.json 不存在则初始化
}

// 合并 hooks
if (!settings.hooks) settings.hooks = {};
settings.hooks.Stop = hookConfig.Stop;

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
console.log("  → Stop Hook registered in", settingsPath);
console.log("  → Hook script:", hookPath);
console.log("");
console.log("Done! Reload VS Code (Ctrl+Shift+P → Reload Window).");
