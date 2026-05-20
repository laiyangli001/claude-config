import fs from "fs";
import path from "path";
import readline from "readline";
import config from "./config.mjs";
import { info, warn, error } from "./logger.mjs";
import {
  cleanAssistantOutput,
  parseJsonlLine,
  JsonlReader,
  DialogWindow,
  injectToTerminal,
  checkStopReason,
} from "./helpers.mjs";
import {
  RepeatDetector,
  ReversalDetector,
  InfoStallDetector,
} from "./detectors.mjs";
import { buildSummary } from "./summarizer.mjs";

const CFG = config;

const STATE = {
  IDLE: "IDLE",
  MONITORING: "MONITORING",
  HELPING: "HELPING",
  COOLDOWN: "COOLDOWN",
  PAUSED: "PAUSED",
};

let state = STATE.IDLE;
let reader = null;
let dialog = new DialogWindow(5);

const repeatDet = new RepeatDetector();
const reversalDet = new ReversalDetector();
const infoDet = new InfoStallDetector();

let loopSample = "";
let helpCount = 0;
let cooldownUntil = 0;
let cumulativeTokens = 0;

// ── 发送 Ctrl+C 中断 ──
function sendCtrlC() {
  return injectToTerminal(""); // 空输入 + Enter 在某些终端下表现同 Ctrl+C
}

// ── stdin 控制命令（与 workspace-watcher 通信） ──
function setupStdin() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    try {
      const cmd = JSON.parse(line);
      if (cmd.command === "pause") {
        if (state === STATE.MONITORING) {
          state = STATE.PAUSED;
          console.log(JSON.stringify({ status: "paused" }));
          info("paused by user");
        }
      } else if (cmd.command === "resume") {
        if (state === STATE.PAUSED) {
          state = STATE.MONITORING;
          console.log(JSON.stringify({ status: "monitoring" }));
          info("resumed by user");
        }
      } else if (cmd.command === "stop") {
        console.log(JSON.stringify({ status: "stopping" }));
        info("stopped by user");
        process.exit(0);
      } else if (cmd.command === "status") {
        console.log(JSON.stringify({
          status: state.toLowerCase(),
          pid: process.pid,
        }));
      }
    } catch { /* 忽略无效指令 */ }
  });
  // stdin 关闭不退出，保持监控运行
}

// ── 自动发现 .jsonl 文件 ──
function autoDiscoverSessionFile() {
  if (CFG.sessionFile && fs.existsSync(CFG.sessionFile)) return CFG.sessionFile;
  const projectsDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    ".claude", "projects"
  );
  if (!fs.existsSync(projectsDir)) return "";
  let latest = "", latestMtime = 0;
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

// ── 读取增量并逐条检测（返回 null=无新内容, false=无循环, true=有循环）─
function processAndCheck() {
  const lines = reader.readLines();
  if (lines.length === 0) return null;

  let detected = false;
  let newTokens = 0;

  for (const line of lines) {
    const parsed = parseJsonlLine(line);
    if (!parsed) continue;
    dialog.add(parsed.role, parsed.content);
    if (parsed.role !== "assistant") continue;
    const cleaned = cleanAssistantOutput(parsed.content);
    if (!cleaned || cleaned.length < 20) continue;
    const tokens = cleaned.split(/\s+/).length;
    newTokens += tokens;
    cumulativeTokens += tokens;

    let signals = 0;
    if (repeatDet.feed(cleaned)) signals++;
    if (reversalDet.feed(cleaned)) signals++;
    if (infoDet.feed(cleaned)) signals++;
    if (signals >= 2) {
      loopSample = cleaned.slice(-1000);
      detected = true;
      break;
    }
  }

  // 有新内容时输出 tokenCount（无论是否检测到循环）
  if (newTokens > 0) {
    console.log(JSON.stringify({ status: state.toLowerCase(), tokenCount: cumulativeTokens }));
  }
  if (newTokens > CFG.maxTokensPerCycle) {
    warn("cpu protection", { tokens: newTokens });
  }
  return detected;
}

