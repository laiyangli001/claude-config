#!/usr/bin/env node
// Permission hook：只对不在 allow 列表的工具写标记 → 扩展检测蜂鸣
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLAG = path.join(__dirname, ".pending_permission");
const input = fs.readFileSync(0, "utf-8").trim();

let event;
try { event = JSON.parse(input); } catch { process.exit(0); }

const eventName = event.hook_event_name || "";
const toolName = event.tool_name || "";

function isToolAllowed(tool) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf-8"));
    const allow = cfg.permissions?.allow || [];
    if (allow.includes(tool)) return true;
    // Bash、Edit、Read、Write 等内置工具默认允许
    if (["Bash","Edit","Read","Write","Glob","Grep","Skill","Agent","AskUserQuestion","NotebookEdit","TodoWrite"].includes(tool)) return true;
    return false;
  } catch { return false; }
}

const HOOK_LOG = path.join(__dirname, ".hook_debug.log");

if (eventName === "PermissionRequest") {
  if (!isToolAllowed(toolName)) {
    fs.writeFileSync(FLAG, "1", "utf-8");
  }
} else {
  // PermissionDenied 或其他事件 → 清标记
  try { fs.unlinkSync(FLAG); } catch {}
}

// 调试：记录非 Request 事件
if (eventName !== "PermissionRequest") {
  try { fs.appendFileSync(HOOK_LOG, new Date().toISOString() + " OTHER name=" + eventName + " tool=" + (toolName||"?") + " raw=" + input.slice(0,300) + "\n"); } catch {}
}

process.exit(0);
