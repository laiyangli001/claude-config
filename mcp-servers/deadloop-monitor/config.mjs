// 死循环监控系统配置
export default {

  // 对话 .jsonl 文件（留空 = 自动扫描发现）
  sessionFile: "",

  // 轮询间隔（毫秒）
  pollInterval: 2000,

  // 信号1: 重复代码块检测
  repeat: {
    windowTokens: 500,
    maxHits: 1,
  },

  // 信号2: 逻辑反转词检测（绝对计数）
  reversal: {
    windowTokens: 200,
    minCount: 5,
    words: [
      // 中文反转词
      "不对","不过","然而","可能","但是",
      "虽然","尽管","也许","或许",
      "可是","却","反倒","反过来","另一方面",
      // 英文反转词
      "but","however","although","maybe","perhaps",
      "instead","rather","actually","though",
      "on the other hand","wait","hold on",
      "let me rethink","actually","no","wrong",
    ],
  },

  // 信号3: 信息增量率
  infoStall: {
    windowTokens: 200,
    maxStallCount: 2,
  },

  // 冷却期（毫秒）
  cooldownMs: 10000,

  // CPU 防护
  maxTokensPerCycle: 10000,

  // 日志
  logFile: "deadloop-monitor.jsonl",
  logLevel: "info",
};
