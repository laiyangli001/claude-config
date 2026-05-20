import fs from "fs";
import config from "./config.mjs";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[config.logLevel] ?? 1;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROTATIONS = 3;

// 日志轮转
function rotate() {
  try {
    const stat = fs.statSync(config.logFile);
    if (stat.size >= MAX_SIZE) {
      for (let i = MAX_ROTATIONS - 1; i >= 0; i--) {
        const old = i === 0 ? config.logFile : `${config.logFile}.${i}`;
        const next = `${config.logFile}.${i + 1}`;
        if (fs.existsSync(old)) {
          if (i === MAX_ROTATIONS - 1) fs.unlinkSync(old);
          else fs.renameSync(old, next);
        }
      }
    }
  } catch { /* 文件不存在不处理 */ }
}
rotate();

let logFd = null;
try {
  logFd = fs.openSync(config.logFile, "a");
} catch { /* 日志文件不可写则跳过 */ }

function timestamp() {
  return new Date().toISOString();
}

export function log(level, msg, data) {
  if (LEVELS[level] < minLevel) return;
  const entry = { t: timestamp(), level, msg, ...(data || {}) };
  const line = JSON.stringify(entry);
  console.error(`[${level}] ${msg}`, data ? JSON.stringify(data) : "");
  if (logFd) {
    try { fs.writeSync(logFd, line + "\n"); } catch { /* 忽略 */ }
  }
}

export const debug = (msg, d) => log("debug", msg, d);
export const info  = (msg, d) => log("info",  msg, d);
export const warn  = (msg, d) => log("warn",  msg, d);
export const error = (msg, d) => log("error", msg, d);
