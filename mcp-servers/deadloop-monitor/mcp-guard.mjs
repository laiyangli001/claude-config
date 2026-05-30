// MCP 安全守卫：检测外部 AI 回复中的恶意注入
// 被 stop-hook 调用，事件驱动，零延迟
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 恶意模式定义 ──
const PATTERNS = {
  // 命令注入：试图通过 shell 执行任意代码
  commandInjection: [
    /\|\s*(bash|sh|zsh|cmd|powershell|pwsh)\b/i,
    /`[^`]*`\s*\|/i,                              // 反引号内容管道
    /\b(curl|wget|fetch)\s+[-a-zA-Z]*\s*h[tt]*ps?:\/\//i,  // 下载远程脚本
    /\b(powershell|pwsh)\s+(-Command|-EncodedCommand|-c)\s+/i,
    /\bInvoke-(Expression|WebRequest|Command)\b/i,
    /\bStart-Process\s+/i,
    /\b(exec|eval)\s*\(/i,
    /\bsystem\s*\(/i,
    /\bchmod\s+\+x\b/i,
  ],

  // 敏感路径/凭证读取
  credentialTheft: [
    /~\/\.ssh\//i,
    /id_rsa/i,
    /\.env\b/i,
    /credentials\.json/i,
    /config\.json.*(?:token|key|secret)/i,
    /etc\/shadow/i,
    /etc\/passwd/i,
    /AppData.*\\\.claude\\settings\.json/i,
    /ANTHROPIC_API_KEY|OPENAI_API_KEY/i,
    /MINERU_API_TOKEN/i,
  ],

  // base64 隐藏载荷（解码+管道到 shell）
  base64Payload: [
    /[\w+/]{100,}[\s]*\|[\s]*(base64|openssl|bash)/i,
    /echo\s+[\w+/]{50,}[\s]*\|[\s]*(base64|openssl)/i,
    /atob\([^)]+\)[\s]*[.]/i,                     // JS base64 decode + method call
  ],

  // 越界指令：试图修改系统配置或权限
  tampering: [
    /CLAUDE\.md/i,
    /settings\.json/i,
    /permissions\.allow/i,
    /permissions\.deny/i,
    /hooks\.Stop/i,
    /sudo\s+.*(?:rm|chmod|chown)\s+/i,
    /reg\s+delete/i,
    /netsh\s+advfirewall/i,
    /Set-(MpPreference|ExecutionPolicy)\b/i,
  ],

  // 典型后门/供应链攻击特征
  backdoor: [
    /npm\s+(install|add)\s+.*?--registry\s+/i,    // 篡改注册表
    /npm\s+(install|add)\s+.*?--index-url/i,      // 篡改 npm 源
    /pip\s+install\s+.*?--index-url/i,             // 篡改 pip 源
    /npm\s+install\s+(?:--save\s+)?[^@\s]+@[^/\s]+\/[^\s]+/i, // 可疑版本号
    /\.\/configure.*--prefix.*\/usr/i,             // 覆盖系统路径
  ],
};

const SEVERITY_LABELS = {
  commandInjection: "严重",
  credentialTheft: "严重",
  base64Payload: "重要",
  tampering: "严重",
  backdoor: "严重",
};

// ── 主检测函数 ──
export function scanResponse(text) {
  if (!text || text.length < 20) return [];

  const alerts = [];

  for (const [category, patterns] of Object.entries(PATTERNS)) {
    for (const regex of patterns) {
      const match = text.match(regex);
      if (match) {
        // 排除匹配在引用块或注释中的情况
        const context = extractContext(text, match.index);
        if (isInQuoteOrComment(context)) continue;

        alerts.push({
          category,
          severity: SEVERITY_LABELS[category] || "一般",
          pattern: regex.source.substring(0, 60),
          matched: match[0].substring(0, 80),
          position: match.index,
          line: (text.substring(0, match.index).match(/\n/g) || []).length + 1,
        });
      }
    }
  }

  return alerts;
}

// ── 提取匹配位置上下文（前 100 字符）──
function extractContext(text, pos) {
  const start = Math.max(0, pos - 100);
  return text.substring(start, pos + 100);
}

// ── 判断是否在引用块或代码注释中 ──
function isInQuoteOrComment(context) {
  // 简单判断：如果前面有 > （markdown 引用）或 //（注释）则跳过
  const lines = context.split("\n");
  const lastLine = lines[lines.length - 1];
  if (/^\s*>\s/.test(lastLine)) return true;         // markdown 引用
  if (/^\s*\/\/\s/.test(lastLine)) return true;      // 单行注释
  return false;
}

// ── 生成告警报告 ──
export function formatAlert(alerts, source) {
  if (alerts.length === 0) return null;

  const lines = [
    `🔴 MCP 安全告警 — ${alerts.length} 项异常（来源: ${source}）`,
    "=".repeat(50),
  ];

  for (const a of alerts) {
    lines.push(`[${a.severity}] ${a.category}`);
    lines.push(`  位置: 第 ${a.line} 行`);
    lines.push(`  匹配: ${a.matched}`);
    lines.push("");
  }

  lines.push("操作: 已自动拦截，请审查后确认是否放行");
  return lines.join("\n");
}

// ── 生成注入摘要（输出到 .jsonl）──
export function logAlert(alerts) {
  const logFile = path.join(__dirname, "deadloop-monitor.jsonl");
  const entry = {
    t: new Date().toISOString(),
    level: "security",
    event: "mcp_guard_alert",
    count: alerts.length,
    alerts: alerts.map(a => ({
      sev: a.severity,
      cat: a.category,
      line: a.line,
    })),
  };
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf-8");
  } catch {}
}