// ── 等待停止确认（轮询 .jsonl 的 stop_reason） ──
async function waitForStop() {
  const maxWait = 60000;
  const interval = 1000;
  let elapsed = 0;

  // 先发一个空行确保提交
  const sent = injectToTerminal("");
  if (!sent) {
    warn("SendKeys failed, skip stop wait");
    return true;
  }

  while (elapsed < maxWait) {
    await sleep(interval);
    elapsed += interval;

    const lines = reader.readLines();
    for (const line of lines) {
      const reason = checkStopReason(line);
      if (reason === "stopped" || reason === "interrupted") {
        info("stop confirmed", { reason, elapsed });
        return true;
      }
    }
  }

  warn("stop not confirmed after 60s");
  return false;
}

// ── 注入摘要指令 ──
function injectSummary() {
  const msgs = dialog.getRecent();
  const summary = buildSummary(msgs, loopSample);
  info("injecting summary", { len: summary.length });

  const instruction =
    "你刚才的输出陷入了重复循环。请用第三人称，简洁总结以下内容（仅用于向另一个AI求助）：\n" +
    "1. 用户的原始需求与关键约束\n" +
    "2. 已经尝试过的方案及其明确结果\n" +
    "3. 当前卡住的循环表现（比如反复输出某段代码，或来回推翻自己）\n" +
    "4. 最需要被解决的一个具体问题\n" +
    "注意：只输出总结，不要道歉，不要继续之前的输出。";

  return injectToTerminal(instruction);
}

function resetDetectors() {
  repeatDet.reset();
  reversalDet.reset();
  infoDet.reset();
  dialog.reset();
  loopSample = "";
  cumulativeTokens = 0;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 主入口 ──
async function main() {
  info("starting", { pid: process.pid });

  setupStdin();

  let sessionFile = autoDiscoverSessionFile();
  while (!sessionFile) {
    warn("no session file, retrying in 5s");
    await sleep(5000);
    sessionFile = autoDiscoverSessionFile();
  }
  info("session file", { path: sessionFile });

  reader = new JsonlReader(sessionFile);
  // 跳过历史内容，只检测启动后的新输出
  reader.lastSize = fs.statSync(sessionFile).size;
  state = STATE.MONITORING;
  info("state", { state });

  while (true) {
    await sleep(CFG.pollInterval);

    // 每轮更新心跳文件（扩展读此文件 mtime 判断进程存活）
    try { fs.writeFileSync(".deadloop-heartbeat", String(Date.now())); } catch {}

    // 处理冷却期
    if (state === STATE.COOLDOWN && Date.now() >= cooldownUntil) {
      state = STATE.MONITORING;
      info("cooldown ended");
    }

    if (state === STATE.COOLDOWN || state === STATE.PAUSED) {
      // 冷却/暂停期间也发心跳给扩展（带 tokenCount）
      const st = state === STATE.COOLDOWN ? "cooling" : state.toLowerCase();
      console.log(JSON.stringify({ status: st, tokenCount: 0 }));
      continue;
    }

    const detected = processAndCheck();
    if (detected === null) {
      // 无新内容，发送心跳
      console.log(JSON.stringify({ status: "monitoring", tokenCount: 0 }));
      continue;
    }
    if (detected === false) continue; // 有新内容但无循环
    if (state !== STATE.MONITORING) continue;

    // ── 检测到死循环 ──
    warn("loop detected");
    console.log("DEADLOOP_DETECTED");
    state = STATE.HELPING;
    info("state", { state });

    await sendCtrlC();

    const stopped = await waitForStop();
    if (stopped) {
      injectSummary();
      await sleep(500);
      injectToTerminal(""); // 发 Enter 提交
    } else {
      warn("manual intervention required");
      console.log("NEEDS_MANUAL");
    }

    state = STATE.COOLDOWN;
    cooldownUntil = Date.now() + CFG.cooldownMs;
    info("state", { state: "COOLDOWN" });
    resetDetectors();
    // 跳过冷却期间写入的内容（包括注入消息等）
    try { reader.lastSize = fs.statSync(reader.filePath).size; } catch {}
  }
}

main().catch(err => {
  error("fatal", { msg: err.message });
  process.exit(1);
});
