// 死循环监控系统配置
export default {

  // 对话 .jsonl 文件（留空则自动扫描发现）
  sessionFile: "",

  // 求助 MCP 服务配置
  helpMcp: {
    command: "node",
    args: ["c:/Users/LaiYangLi/.claude/mcp-servers/chatgpt-mirror-mcp/dist/index.js"],
    toolName: "ask_chatgpt_mirror",
    requestTimeoutMs: 300000,  // MCP 请求超时（5分钟）
  },

  // 轮询间隔（毫秒）
  pollInterval: 2000,

  // 信号1: 重复代码块检测
  repeat: {
    windowTokens: 200,
    maxHits: 2,
  },

  // 信号2: 逻辑反转词密度（绝对计数）
  reversal: {
    windowTokens: 200,
    minCount: 8,
    words: [
      "不对","不过","然而","可能","但是",
      "虽然","尽管","也许","或许",
      "可是","却","反倒","反过来","另一方面",
    ],
  },

  // 信号3: 信息增量率
  infoStall: {
    windowTokens: 200,
    maxStallCount: 2,
  },

  // 冷却期（毫秒）—— 求助后不立即重复触发
  cooldownMs: 10000,

  // CPU 防护：单次最大处理 token
  maxTokensPerCycle: 10000,

  // 建议文件
  adviceFile: ".deadloop_advice.md",

  // 日志
  logFile: "deadloop-monitor.jsonl",
  logLevel: "info",
};
