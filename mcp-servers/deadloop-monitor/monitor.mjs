import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import config from "./config.mjs";
import { info, warn, error } from "./logger.mjs";
import {
  cleanAssistantOutput,
  parseJsonlLine,
  JsonlReader,
  DialogWindow,
  sendEscViaAutoIt,
  sendEscViaAutoItAsync,
  injectViaAutoIt,
  pasteViaAutoIt,
  checkFileForStop,
  setVscodePid,
} from "./helpers.mjs";
import {
  JaccardSimDetector,
  ReversalDetector,
  NGramInfoGainDetector,
  reloadConfig as reloadDetectorConfig,
} from "./detectors.mjs";

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

const jaccardDet = new JaccardSimDetector();
const reversalDet = new ReversalDetector();
const infoDet = new NGramInfoGainDetector();

let loopSample = "";
let helpCount = 0;
let cooldownUntil = 0;
let cumulativeTokens = 0;
let lastDetectorDetails = null;
let heartbeatFile = "";

// ── stdin 控制命令（与 workspace-watcher 通信） ──
function setupStdin() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    try {
      const cmd = JSON.parse(line);
      if (cmd.command === "pause") {
        if (state === STATE.MONITORING || state === STATE.HELPING) {
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
      } else if (cmd.command === "reloadConfig") {
        reloadDetectorConfig();
        info("config reloaded via command");
        console.log(JSON.stringify({ status: state.toLowerCase(), info: "config reloaded" }));
      }
    } catch { /* 忽略无效指令 */ }
  });
  // stdin 关闭不退出，保持监控运行
}

// ── 自动发现 .jsonl 文件 ──
function autoDiscoverSessionFile() {
  if (CFG.sessionFile && fs.existsSync(CFG.sessionFile)) return CFG.sessionFile;
  // 用传入的工作区路径匹配 projects 子目录
  const wsPath = process.argv[2] || process.cwd();
  if (wsPath) {
    const slug = wsPath.replace(/[:\\\/._]/g, '-').toLowerCase();
    const sessionDir = path.join(
      process.env.HOME || process.env.USERPROFILE,
      ".claude", "projects", slug
    );
    if (fs.existsSync(sessionDir)) {
      for (const file of fs.readdirSync(sessionDir)) {
        if (file.endsWith(".jsonl")) return path.join(sessionDir, file);
      }
    }
  }
  return "";
}

// ── 读取增量并逐条检测（返回 null=无新内容, false=无循环, true=有循环）─
function processAndCheck() {
  const rawLines = reader.readLines();
  if (rawLines.length === 0) return null;

  // 预扫描：提取 tool_use → parentUuid 映射（用于反转词有效性验证）
  const toolSigsByParent = {};
  for (const line of rawLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant" && obj.parentUuid) {
        const calls = [];
        for (const part of obj.message?.content || []) {
          if (part.type === "tool_use") {
            calls.push({ name: part.name, input: JSON.stringify(part.input).slice(0, 80) });
          }
        }
        if (calls.length > 0) toolSigsByParent[obj.parentUuid] = calls;
      }
    } catch {}
  }

  let detected = false;
  let newTokens = 0;

  for (const line of rawLines) {
    const parsed = parseJsonlLine(line);
    if (!parsed) continue;
    dialog.add(parsed.role, parsed.content);
    if (parsed.role !== "assistant") continue;

    // 提取 thinking 文本用于检测
    let detText = parsed.content;
    try {
      const obj = JSON.parse(line);
      for (const part of obj.message?.content || []) {
        if (part.type === "thinking") { detText = part.thinking || ""; break; }
      }
    } catch {}

    const cleaned = cleanAssistantOutput(detText);
    if (!cleaned || cleaned.length < 20) continue;
    const tokens = cleaned.split(/\s+/).length;
    newTokens += tokens;
    cumulativeTokens += tokens;

    let signals = 0;
    try {
      const obj = JSON.parse(line);
      const toolSigs = toolSigsByParent[obj.uuid] || null;
      const r = jaccardDet.feed(cleaned);
      const rev = reversalDet.feed(cleaned, toolSigs);
      const inf = infoDet.feed(cleaned);
      if (r.fired) signals++;
      if (rev.fired) signals++;
      if (inf.fired) signals++;
      if (signals > 0) {
        lastDetectorDetails = { jaccard: r.detail, reversal: rev.detail, infoStall: inf.detail, signals };
        warn("detect signal", { jaccard: r.fired, reversal: rev.fired, infoStall: inf.fired, signals, tokens, preview: cleaned.slice(0, 100) });
      }
    } catch (e) {
      warn("detector feed error", { error: e.message });
    }
    if (signals >= 2) {
      loopSample = cleaned.slice(-1000);
      detected = true;
      break;
    }
  }

  // 有新内容时输出 tokenCount + 检测器状态（无论是否检测到循环）
  if (newTokens > 0) {
    const statusLine = { status: state.toLowerCase(), tokenCount: cumulativeTokens };
    if (lastDetectorDetails) statusLine.detectors = lastDetectorDetails;
    console.log(JSON.stringify(statusLine));
  }
  if (newTokens > CFG.maxTokensPerCycle) {
    warn("cpu protection", { tokens: newTokens });
  }
  return detected;
}

