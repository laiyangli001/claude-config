// 会话健康度分析 — 分析 .jsonl 中的 thinking 片段并生成报告
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import config from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = config;

// ── 反转词列表（与 config.mjs 一致）──
const REVERSAL_WORDS = new Set(CFG.reversal.words);

function buildReversalPattern() {
  const escaped = [...REVERSAL_WORDS].map(w => {
    if (/^[a-zA-Z]/.test(w)) return `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(escaped.join('|'), 'gi');
}
const RE_PATTERN = buildReversalPattern();

// ── 自动发现会话文件（同 monitor.mjs 逻辑）──
function autoDiscoverSessionFile(wsPath) {
  if (!wsPath) return "";
  const slug = wsPath.replace(/[:\\/.]/g, '-').toLowerCase();
  const sessionDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    ".claude", "projects", slug
  );
  if (fs.existsSync(sessionDir)) {
    const files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith(".jsonl"))
      .sort((a, b) => fs.statSync(path.join(sessionDir, b)).mtimeMs - fs.statSync(path.join(sessionDir, a)).mtimeMs);
    if (files.length > 0) return path.join(sessionDir, files[0]);
  }
  return "";
}

// ── JSONL 解析 ──
function loadJsonl(filePath) {
  const records = [];
  const data = fs.readFileSync(filePath, "utf-8");
  for (const line of data.split("\n").filter(Boolean)) {
    try { records.push(JSON.parse(line)); } catch {}
  }
  return records;
}

// ── 提取 thinking 与对应工具调用 ──
function extractThinkingAndTools(records) {
  const items = [];
  for (let i = 0; i < records.length; i++) {
    const obj = records[i];
    if (obj.type !== "assistant") continue;
    const content = obj.message?.content || [];
    let thinkingText = null;
    for (const part of content) {
      if (part.type === "thinking") { thinkingText = part.thinking; break; }
    }
    if (!thinkingText) continue;

    const uid = obj.uuid || "";
    const ts = obj.timestamp || "";

    // 查找后继 assistant 消息（tool_use 在独立消息中）
    const toolCalls = [];
    if (i + 1 < records.length) {
      const next = records[i + 1];
      if (next.type === "assistant" && next.parentUuid === uid) {
        for (const part of next.message?.content || []) {
          if (part.type === "tool_use") {
            toolCalls.push({ name: part.name, input: JSON.stringify(part.input) });
          }
        }
      }
    }

    items.push({ timestamp: ts, thinking: thinkingText, toolCalls });
  }
  return items;
}

// ── 工具函数 ──
function jaccardSim(a, b) {
  const setA = new Set(a), setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const ch of setA) if (setB.has(ch)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// 信息增量率：字符级新字符占比
function infoGainRate(prev, curr) {
  const setA = new Set(prev), setB = new Set(curr);
  if (setB.size === 0) return 0;
  let newChars = 0;
  for (const ch of setB) if (!setA.has(ch)) newChars++;
  return newChars / setB.size;
}

// 重复块检测
function findRepeatedBlocks(texts, window = 3, threshold = 0.85) {
  const blocks = [];
  for (let i = 0; i <= texts.length - window; i++) {
    const sims = [];
    for (let j = 0; j < window - 1; j++) {
      sims.push(jaccardSim(texts[i + j], texts[i + j + 1]));
    }
    if (sims.every(s => s >= threshold)) {
      blocks.push({ start: i, end: i + window - 1, avgSim: sims.reduce((a, b) => a + b, 0) / sims.length });
    }
  }
  return blocks;
}

// ── 主分析 ──
function analyze(jsonlPath, wsPath) {
  const records = loadJsonl(jsonlPath);
  const items = extractThinkingAndTools(records);
  const n = items.length;
  if (n === 0) return "未找到任何 thinking 片段。\n";

  const texts = items.map(i => i.thinking);

  // 1. 反转词统计
  const totalCounts = {};
  const perItemCounts = [];
  for (const t of texts) {
    const matches = (t.toLowerCase().match(RE_PATTERN) || []);
    const cnt = {};
    for (const w of matches) { cnt[w] = (cnt[w] || 0) + 1; }
    perItemCounts.push(cnt);
    for (const [w, c] of Object.entries(cnt)) {
      totalCounts[w] = (totalCounts[w] || 0) + c;
    }
  }
  const totalRev = Object.values(totalCounts).reduce((a, b) => a + b, 0);
  const revItemCount = perItemCounts.filter(c => Object.keys(c).length > 0).length;

  // 2. 反转词有效性
  let valid = 0, invalid = 0;
  let prevSigs = null;
  for (let i = 0; i < n; i++) {
    const sigs = items[i].toolCalls.map(tc => [tc.name, tc.input.slice(0, 80)]);
    const hasRev = Object.keys(perItemCounts[i]).length > 0;
    if (!hasRev) { prevSigs = sigs; continue; }
    if (prevSigs !== null) {
      if (JSON.stringify(sigs) !== JSON.stringify(prevSigs)) valid++;
      else invalid++;
    } else valid++;
    prevSigs = sigs;
  }
  const revEffectiveness = (valid + invalid) > 0 ? (valid / (valid + invalid)) * 100 : 100;

  // 3. 重复度
  const sims = [];
  for (let i = 0; i < n - 1; i++) sims.push(jaccardSim(texts[i], texts[i + 1]));
  const meanSim = sims.length > 0 ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
  const maxSim = sims.length > 0 ? Math.max(...sims) : 0;
  const minSim = sims.length > 0 ? Math.min(...sims) : 0;
  const simSorted = [...sims].sort((a, b) => a - b);
  const medianSim = simSorted.length > 0 ? simSorted[Math.floor(simSorted.length / 2)] : 0;
  const highSimCount = sims.filter(s => s > 0.7).length;
  const veryHighSimCount = sims.filter(s => s > 0.85).length;
  const highSimIndices = [];
  for (let i = 0; i < sims.length; i++) {
    if (sims[i] > 0.8) highSimIndices.push(i);
  }

  // 4. 信息增量率
  const igRates = [];
  for (let i = 1; i < n; i++) igRates.push(infoGainRate(texts[i - 1], texts[i]));
  const meanIG = igRates.length > 0 ? igRates.reduce((a, b) => a + b, 0) / igRates.length : 0;
  const igSorted = [...igRates].sort((a, b) => a - b);
  const medianIG = igSorted.length > 0 ? igSorted[Math.floor(igSorted.length / 2)] : 0;
  const lowIG = igRates.filter(r => r < 0.1).length;
  const zeroIG = igRates.filter(r => r === 0).length;
  const highIG = igRates.filter(r => r > 0.5).length;

  // 5. 重复块检测
  const blocks = findRepeatedBlocks(texts, 3, 0.85);
  const looseBlocks = findRepeatedBlocks(texts, 3, 0.75);

  // 6. 统计
  const roleCounts = {};
  for (const obj of records) {
    const t = obj.type || "unknown";
    roleCounts[t] = (roleCounts[t] || 0) + 1;
  }
  const toolNameCounts = {};
  for (const item of items) {
    for (const tc of item.toolCalls) {
      toolNameCounts[tc.name] = (toolNameCounts[tc.name] || 0) + 1;
    }
  }
  const toolRanking = Object.entries(toolNameCounts).sort((a, b) => b[1] - a[1]);

  // 会话时长
  const tsList = items.map(i => i.timestamp).filter(Boolean);
  let durationMin = 0;
  if (tsList.length >= 2) {
    try {
      const t0 = new Date(tsList[0]);
      const t1 = new Date(tsList[tsList.length - 1]);
      durationMin = (t1 - t0) / 60000;
    } catch {}
  }

  // ── 健康度评分 ──
  const scores = {};
  scores.reversal = totalRev / n > 5 ? 80 : totalRev / n > 3 ? 90 : 100;
  if (totalRev > n * 3) scores.reversal -= 15;
  scores.effectiveness = revEffectiveness;
  scores.similarity = maxSim > 0.9 ? 75 : maxSim > 0.85 ? 85 : 100;
  if (highSimCount / (sims.length || 1) * 100 > 10) scores.similarity -= 20;
  else if (highSimCount / (sims.length || 1) * 100 > 5) scores.similarity -= 10;
  scores.infoGain = meanIG < 0.1 ? 65 : meanIG < 0.2 ? 85 : 100;
  if (lowIG / (igRates.length || 1) * 100 > 40) scores.infoGain -= 20;
  else if (lowIG / (igRates.length || 1) * 100 > 20) scores.infoGain -= 10;
  scores.blocks = blocks.length > 3 ? 70 : blocks.length > 1 ? 85 : blocks.length === 1 ? 95 : 100;

  const weights = { reversal: 0.15, effectiveness: 0.15, similarity: 0.25, infoGain: 0.30, blocks: 0.15 };
  const totalScore = Math.max(0, Math.min(100,
    scores.reversal * weights.reversal +
    scores.effectiveness * weights.effectiveness +
    scores.similarity * weights.similarity +
    scores.infoGain * weights.infoGain +
    scores.blocks * weights.blocks
  ));

  // ── 生成报告 ──
  const sessionId = path.basename(jsonlPath, ".jsonl");
  const durationReadable = durationMin > 60 ? `${(durationMin / 60).toFixed(1)} 小时` : `${durationMin.toFixed(0)} 分钟`;

  // 排序反转词
  const sortedWords = Object.entries(totalCounts).sort((a, b) => b[1] - a[1]);

  // 构建各反转词的覆盖条数
  const wordCoverage = {};
  for (const [word] of sortedWords) {
    wordCoverage[word] = perItemCounts.filter(c => word in c).length;
  }

  const lines = [];

  lines.push(`会话: ${sessionId} | 跨度: ${durationMin.toFixed(0)} 分钟（约 ${durationReadable}） | Thinking 片段: ${n} 条`);
  lines.push("");
  lines.push("一、反转词统计");
  lines.push(`总出现 ${totalRev} 次，分布在 ${revItemCount} 条 thinking 中（${(revItemCount/n*100).toFixed(1)}% 含反转词），平均每条 ${(totalRev/n).toFixed(2)} 次。`);
  lines.push("");
  lines.push("排名\t反转词\t出现次数\t覆盖 thinking");
  let rank = 1;
  for (const [word, cnt] of sortedWords.slice(0, 15)) {
    lines.push(`${rank}\t${word}\t${cnt}\t${wordCoverage[word]} 条`);
    rank++;
  }

  lines.push("");
  lines.push("二、反转词有效性");
  lines.push(`反转词出现后工具调用变化率：${revEffectiveness.toFixed(1)}% — ${revEffectiveness >= 60 ? "大部分反转词确实导向了不同的下一步操作，健康。" : "反转词后工具调用变化比例偏低，可能存在无效循环反思。"}`);

  lines.push("");
  lines.push("三、相邻 thinking 重复度");
  lines.push("指标\t值");
  lines.push(`均值\t${meanSim.toFixed(3)}`);
  lines.push(`中位数\t${medianSim.toFixed(3)}`);
  lines.push(`最大值\t${maxSim.toFixed(3)}`);
  lines.push(`>0.7 比例\t${(highSimCount/(sims.length||1)*100).toFixed(1)}%`);
  lines.push(`>0.85 比例\t${(veryHighSimCount/(sims.length||1)*100).toFixed(1)}%`);
  if (highSimIndices.length > 0) {
    const shown = highSimIndices.slice(0, 10);
    lines.push(`高相似度 ${highSimIndices.length} 处（>0.80）${blocks.length === 0 ? "，但 <0.85 严格阈值，不构成死循环。" : ""}`);
    for (const idx of shown) {
      lines.push(`  #${idx} ↔ #${idx+1}: sim=${sims[idx].toFixed(3)}`);
    }
  } else {
    lines.push("无高相似度片段");
  }

  lines.push("");
  lines.push("四、信息增量率");
  lines.push("指标\t值");
  lines.push(`均值\t${meanIG.toFixed(3)}`);
  lines.push(`中位数\t${medianIG.toFixed(3)}`);
  lines.push(`<0.1 比例\t${(lowIG/(igRates.length||1)*100).toFixed(1)}%`);
  lines.push(`=0 比例\t${(zeroIG/(igRates.length||1)*100).toFixed(1)}%`);
  lines.push(`>0.5 比例\t${(highIG/(igRates.length||1)*100).toFixed(1)}%`);
  if (lowIG / (igRates.length || 1) < 0.05) {
    lines.push("极低增量率仅 " + (lowIG/(igRates.length||1)*100).toFixed(1) + "%，说明绝大多数 thinking 有实质新内容。");
  }

  lines.push("");
  lines.push("五、重复代码块检测");
  if (blocks.length === 0) {
    lines.push("未检测到死循环 ✅（窗口=3，阈值=0.85）");
    if (looseBlocks.length > 0) {
      lines.push(`宽松阈值 0.75 下发现 ${looseBlocks.length} 个候选块，但均未达 0.85 警戒线。`);
      for (const b of looseBlocks.slice(0, 5)) {
        lines.push(`  #${b.start} ~ #${b.end} sim=${b.avgSim.toFixed(3)}`);
      }
    }
  } else {
    lines.push(`检测到 ${blocks.length} 个重复块：`);
    for (const b of blocks) {
      lines.push(`  #${b.start} ~ #${b.end} sim=${b.avgSim.toFixed(3)}`);
    }
  }

  lines.push("");
  lines.push("六、综合健康度评分");
  lines.push("维度\t分数\t权重");
  lines.push(`反转词密度\t${Math.round(scores.reversal)}/100\t${(weights.reversal*100).toFixed(0)}%`);
  lines.push(`反转词有效性\t${scores.effectiveness.toFixed(1)}/100\t${(weights.effectiveness*100).toFixed(0)}%`);
  lines.push(`重复度\t${Math.round(scores.similarity)}/100\t${(weights.similarity*100).toFixed(0)}%`);
  lines.push(`信息增量\t${Math.round(scores.infoGain)}/100\t${(weights.infoGain*100).toFixed(0)}%`);
  lines.push(`重复块\t${Math.round(scores.blocks)}/100\t${(weights.blocks*100).toFixed(0)}%`);
  lines.push(`总分: ${totalScore.toFixed(1)}/100 — ${totalScore >= 80 ? "🟢 健康" : totalScore >= 60 ? "🟡 轻度预警" : totalScore >= 40 ? "🟠 中度风险" : "🔴 严重"}`);

  lines.push("");
  if (totalScore >= 80) {
    lines.push("诊断结论：模型思考过程正常，未发现死循环迹象。" + (totalRev / n > 2
      ? "反转词密度虽高但不构成风险，因为信息增量率高、重复度低，说明反转词在正常调试推理中自然产生。"
      : ""));
  } else if (totalScore >= 60) {
    lines.push("诊断结论：存在一定重复或局部循环，建议监控。");
  } else {
    lines.push("诊断结论：出现死循环模式，建议优化提示或重置上下文。");
  }

  return lines.join("\n");
}

// ── CLI 入口 ──
const wsPath = process.argv[2] || "";
const jsonlPath = autoDiscoverSessionFile(wsPath);
if (!jsonlPath || !fs.existsSync(jsonlPath)) {
  console.error("未找到会话 .jsonl 文件");
  process.exit(1);
}

const report = analyze(jsonlPath, wsPath);
console.log(report);
