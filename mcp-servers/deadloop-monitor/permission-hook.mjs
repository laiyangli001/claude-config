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

if (eventName === "PermissionRequest") {
  if (!isToolAllowed(toolName)) {
    fs.writeFileSync(FLAG, "1", "utf-8");
  }
} else if (eventName === "PermissionDenied") {
  try { fs.unlinkSync(FLAG); } catch {}
}

process.exit(0);
