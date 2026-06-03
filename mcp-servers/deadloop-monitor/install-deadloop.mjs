#!/usr/bin/env node
// 安装死循环监控：装扩展 + 注册 Stop Hook + PermissionRequest Hook
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 1. 安装 VS Code 扩展 ──
console.log("[1/3] Installing deadloop VS Code extension...");
try {
  execSync("node install-extension.mjs", { cwd: __dirname, stdio: "inherit" });
} catch {
  console.error("[ERROR] Extension installation failed.");
  process.exit(1);
}

// ── 2. 注册 Stop Hook 到 settings.json ──
console.log("[2/3] Registering Stop Hook in settings.json...");
const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
const hookPath = path.join(__dirname, "stop-hook.mjs").replace(/\\/g, "/");

let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch {}
if (!settings.hooks) settings.hooks = {};
settings.hooks.Stop = [{ hooks: [{ type: "command", command: "node", args: [hookPath], timeout: 15 }] }];
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
console.log("  → Stop Hook registered in", settingsPath);

// ── 3. 注册 PermissionRequest Hook 到 .claude.json ──
console.log("[3/3] Registering PermissionRequest Hook in .claude.json...");
const claudeJsonPath = path.join(os.homedir(), ".claude.json");
const permHookPath = path.join(__dirname, "permission-hook.mjs").replace(/\\/g, "/");

let claudeJson = {};
try { claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8")); } catch {}
if (!claudeJson.hooks) claudeJson.hooks = {};
claudeJson.hooks.PermissionRequest = [{ hooks: [{ type: "command", command: "node", args: [permHookPath], timeout: 10 }] }];
fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2), "utf-8");
console.log("  → PermissionRequest Hook registered in", claudeJsonPath);

console.log("");
console.log("Done! Reload VS Code (Ctrl+Shift+P → Reload Window).");