// ── 发送 ESC + 重试等待停止（先尝试扩展 API，回退 PowerShell）──
async function waitForStop() {
  // 先全量扫描文件末尾，可能已经 stopped
  if (checkFileForStop(reader.filePath)) {
    info("already stopped");
    return true;
  }

  for (let i = 0; i < 3; i++) {
    if (state === STATE.PAUSED) { info("pause during helping"); return false; }

    await sendEscViaAutoItAsync(); // 非阻塞，事件循环可响应 stdin
    try { fs.writeFileSync(heartbeatFile, String(Date.now())); } catch {}
    await sleep(5000);  // 再等 5 秒让写入落盘

    if (state === STATE.PAUSED) { info("pause during helping"); return false; }

    // 心跳
    try { fs.writeFileSync(heartbeatFile, String(Date.now())); } catch {}
    console.log(JSON.stringify({ status: "helping", tokenCount: cumulativeTokens }));

    if (checkFileForStop(reader.filePath)) {
      info("stop confirmed", { attempt: i + 1 });
      return true;
    }

    if (i < 2) warn("stop retry", { attempt: i + 1 });
  }

  // 3 次后仍未确认到停止，需要手动干预
  warn("stop not confirmed after 3 attempts");
  console.log("NEEDS_MANUAL");
  return false;
}

// ── 注入摘要指令（优先扩展 API，回退 PowerShell）──
function injectSummary() {
  const instruction =
    "你刚才的输出陷入了重复循环。请用第三人称，简洁总结以下内容（仅用于向另一个AI求助）：\n" +
    "1. 用户的原始需求与关键约束\n" +
    "2. 已经尝试过的方案及其明确结果\n" +
    "3. 当前卡住的循环表现（比如反复输出某段代码，或来回推翻自己）\n" +
    "4. 最需要被解决的一个具体问题\n" +
    "注意：只输出总结，不要道歉，不要继续之前的输出。\n" +
    "\n" +
    "总结后，请发送 `/mcp-baipiao` 将以上总结发送出去分析。收到回答后根据建议修改代码。";

	// AutoIt 注入（Ctrl+V 粘贴 + Enter + Ctrl+Enter 提交）
  injectViaAutoIt(instruction);
}

