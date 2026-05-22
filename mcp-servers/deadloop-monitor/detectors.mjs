import config from "./config.mjs";
import { info, debug, warn } from "./logger.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "settings.json");

// ── 加载动态配置（与 settings.json 合并）──
function loadMergedConfig() {
  const cfg = {
    jaccardThreshold: config.detectors.jaccard.threshold,
    reversalMinCount: config.detectors.reversal.minCount,
    infoNgram: config.detectors.infoStall.ngram,
    lowInfoThreshold: config.detectors.infoStall.lowInfoThreshold,
    maxStall: config.detectors.infoStall.maxStall,
  };
  try {
    const overrides = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    if (typeof overrides.jaccardThreshold === "number") cfg.jaccardThreshold = overrides.jaccardThreshold;
    if (typeof overrides.reversalMinCount === "number") cfg.reversalMinCount = overrides.reversalMinCount;
    if (typeof overrides.infoNgram === "number") cfg.infoNgram = overrides.infoNgram;
    if (typeof overrides.lowInfoThreshold === "number") cfg.lowInfoThreshold = overrides.lowInfoThreshold;
    if (typeof overrides.maxStall === "number") cfg.maxStall = overrides.maxStall;
  } catch {}
  return cfg;
}

let activeCfg = loadMergedConfig();

// ── 公开：让 monitor.mjs 可触发重载 ──
export function reloadConfig() {
  activeCfg = loadMergedConfig();
  info("config reloaded", activeCfg);
}

// ════════════════════════════════════════
// 信号1: Jaccard 相似度滑动窗口检测器
// ════════════════════════════════════════

export class JaccardSimDetector {
  constructor() {
    this.window = [];
    this.maxWindow = config.detectors.jaccard.window;
  }

  jaccardSim(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    for (const ch of setA) if (setB.has(ch)) inter++;
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  feed(text) {
    if (!text || text.length < 50) {
      return { fired: false, detail: { sim: 0, streak: 0, threshold: activeCfg.jaccardThreshold } };
    }

    this.window.push(new Set(text));
    if (this.window.length > this.maxWindow + 2) {
      this.window.shift();
    }

    let streak = 0;
    for (let i = 1; i < this.window.length; i++) {
      const sim = this.jaccardSim(this.window[i - 1], this.window[i]);
      if (sim >= activeCfg.jaccardThreshold) streak++;
      else streak = 0;
    }

    const fired = streak >= this.maxWindow - 1;
    const currentSim = this.window.length >= 2
      ? this.jaccardSim(this.window[this.window.length - 2], this.window[this.window.length - 1])
      : 0;

    return { fired, detail: { sim: currentSim, streak, threshold: activeCfg.jaccardThreshold } };
  }

  reset() { this.window = []; }
}

// ════════════════════════════════════════
// 信号2: 反转词密度 + 有效性验证
// ════════════════════════════════════════

function buildWordList() {
  const cats = config.detectors.reversal.wordCategories;
  const words = [];
  for (const arr of Object.values(cats)) words.push(...arr);
  return words;
}
const REVERSAL_WORDS = buildWordList();

export class ReversalDetector {
  constructor() {
    this.windowSize = config.detectors.reversal.windowChars;
    this.buffer = [];
    this.lastToolSigs = null;
    this.invalidStreak = 0;
  }

  feed(text, toolSigs) {
    if (!text || text.length < 100) {
      return { fired: false, detail: { count: 0, threshold: activeCfg.reversalMinCount, invalidStreak: this.invalidStreak } };
    }

    const blocks = text.split(/\s+/).filter(Boolean);
    this.buffer.push(...blocks);
    let charTotal = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      charTotal += this.buffer[i].length;
      if (charTotal > this.windowSize * 2 && i > 0) {
        this.buffer = this.buffer.slice(i);
        break;
      }
    }

    let maxCount = 0;
    for (let start = 0; start < this.buffer.length; start++) {
      let charCount = 0;
      let blockEnd = start;
      for (let i = start; i < this.buffer.length && charCount < this.windowSize; i++) {
        charCount += this.buffer[i].length;
        blockEnd = i;
      }
      const windowText = this.buffer.slice(start, blockEnd + 1).join(" ");
      if (windowText.length < 20) break;

      let count = 0;
      for (const word of REVERSAL_WORDS) {
        let pos = 0;
        while ((pos = windowText.indexOf(word, pos)) !== -1) {
          count++;
          pos += word.length;
        }
      }
      if (count > maxCount) maxCount = count;
    }

    // 有效性验证：反转词出现后工具调用是否变化
    const found = maxCount > 0;
    if (found && toolSigs) {
      const sigStr = JSON.stringify(toolSigs.map(t => t.name + ":" + t.input.slice(0, 40)));
      if (this.lastToolSigs !== null && sigStr === this.lastToolSigs) {
        this.invalidStreak++;
      } else {
        this.invalidStreak = 0;
      }
      this.lastToolSigs = sigStr;
    } else if (found && toolSigs === undefined) {
      // 无工具签名时不清除 invalidStreak（保留判断）
    } else {
      this.invalidStreak = 0;
    }

    const fired = maxCount >= activeCfg.reversalMinCount && this.invalidStreak < 3;
    return { fired, detail: { count: maxCount, threshold: activeCfg.reversalMinCount, invalidStreak: this.invalidStreak } };
  }

  reset() {
    this.buffer = [];
    this.lastToolSigs = null;
    this.invalidStreak = 0;
  }
}

// ════════════════════════════════════════
// 信号3: n-gram 信息增量率
// ════════════════════════════════════════

export class NGramInfoGainDetector {
  constructor() {
    this.prevNgrams = null;
    this.stallCount = 0;
  }

  getNgrams(text, n) {
    const s = new Set();
    for (let i = 0; i <= text.length - n; i++) {
      s.add(text.slice(i, i + n));
    }
    return s;
  }

  feed(text) {
    if (!text || text.length < 50) {
      return { fired: false, detail: { gainRate: 0, stallCount: this.stallCount, maxStall: activeCfg.maxStall } };
    }

    const currNgrams = this.getNgrams(text, activeCfg.infoNgram);
    let gainRate = 0;
    if (this.prevNgrams && currNgrams.size > 0) {
      let newNgrams = 0;
      for (const ng of currNgrams) {
        if (!this.prevNgrams.has(ng)) newNgrams++;
      }
      gainRate = currNgrams.size > 0 ? newNgrams / currNgrams.size : 0;
    }
    this.prevNgrams = currNgrams;

    if (gainRate < activeCfg.lowInfoThreshold) {
      this.stallCount++;
    } else {
      this.stallCount = 0;
    }

    const fired = this.stallCount >= activeCfg.maxStall;
    return { fired, detail: { gainRate, stallCount: this.stallCount, maxStall: activeCfg.maxStall } };
  }

  reset() {
    this.prevNgrams = null;
    this.stallCount = 0;
  }
}
