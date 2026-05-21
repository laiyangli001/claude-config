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
        if (this.lineCounts[key] >= 5) {  // 同一行出现 5 次以上
          hits++;
        }
      }
    }

    // 限制 map 大小（长期运行避免膨胀）
    if (Object.keys(this.lineCounts).length > 2000) {
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
    this.buffer = []; // 跨 feed 累积的块缓冲
  }

  feed(text) {
    if (!text || text.length < 100) {
      return { fired: false, detail: { count: 0, threshold: this.minCount, windowSize: this.windowSize } };
    }

    // 将文本按空格/换行分割为"块"，追加到缓冲区
    const blocks = text.split(/\s+/).filter(Boolean);
    if (blocks.length < 10) {
      return { fired: false, detail: { count: 0, threshold: this.minCount, windowSize: this.windowSize } };
    }

    this.buffer.push(...blocks);
    // 裁剪缓冲区：保留约 2x windowSize 字符的数据
    let charTotal = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      charTotal += this.buffer[i].length;
      if (charTotal > this.windowSize * 2 && i > 0) {
        this.buffer = this.buffer.slice(i);
        break;
      }
    }

    // 在缓冲区上滑动窗口分析（跨多次 feed）
    for (let start = 0; start < this.buffer.length; start++) {
      let charCount = 0;
      let blockEnd = start;
      for (let i = start; i < this.buffer.length && charCount < this.windowSize; i++) {
        charCount += this.buffer[i].length;
        blockEnd = i;
      }
      const windowText = this.buffer.slice(start, blockEnd + 1).join(" ");
      if (windowText.length < 20) break;

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
    this.buffer = [];
  }
}

// ── 信号3: 信息增量率 ──

export class InfoStallDetector {
  constructor() {
    this.windowSize = config.infoStall.windowTokens;
    this.maxStallCount = config.infoStall.maxStallCount;
    this.stallCount = 0;
    this.seenLines = new Set();
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
