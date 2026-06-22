const fs = require("fs");
const path = require("path");
const input = JSON.parse(fs.readFileSync(0, "utf-8"));
const tool = input.tool_name;
const cmd = (input.tool_input && input.tool_input.command) || "";
const f = (input.tool_input && input.tool_input.file_path) || "";
const projDir = process.cwd();
const hookDir = __dirname;

// ── 1. 规则拦截（支持数组：按顺序匹配，命中即拦截） ──
let rules = {};
try {
  rules = JSON.parse(fs.readFileSync(path.join(hookDir, "rules.json"), "utf-8"));
} catch (e) {}

const matches = rules[tool];
const entries = Array.isArray(matches) ? matches : (matches ? [matches] : []);
for (const entry of entries) {
  let block = false;
  const cond = entry.blockWhen;
  if (cond === "always") block = true;
  else if (cond === "inProject") block = f.startsWith(projDir);
  else if (typeof cond === "string" && cond.startsWith("cmdMatch:")) {
    block = !!cmd.match(new RegExp(cond.slice(9)));
  } else if (typeof cond === "string" && cond.startsWith("extMatch:")) {
    block = !!f.match(new RegExp(cond.slice(9), "i"));
  }
  if (block) {
    console.log(JSON.stringify({
      systemMessage: "⛔ " + entry.msg,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: entry.msg,
      },
    }));
    process.exit(0);
  }
}

// ── 2. 始终注入的提醒（rules.json 的 _reminders 数组，不拦截） ──
const reminders = rules._reminders || [];
let systemMsg = reminders.length > 0 ? reminders.join("\n") : "";

// ── 3. 检查未处理的新 MCP ──
const unknownFile = path.join(hookDir, ".unknown-mcps.json");
let extra = "";
try {
  const unknown = JSON.parse(fs.readFileSync(unknownFile, "utf-8"));
  if (Array.isArray(unknown) && unknown.length > 0) {
    extra = "⚠️ 以下新 MCP 需要分析后添加监督规则：\n" +
      unknown.map((n) => `  ${n}`).join("\n") +
      "\n对 Claude 说「分析新 MCP 并添加监督规则」";
  }
} catch (e) {}

const out = {};
if (extra) {
  if (systemMsg) systemMsg += "\n\n";
  systemMsg += extra;
  out.hookSpecificOutput = {
    hookEventName: "PreToolUse",
    additionalContext: extra,
  };
}
if (systemMsg) {
  out.systemMessage = systemMsg;
}
console.log(JSON.stringify(out));
