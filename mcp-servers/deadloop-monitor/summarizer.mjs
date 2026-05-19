/**
 * 基于 .jsonl 对话窗口构建求助摘要。
 * 输入：DialogWindow 中的消息数组，每条 { role, content }
 * 输出：格式化后的摘要文本
 */
export function buildSummary(dialogMessages, loopSample) {
  const now = new Date().toISOString();

  // 循环表现描述
  const loopDesc = describeLoop(loopSample);

  // 提取代码文件路径
  const allText = dialogMessages.map(m => m.content).join("\n");
  const fileRegex = /([\w\-./]+\.(?:py|js|ts|jsx|tsx|go|rs|java|c|cpp|h|css|html|json|yaml|yml|toml))(?::\d+)?/g;
  const filePaths = [...new Set([...allText.matchAll(fileRegex)].map(m => m[1]))].slice(0, 5);

  // 构建摘要
  let s = "【死循环检测报告】\n";
  s += `检测时间: ${now}\n`;
  s += `触发信号: 重复代码 + 逻辑反转 + 信息增量（其中至少两个）\n`;
  s += `循环表现: ${loopDesc}\n`;
  if (filePaths.length > 0) s += `涉及文件: ${filePaths.join(", ")}\n`;

  s += "\n【最近对话】\n";
  let round = 0;
  for (const msg of dialogMessages) {
    const prefix = msg.role === "user" ? "用户" : "AI";
    const truncated = msg.content.length > 500
      ? msg.content.slice(0, 500) + "…（省略）"
      : msg.content;
    s += `--- ${prefix} ---\n${truncated}\n\n`;
  }

  s += "【循环样本】\n";
  s += (loopSample || "无").slice(0, 1000) + "\n\n";
  s += "请分析上述对话是否陷入死循环，并给出跳出循环的具体建议。";

  return s;
}

function describeLoop(sample) {
  if (!sample) return "未检测到循环样本";
  const lines = sample.split("\n").map(l => l.trim()).filter(Boolean);
  const counts = {};
  for (const line of lines) counts[line] = (counts[line] || 0) + 1;
  const maxRepeat = Math.max(...Object.values(counts), 1);
  if (maxRepeat >= 4) return `同一文本重复 ${maxRepeat} 次`;
  return "输出反复摇摆，无明显新信息";
}