function resetDetectors() {
  jaccardDet.reset();
  reversalDet.reset();
  infoDet.reset();
  dialog.reset();
  loopSample = "";
  cumulativeTokens = 0;
  lastDetectorDetails = null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 主入口 ──
async function main() {
  info("starting", { pid: process.pid });

  setupStdin();

  // 从 argv[3] 接收 VS Code 主窗口 PID，用于 AutoIt 精准匹配目标窗口
  const vscodePid = parseInt(process.argv[3], 10) || 0;
  if (vscodePid) setVscodePid(vscodePid);

  let sessionFile = autoDiscoverSessionFile();
  while (!sessionFile) {
    warn("no session file, retrying in 5s");
    await sleep(5000);
    sessionFile = autoDiscoverSessionFile();
  }
  info("session file", { path: sessionFile });

  // 用绝对路径写心跳，确保扩展能读到
  const MONITOR_DIR = path.dirname(fileURLToPath(import.meta.url));
  heartbeatFile = path.join(MONITOR_DIR, ".deadloop-heartbeat");

  reader = new JsonlReader(sessionFile);
  // 从持久化文件恢复 reader position，防止重启遗漏/重复
  const posFile = sessionFile + ".pos";
  try {
    const saved = fs.readFileSync(posFile, "utf-8");
    reader.lastSize = parseInt(saved, 10) || 0;
  } catch { /* 首次启动，从 0 开始 */ }
  info("reader start", { fileSize: fs.statSync(sessionFile).size, lastSize: reader.lastSize });
  state = STATE.MONITORING;
  info("state", { state });

  while (true) {
    await sleep(CFG.pollInterval);

    // 每轮更新心跳文件（扩展读此文件 mtime 判断进程存活）
    try { fs.writeFileSync(heartbeatFile, String(Date.now())); } catch {}

    // 处理冷却期
    if (state === STATE.COOLDOWN && Date.now() >= cooldownUntil) {
      state = STATE.MONITORING;
      info("cooldown ended");
    }

    if (state === STATE.COOLDOWN || state === STATE.PAUSED) {
      // 冷却/暂停期间也发心跳给扩展
      const st = state === STATE.COOLDOWN ? "cooling" : state.toLowerCase();
      const extra = state === STATE.COOLDOWN ? { cooldownLeft: Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)) } : {};
      console.log(JSON.stringify({ status: st, tokenCount: cumulativeTokens, ...extra }));
      continue;
    }

    const detected = processAndCheck();
    // 持久化 reader position，支持跨重启续读
    try { fs.writeFileSync(posFile, String(reader.lastSize)); } catch {}
    if (detected === null) {
      // 无新内容，发送心跳（保留累计 token）
      console.log(JSON.stringify({ status: "monitoring", tokenCount: cumulativeTokens }));
      continue;
    }
    if (detected === false) continue; // 有新内容但无循环
    if (state !== STATE.MONITORING) continue;

    // ── 检测到死循环 ──
    warn("loop detected");
    // 先发检测详情给 extension，再发 DEADLOOP_DETECTED
    if (lastDetectorDetails) {
      console.log(JSON.stringify({ status: "alert", detectors: lastDetectorDetails }));
    }
    console.log("DEADLOOP_DETECTED");
    state = STATE.HELPING;
    info("state", { state });

    const stopped = await waitForStop(); // 内部发 ESC + 重试
    if (state === STATE.PAUSED) continue; // 暂停时跳过注入
    if (stopped) {
      injectSummary(); // 扩展 API 自动带 Enter 提交
    } else {
      const instruction =
        "你刚才的输出陷入了重复循环。请用第三人称，简洁总结以下内容（仅用于向另一个AI求助）：\n" +
        "1. 用户的原始需求与关键约束\n" +
        "2. 已经尝试过的方案及其明确结果\n" +
        "3. 当前卡住的循环表现（比如反复输出某段代码，或来回推翻自己）\n" +
        "4. 最需要被解决的一个具体问题\n" +
        "注意：只输出总结，不要道歉，不要继续之前的输出。\n" +
        "\n" +
        "总结后，请发送 `/mcp-baipiao` 将以上总结发送出去分析。收到回答后根据建议修改代码。";
      pasteViaAutoIt(instruction);
      console.log("MANUAL_SEND_REQUIRED");
    }

    state = STATE.COOLDOWN;
    cooldownUntil = Date.now() + CFG.cooldownMs;
    info("state", { state: "COOLDOWN" });
    resetDetectors();
    // 跳过冷却期间写入的内容（包括注入消息等）
    try { reader.lastSize = fs.statSync(reader.filePath).size; } catch {}
    try { fs.writeFileSync(posFile, String(reader.lastSize)); } catch {}
  }
}

main().catch(err => {
  error("fatal", { msg: err.message });
  process.exit(1);
});
