import fs from "fs";
import path from "path";
import config from "./config.mjs";
import { info, warn, error } from "./logger.mjs";
import {
  createStdioMcpClient,
  cleanAssistantOutput,
  parseJsonlLine,
  JsonlReader,
  DialogWindow,
} from "./helpers.mjs";
import {
  RepeatDetector,
  ReversalDetector,
  InfoStallDetector,
} from "./detectors.mjs";
import { buildSummary } from "./summarizer.mjs";

const CFG = config;
let helpClient = null;
let reader = null;
let dialog = new DialogWindow(5);

const repeatDet = new RepeatDetector();
const reversalDet = new ReversalDetector();
const infoDet = new InfoStallDetector();

let loopSample = "";
let helpCount = 0;
let state = "WAITING"; // WAITING → MONITORING → HELPING → COOLDOWN → MONITORING

// ── 自动发现 .jsonl 文件 ──
function autoDiscoverSessionFile() {
  if (CFG.sessionFile && fs.existsSync(CFG.sessionFile)) return CFG.sessionFile;

  const projectsDir = path.join(process.env.HOME || process.env.USERPROFILE, ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return "";

  let latest = "";
  let latestMtime = 0;
  for (const slug of fs.readdirSync(projectsDir)) {
    const dir = path.join(projectsDir, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const fp = path.join(dir, file);
      const mtime = fs.statSync(fp).mtimeMs;
      if (mtime > latestMtime) { latest = fp; latestMtime = mtime; }
    }
  }
  return latest;
}

// ── 连接求助 MCP ──
async function connectHelp() {
  helpClient = await createStdioMcpClient(CFG.helpMcp.command, CFG.helpMcp.args, "deadloop-monitor", CFG.helpMcp.requestTimeoutMs);
  info("help mcp connected");
}

// ── 读取增量并逐条检测 ──
function processAndCheck() {
  const lines = reader.readLines();
  if (lines.length === 0) return false;

  let totalTokens = 0;
  let detected = false;
  let lastAssistantContent = "";

  for (const line of lines) {
    const parsed = parseJsonlLine(line);
    if (!parsed) continue;

    dialog.add(parsed.role, parsed.content);

    if (parsed.role !== "assistant") continue;

    const cleaned = cleanAssistantOutput(parsed.content);
    if (!cleaned || cleaned.length < 20) continue;

    totalTokens += cleaned.split(/\s+/).length;
    lastAssistantContent = cleaned;

    // 每条 assistant 消息分别 feed 检测器
    let signals = 0;
    if (repeatDet.feed(cleaned)) signals++;
    if (reversalDet.feed(cleaned)) signals++;
    if (infoDet.feed(cleaned)) signals++;

    if (signals >= 2) {
      loopSample = cleaned.slice(-1000);
      detected = true;
      break; // 已检测到，不需要再处理后续消息
    }
  }

  if (totalTokens > CFG.maxTokensPerCycle) {
    warn("cpu protection", { tokens: totalTokens });
  }

  return detected;
}

// ── 求助 ──
async function sendHelp() {
  helpCount++;
  info("sending help", { count: helpCount });

  const msgs = dialog.getRecent();
  const summary = buildSummary(msgs, loopSample);
  info("summary built", { len: summary.length });

  try {
    const r = await helpClient.callTool({
      name: CFG.helpMcp.toolName,
      arguments: { question: summary },
    }, undefined, { timeout: CFG.helpMcp.requestTimeoutMs });
    const advice = typeof r.content?.[0]?.text === "string"
      ? r.content[0].text
      : JSON.stringify(r);

    info("help received", { len: advice.length });

    // 覆盖写入建议文件
    const header = `# 死循环建议（${new Date().toISOString()}）\n\n`;
    fs.writeFileSync(CFG.adviceFile, header + advice, "utf-8");
    info("advice saved", { file: CFG.adviceFile });

    // 桌面通知
    try {
      const { execSync } = await import("child_process");
      execSync(
        `msg * "检测到死循环！建议已写入 ${CFG.adviceFile}，请查看"`,
        { timeout: 3000 }
      );
    } catch { /* 通知失败不影响主流程 */ }
  } catch (err) {
    error("help failed", { msg: err.message });
  }
}

function resetDetectors() {
  repeatDet.reset();
  reversalDet.reset();
  infoDet.reset();
  dialog.reset();
  loopSample = "";
}

// ── 主入口 ──
async function main() {
  info("starting");

  // 找到 .jsonl 文件
  let sessionFile = autoDiscoverSessionFile();
  while (!sessionFile) {
    warn("no session file found, retrying in 5s");
    await sleep(5000);
    sessionFile = autoDiscoverSessionFile();
  }
  info("session file", { path: sessionFile });

  reader = new JsonlReader(sessionFile);
  await connectHelp();

  state = "MONITORING";
  info("state", { state });

  let cooldownUntil = 0;

  while (true) {
    await sleep(CFG.pollInterval);

    if (state === "COOLDOWN") {
      if (Date.now() >= cooldownUntil) {
        state = "MONITORING";
        info("state", { state: "MONITORING (cooldown ended)" });
      }
      continue;
    }

    if (state !== "MONITORING") continue;

    const detected = processAndCheck();
    if (detected) {
      warn("loop detected");
      // 桌面通知
      try {
        const { execSync } = await import("child_process");
        execSync(`msg * "Claude Code 检测到死循环，正在自动修复..."`, { timeout: 3000 });
      } catch { /* 忽略 */ }
      state = "HELPING";
      info("state", { state });

      await sendHelp();

      // 进入冷却期
      state = "COOLDOWN";
      cooldownUntil = Date.now() + CFG.cooldownMs;
      info("state", { state: "COOLDOWN", until: new Date(cooldownUntil).toISOString() });
      resetDetectors();
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  error("fatal", { msg: err.message, stack: err.stack });
  process.exit(1);
});
