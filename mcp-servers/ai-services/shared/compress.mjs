/**
 * Headroom 智能压缩
 * 当内容超过阈值时自动压缩大块文本（代码、日志、搜索结果等），
 * 减少发送给外部 AI 的 token。
 *
 * 注意：Headroom 对 JSON 数组（如搜索结果的列表）压缩效果最好（可达 92%），
 * 对连续代码文本的压缩率较低。如果压缩收益 <30%，自动返回原文。
 */
import { execSync } from "child_process";

const THRESHOLD = 3000;
const MIN_RATIO = 0.7;

/**
 * 压缩纯文本内容
 * 超过 THRESHOLD 字符才压缩，收益 <30% 返回原文
 * @param {string} text 原文
 * @returns {string} 压缩后文本或原文
 */
export function compress(text) {
  if (!text || text.length <= THRESHOLD) return text;

  try {
    const result = execSync(
      `python -c "
import sys, json
from headroom.compress import compress as hc
msgs = [{'role': 'user', 'content': sys.stdin.read()}]
r = hc(msgs)
print(r.messages[0]['content'])
"`,
      { input: text, timeout: 15000, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    ).trim();

    // 压缩收益不够或失败时返回原文
    if (!result || result.length > text.length * MIN_RATIO) return text;
    return result;
  } catch (e) {
    console.error("[compress] failed:", e.message);
    return text;
  }
}

export function needsCompress(text) {
  return text && text.length > THRESHOLD;
}
