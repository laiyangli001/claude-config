// 死循环监控系统配置
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {

  // 对话 .jsonl 文件（留空 = 自动扫描发现）
  sessionFile: "",

  // 轮询间隔（毫秒）
  pollInterval: 2000,

  // ── 检测器参数（可被 settings.json 覆盖）──
  detectors: {
    // 信号1: Jaccard 相似度滑动窗口
    jaccard: {
      window: 3,          // 连续窗口大小
      threshold: 0.85,    // 高相似度阈值（对应 --high-sim）
    },

    // 信号2: 反转词密度 + 有效性验证
    reversal: {
      windowChars: 200,
      minCount: 5,
      wordCategories: {
        negation: [
          "不对","错了","不行","无效","失败","没反应","有问题","出错","报错","崩溃",
          "找不到","没有","超时","中断",
          "no","wrong","failed","error","timeout","not working","doesn't work","can't",
        ],
        transition: [
          "但是","不过","然而","可是","却","反倒","反过来","另一方面",
          "换个思路","换个角度","重新","再试试",
          "but","however","although","maybe","perhaps",
          "instead","rather","actually","though","on the other hand",
        ],
        pause: [
          "等等","等一下","让我想想","让我看看","我再想想","我不确定","感觉不对","这不对劲",
          "wait","hold on","let me rethink","let's step back",
        ],
        discovery: [
          "哦","原来如此","我明白了","我懂了","我知道了","原来是这样","其实","实际上",
          "oh","aha","i see","i see now",
        ],
        debugging: [
          "调试","追踪","分析","检查","测试","验证",
          "debug","trace","check","test","verify",
        ],
      },
    },

    // 信号3: n-gram 信息增量率
    infoStall: {
      ngram: 2,               // 对应 --ngram
      lowInfoThreshold: 0.05, // 对应 --low-info
      maxStall: 3,
    },
  },

  // ── 预设方案（完整参数，对应 Python think_health_analyzer.py）──
  presets: {
    default: {
      label: "默认方案",
      jaccardThreshold: 0.85, reversalMinCount: 5, infoNgram: 2, lowInfoThreshold: 0.05, maxStall: 3,
      infoGainThreshold: 0.1, semanticShift: 0.65, scoreHigh: 80, scoreLow: 50, useSemantic: false, verbose: false,
    },
    conservative: {
      label: "保守检测（减少误报，适合生产）",
      jaccardThreshold: 0.88, reversalMinCount: 6, infoNgram: 2, lowInfoThreshold: 0.03, maxStall: 4,
      infoGainThreshold: 0.12, semanticShift: 0.65, scoreHigh: 80, scoreLow: 60, useSemantic: false, verbose: false,
    },
    sensitive: {
      label: "灵敏检测（尽早发现问题，适合调试）",
      jaccardThreshold: 0.80, reversalMinCount: 4, infoNgram: 1, lowInfoThreshold: 0.08, maxStall: 2,
      infoGainThreshold: 0.08, semanticShift: 0.65, scoreHigh: 80, scoreLow: 40, useSemantic: false, verbose: false,
    },
  },

  // 当前选中预设（默认使用 default）
  activePreset: "default",

  // 冷却期（毫秒）
  cooldownMs: 10000,

  // CPU 防护
  maxTokensPerCycle: 10000,

  // 日志
  logFile: path.join(__dirname, "deadloop-monitor.jsonl"),
  logLevel: "info",
};
