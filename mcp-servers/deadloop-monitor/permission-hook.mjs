#!/usr/bin/env node
// Permission hook：权限弹窗时写标记 → 扩展每15秒检测并蜂鸣
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLAG = path.join(__dirname, ".pending_permission");
const input = fs.readFileSync(0, "utf-8").trim();

let event;
try { event = JSON.parse(input); } catch { process.exit(0); }

const HOOK_LOG = path.join(__dirname, ".hook_debug.log");
try {
  fs.appendFileSync(HOOK_LOG, new Date().toISOString() + " PERM_EVENT name=" + (event.hook_event_name || "?") + " tool=" + (event.tool_name || "?") + " keys=" + Object.keys(event).join(",") + "\n");
} catch {}

const eventName = event.hook_event_name || "";

if (eventName === "PermissionRequest") {
  fs.writeFileSync(FLAG, "1", "utf-8");
  try { fs.appendFileSync(HOOK_LOG, new Date().toISOString() + " PERM: WROTE flag\n"); } catch {}
} else if (eventName === "PermissionDenied" || eventName === "PermissionGranted") {
  try { fs.unlinkSync(FLAG); } catch {}
}

process.exit(0);
