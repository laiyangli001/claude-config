#!/usr/bin/env node
// Stop hook：收到 Stop 事件时检测死循环 + MCP 安全守卫
// 检测阈值从 config.mjs 读取，支持 preset 切换和 settings.json 覆盖

import fs from "fs";
import { scanResponse, formatAlert, logAlert } from "./mcp-guard.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 读取 stdin 获取 hook 事件参数 ──
const input = fs.readFileSync(0, "utf-8").trim();
let event;
try { event = JSON.parse(input); } catch {
  process.exit(0);
}

const stopReason = event.stop_reason || "";
const transcriptPath = event.transcript_path || "";
const PENDING_FLAG = path.join(__dirname, ".pending_permission");

// ── 调试日志：记录每次 hook 触发 ──
const HOOK_LOG = path.join(__dirname, ".hook_debug.log");
try {
  const logLine = new Date().toISOString()
    + " stop=" + stopReason
    + " reason=" + stopReason
    + " path=" + (transcriptPath ? "Y" : "N")
    + " file=" + (transcriptPath ? transcriptPath.split("/").pop() : "")
    + " keys=" + Object.keys(event).join(",")
    + "\n";
  fs.appendFileSync(HOOK_LOG, logLine);
} catch {}

if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    process.exit(0);
}

// 任何 Stop 事件都清标记（包括拒绝后 stop_reason 为空的情况）
try { fs.unlinkSync(PENDING_FLAG); } catch {}

// end_turn 继续死循环检测
if (stopReason !== "end_turn") {
  process.exit(0);
}

// ── 从 config.mjs 加载检测参数 ──
import config from "./config.mjs";

// 应用当前预设
const preset = config.presets[config.activePreset] || config.presets.default;
let threshold = preset.jaccardThreshold;

// 尝试从 settings.json 加载覆盖
const SETTINGS_FILE = path.join(__dirname, "settings.json");
try {
  const overrides = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  if (typeof overrides.jaccardThreshold === "number") threshold = overrides.jaccardThreshold;
} catch {}

// ── 读 transcript 末尾，提取最近几轮 ──
const MAX_BYTES = 65536;
const stat = fs.statSync(transcriptPath);
if (stat.size === 0) process.exit(0);

const bufSize = Math.min(stat.size, MAX_BYTES);
const fd = fs.openSync(transcriptPath, "r");
const buf = Buffer.alloc(bufSize);
fs.readSync(fd, buf, 0, bufSize, Math.max(0, stat.size - bufSize));
fs.closeSync(fd);

const tail = buf.toString("utf-8");
const lines = tail.split("\n").filter(Boolean);

// ── 提取 assistant 消息，用于检测 ──
const assistantTexts = [];
for (const line of lines) {
  try {
    const parsed = JSON.parse(line);
    const role = parsed.message?.role || parsed.type || "";
    if (role !== "assistant") continue;
    const contentArr = parsed.message?.content;
    if (!Array.isArray(contentArr)) continue;
    const text = contentArr
      .filter(c => c.type === "text" || c.type === "thinking")
      .map(c => c.text || "")
      .join("\n");
    if (text.length > 50) assistantTexts.push(text);
  } catch {}
}

// 不足 2 条消息，无法判断循环
if (assistantTexts.length < 2) process.exit(0);

// ── Jaccard 相似度检测（阈值从 config.mjs 读取）──
function jaccardSim(textA, textB) {
  const setA = new Set(textA);
  const setB = new Set(textB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const ch of setA) if (setB.has(ch)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

const last = assistantTexts[assistantTexts.length - 1];
const prev = assistantTexts[assistantTexts.length - 2];
const sim = jaccardSim(last, prev);

// ── MCP 安全守卫：检测外部 AI 回复中的恶意注入 ──
const alerts = scanResponse(last);
if (alerts.length > 0) {
  logAlert(alerts);
  const report = formatAlert(alerts, transcriptPath);
    // 注入安全告警
  const AUTOIT_EXE = path.join(__dirname, "deadloop_control.exe");
  if (fs.existsSync(AUTOIT_EXE)) {
    const tmpFile = path.join(__dirname, ".mcp_guard_alert.txt");
    fs.writeFileSync(tmpFile, report, "utf-8");
    try {
      const { execSync } = await import("child_process");
      execSync(`"${AUTOIT_EXE}" inject_file "${tmpFile}"`, { timeout: 10000 });
    } catch {}
    try { fs.unlinkSync(tmpFile); } catch {}
  }
  process.exit(0);
}

// 使用可配置阈值
if (sim < threshold) process.exit(0);

// ── 检测到循环，触发 AutoIt 注入 ──
const AUTOIT_EXE = path.join(__dirname, "deadloop_control.exe");
const INJECT_MSG = `【死循环检测】
对话输出陷入循环（相似度 ${(sim * 100).toFixed(0)}%，阈值 ${(threshold * 100).toFixed(0)}%），请分析并尝试修复。

按照以下 4 步处理：
1. 生成最近 3 轮对话的总结摘要
2. 分析可能的死循环原因
3. 提出修复方案
4. 如果有参考代码，要求对方提供完整代码`;

if (!fs.existsSync(AUTOIT_EXE)) process.exit(0);

import { execSync } from "child_process";

// 注入求助消息（已停止的循环无需 ESC 打断）
const tmpFile = path.join(__dirname, ".deadloop_hook_msg.txt");
fs.writeFileSync(tmpFile, INJECT_MSG, "utf-8");
try {
  execSync(`"${AUTOIT_EXE}" inject_file "${tmpFile}"`, { timeout: 10000 });
} catch {}
try { fs.unlinkSync(tmpFile); } catch {}

process.exit(0);
