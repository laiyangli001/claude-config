import config from "./config.mjs";
import { info, debug } from "./logger.mjs";

// ── 信号1: 重复代码块检测 ──

export class RepeatDetector {
  constructor() {
    this.maxHits = config.repeat.maxHits;
    this.lineCounts = {};
  }

  feed(text) {
    if (!text || text.length < 50) {
      return { fired: false, detail: { hits: 0, threshold: this.maxHits } };
    }

    const lines = text.split("\n");
    let hits = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      // 只关注代码行（含缩进、括号、等号、冒号）
      if (!line || line.length < 10) continue;
      if (/^[,;.+\-*\/\\=<>?!@#$%^&|~`:"]+$/.test(line)) continue;
      if (/^(?:def |class |import |from |return |if |elif |else |for |while |try |except |with |async |await |print|const |let |var |function )/.test(line) ||
          /[=+\-*\/<>!]=?/.test(line) || /\(|\)|\[|\]|\{|\}/.test(line)) {
        // 标准化：去空格、去注释、去字符串
        const key = line
          .replace(/\/\/.*$/, "")
          .replace(/#.*$/, "")
          .replace(/\s+/g, "")
          .slice(0, 100);
        if (!key || key.length < 5) continue;

        this.lineCounts[key] = (this.lineCounts[key] || 0) + 1;
        if (this.lineCounts[key] >= 3) {  // 同一行出现 3 次以上
          hits++;
        }
      }
    }

    // 限制 map 大小
    if (Object.keys(this.lineCounts).length > 500) {
      this.lineCounts = {};
    }

    const fired = hits >= this.maxHits;
    return { fired, detail: { hits, threshold: this.maxHits } };
  }

  reset() {
    this.lineCounts = {};
  }
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// ── 信号2: 逻辑反转词密度 ──

export class ReversalDetector {
  constructor() {
    this.windowSize = config.reversal.windowTokens;
    this.minCount = config.reversal.minCount;
    this.words = config.reversal.words;
  }

  feed(text) {
    if (!text || text.length < 100) {
      return { fired: false, detail: { count: 0, threshold: this.minCount, windowSize: this.windowSize } };
    }

    // 将文本按空格/换行分割为"块"，每个块包含多个中文字符
    const blocks = text.split(/\s+/).filter(Boolean);
    if (blocks.length < 10) {
      return { fired: false, detail: { count: 0, threshold: this.minCount, windowSize: this.windowSize } };
    }

    // 在原始文本中直接搜索反转词子串（避免单字拆分问题）
    const halfW = Math.floor(this.windowSize / 2);
    let charIndex = 0;
    const charLengths = blocks.map(b => b.length);

    for (let start = 0; start < blocks.length; start++) {
      // 估算当前"块窗口"覆盖的字符数 ≈ windowSize
      let charCount = 0;
      let blockEnd = start;
      for (let i = start; i < blocks.length && charCount < this.windowSize; i++) {
        charCount += blocks[i].length;
        blockEnd = i;
      }
      const windowBlocks = blocks.slice(start, blockEnd + 1);
      const windowText = windowBlocks.join(" ");
      if (windowText.length < 20) break;

      // 直接统计反转词在文本中的出现次数
      let reversalCount = 0;
      for (const word of this.words) {
        let pos = 0;
        while ((pos = windowText.indexOf(word, pos)) !== -1) {
          reversalCount++;
          pos += word.length;
        }
      }

      debug("reversal", { count: reversalCount, offset: start });

      if (reversalCount >= this.minCount) {
        return { fired: true, detail: { count: reversalCount, threshold: this.minCount, windowSize: this.windowSize } };
      }
    }
    return { fired: false, detail: { count: 0, threshold: this.minCount, windowSize: this.windowSize } };
  }

  reset() {
    // ReversalDetector 每次 feed 独立分析窗口，无需重置状态
  }
}

// ── 信号3: 信息增量率 ──

export class InfoStallDetector {
  constructor() {
    this.windowSize = config.infoStall.windowTokens;
    this.maxStallCount = config.infoStall.maxStallCount;
    this.stallCount = 0;
    this.seenLines = new Set();
    this.buffer = [];
  }

  _countNewInfo(text) {
    const lines = text.split("\n");
    let newCodeLines = 0;
    let newAssertions = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 代码行（含缩进、等号、括号）
      if (/^[\s]*(?:def |class |import |from |return |if |for |while |const |let |var |function )/.test(trimmed)) {
        const h = simpleHash(trimmed);
        if (!this.seenLines.has(h)) {
          this.seenLines.add(h);
          newCodeLines++;
        }
      }

      // 可验证断言
      if (/\b(?:assert|expect|should|验证|确保|必须)\b/.test(trimmed)) {
        newAssertions++;
      }
    }

    // 限制 seenLines 大小
    if (this.seenLines.size > 2000) {
      this.seenLines.clear();
    }

    return newCodeLines + newAssertions;
  }

  feed(text) {
    const info = this._countNewInfo(text);

    if (info < 1) {
      this.stallCount++;
      debug("infoStall", { info, stallCount: this.stallCount });
    } else {
      this.stallCount = 0;
    }

    const fired = this.stallCount >= this.maxStallCount;
    return { fired, detail: { stallCount: this.stallCount, threshold: this.maxStallCount, currentInfo: info } };
  }

  reset() {
    this.stallCount = 0;
    this.seenLines.clear();
    this.buffer = [];
  }
}
