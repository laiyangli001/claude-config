#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
混合思考健康检测器（完整版）
支持命令行参数，可自由调节所有关键阈值
功能：分析 Claude 等模型的 thinking 过程，判断是否存在死循环或无效反转
"""

import json
import re
import argparse
import os
from typing import List, Tuple

# ========== 可选语义模型 ==========
try:
    from sentence_transformers import SentenceTransformer, util
    SEMANTIC_AVAILABLE = True
    _semantic_model = SentenceTransformer('all-MiniLM-L6-v2')
except ImportError:
    SEMANTIC_AVAILABLE = False


# ========== 1. 中英文反转词库（扩充版） ==========

REVERSAL_WORDS_CN = {
    "否定/纠错": {
        "不对", "错了", "不行", "无效", "失败", "没反应", "错误", "错误了", "出问题", "有误",
        "不对头", "不对劲", "有问题", "出岔子", "出错", "报错", "崩溃", "卡住", "死机",
        "没动静", "没结果", "空", "无", "缺失", "找不到", "不存在", "没有", "缺少",
        "不好", "差", "糟糕", "无用", "没用", "白费", "误导", "错误率", "误判",
        "瑕疵", "缺陷", "漏洞", "隐患", "故障", "异常", "超时", "中断", "失败率"
    },
    "转折/换思路": {
        "但是", "不过", "然而", "可是", "却", "反倒", "反过来", "另一方面", "换个思路", "换个角度",
        "重新", "再试试", "重新开始", "换一种", "换条路", "换策略", "改用", "试试别的",
        "也许应该", "或许可以", "假设", "如果", "试试看", "改用", "切换到", "回退到",
        "重试", "再试一次", "从头再来", "重置", "重启", "刷新", "重载", "恢复", "重置",
        "重新考虑", "再想想", "后退一步", "换个方向", "另寻", "迂回", "绕道", "变通"
    },
    "停顿/反思": {
        "等等", "等一下", "别急", "慢着", "停", "暂停", "稍等", "且慢",
        "让我想想", "让我看看", "我琢磨一下", "我再想想", "我需要思考", "我不确定",
        "我有点乱", "我搞不懂", "我不明白", "我糊涂了", "我困惑", "我卡住了",
        "感觉不对", "这不对劲", "这有问题", "哪里不对", "有些奇怪", "不太对劲"
    },
    "发现/纠正": {
        "哦", "啊", "哈哈", "原来如此", "我明白了", "我懂了", "我知道了", "我发现了",
        "原来是这样", "这才是原因", "根本问题是", "关键在于", "终于找到", "总算",
        "这下明白了", "原来", "其实", "实际上", "真实情况是", "根源是",
        "怪不得", "难怪", "难怪如此", "原来如此", "原来是这样",
        "找到了", "定位到", "看出来", "意识到", "认识到", "领悟到"
    },
    "调试排查": {
        "调试", "追踪", "打印", "输出", "检查", "验证", "确认", "测试", "尝试",
        "看看", "瞅瞅", "查查", "搜搜", "找找", "分析", "剖析", "研究",
        "排查", "定位", "诊断", "探测", "监控", "观察", "审查", "审视"
    }
}

REVERSAL_WORDS_EN = {
    "negation/correction": {
        "no", "not", "wrong", "incorrect", "failed", "failure", "fails", "invalid",
        "timeout", "error", "exception", "crash", "broken", "stuck", "dead",
        "doesn't work", "does not work", "not working", "no luck", "no response",
        "no output", "empty", "null", "undefined", "nonexistent", "missing",
        "bad", "poor", "ineffective", "useless", "pointless", "misleading",
        "mistake", "flaw", "bug", "issue", "problem", "trouble", "glitch"
    },
    "transition/alternative": {
        "but", "however", "although", "though", "whereas", "instead", "rather",
        "actually", "in fact", "on the other hand", "alternatively",
        "try a different", "try another", "different approach", "different way",
        "change strategy", "switch to", "fallback to", "use instead",
        "maybe we should", "perhaps we can", "what if", "suppose", "let's try",
        "let's use", "let's switch", "reconsider", "rethink", "think again",
        "step back", "back up", "start over", "from scratch", "reset",
        "refresh", "reload", "restart", "reinit", "retry", "try again"
    },
    "pause/rethink": {
        "wait", "hold on", "stop", "pause", "hang on", "one moment",
        "let me think", "let me see", "let me check", "let me verify",
        "i need to think", "i should reconsider", "i'm not sure",
        "i don't know", "i'm stuck", "i'm confused", "i'm lost",
        "something's off", "this feels wrong", "this doesn't feel right"
    },
    "discovery": {
        "oh", "aha", "i see", "i realize", "i notice", "i found", "i discovered",
        "it turns out", "actually it's", "the real issue is", "the root cause is",
        "now i understand", "now i get it", "that explains it", "that's why",
        "so that's the problem", "there we go", "finally", "at last",
        "got it", "found it", "located", "identified"
    },
    "debugging": {
        "debug", "trace", "log", "print", "inspect", "examine", "analyze",
        "check if", "verify that", "test whether", "try to see", "see if",
        "look at", "look for", "search for", "find out", "figure out",
        "investigate", "dig into", "peek at", "dump", "sniff", "monitor"
    }
}

# 合并所有反转词
ALL_REVERSAL_WORDS = set()
for cat in REVERSAL_WORDS_CN.values():
    ALL_REVERSAL_WORDS.update(cat)
for cat in REVERSAL_WORDS_EN.values():
    ALL_REVERSAL_WORDS.update(cat)

# 构建正则表达式（中文直接拼接，英文加 \b 边界）
cn_words = [w for w in ALL_REVERSAL_WORDS if any('一' <= c <= '鿿' for c in w)]
en_words = [w for w in ALL_REVERSAL_WORDS if not any('一' <= c <= '鿿' for c in w)]

cn_pattern = '|'.join(re.escape(w) for w in cn_words) if cn_words else ''
en_pattern = r'\b(?:' + '|'.join(re.escape(w) for w in en_words) + r')\b' if en_words else ''

if cn_pattern and en_pattern:
    REVERSAL_PATTERN = re.compile(f'({cn_pattern})|({en_pattern})', re.IGNORECASE)
elif cn_pattern:
    REVERSAL_PATTERN = re.compile(cn_pattern, re.IGNORECASE)
elif en_pattern:
    REVERSAL_PATTERN = re.compile(en_pattern, re.IGNORECASE)
else:
    REVERSAL_PATTERN = re.compile(r'(?!)')


def has_reversal_keywords(text: str) -> bool:
    return bool(REVERSAL_PATTERN.search(text))


# ========== 2. 否定前文句式模式 ==========
NEGATION_PATTERNS = [
    r'(不|没|无)\w*\s*(对|行|是|对头|有效|反应)',
    r'错误\s*[:：]',
    r'失败\s*[:：]',
    r'无法\s*(连接|访问|登录|执行)',
    r'尝试\s*(失败|无效)',
    r'看来\s*(不对|不行|行不通)',
    r'这个\s*(方法|思路|做法)\s*行不通',
    r'等等[，,]\s*我\s*(发现|注意到)',
    r'\b(not|no)\s+\w+\s*(work|connect|find|exist|valid|correct)',
    r'\b(doesn\'t|does not|don\'t|do not)\s+(work|match|exist|connect|help)',
    r'\b(failed|failure|fails)\s*',
    r'\b(error|exception|timeout|crash)\s*[:.]',
    r'\b(invalid|incorrect|wrong)\s+\w+',
    r'\b(can\'t|cannot)\s+(connect|access|login|execute)',
    r'\b(unable to)\s+\w+',
    r'\b(try again|retry|reinit|reset|reload)',
    r'\b(let me|let\'s)\s+(rethink|reconsider|step back|try a different)',
    r'\b(wait|hold on|stop|pause)\s*[,.]',
    r'\b(actually|however|but|though)\s+\w+',
    r'\b(not working|doesn\'t help|no luck)',
    r'\b(i see|i realize|found that|notice that)',
]
COMPILED_NEGATION_PATTERNS = [re.compile(p, re.IGNORECASE) for p in NEGATION_PATTERNS]

def has_negation_pattern(text: str) -> bool:
    for pat in COMPILED_NEGATION_PATTERNS:
        if pat.search(text):
            return True
    return False

def has_language_reversal(prev: str, curr: str) -> bool:
    curr_has = has_reversal_keywords(curr) or has_negation_pattern(curr)
    return curr_has and prev != curr


# ========== 3. 信息增量率（支持可变 n-gram） ==========
def get_ngrams(text: str, n: int):
    if len(text) < n:
        return set()
    return set(text[i:i+n] for i in range(len(text)-n+1))

def information_gain_rate(prev: str, curr: str, n: int) -> float:
    prev_ngrams = get_ngrams(prev, n) if prev else set()
    curr_ngrams = get_ngrams(curr, n)
    if not curr_ngrams:
        return 0.0
    new_ngrams = curr_ngrams - prev_ngrams
    return len(new_ngrams) / len(curr_ngrams)


# ========== 4. 语义相似度（可选） ==========
def semantic_similarity(text1: str, text2: str, use_semantic: bool) -> float:
    if use_semantic and SEMANTIC_AVAILABLE:
        emb1 = _semantic_model.encode(text1, convert_to_tensor=True)
        emb2 = _semantic_model.encode(text2, convert_to_tensor=True)
        return util.cos_sim(emb1, emb2).item()
    else:
        set1 = set(text1)
        set2 = set(text2)
        if not set1 or not set2:
            return 0.0
        return len(set1 & set2) / len(set1 | set2)


# ========== 5. 工具调用变化检测 ==========
def has_tool_change(prev_tools: List[Tuple[str, str]], curr_tools: List[Tuple[str, str]]) -> bool:
    return sorted(prev_tools) != sorted(curr_tools)


# ========== 6. 综合判断：有效反转 ==========
def is_effective_reversal(
    prev_text: str, curr_text: str,
    prev_tools: List[Tuple[str, str]], curr_tools: List[Tuple[str, str]],
    info_gain_threshold: float, semantic_shift_threshold: float,
    use_semantic: bool, ngram: int
) -> Tuple[bool, dict]:
    metrics = {
        "has_language_reversal": has_language_reversal(prev_text, curr_text),
        "info_gain_rate": information_gain_rate(prev_text, curr_text, ngram),
        "tool_change": has_tool_change(prev_tools, curr_tools),
        "semantic_similarity": semantic_similarity(prev_text, curr_text, use_semantic),
    }
    if not metrics["has_language_reversal"]:
        return False, metrics
    effective = (
        metrics["info_gain_rate"] > info_gain_threshold or
        metrics["tool_change"] or
        metrics["semantic_similarity"] < semantic_shift_threshold
    )
    return effective, metrics


# ========== 7. 从 JSONL 提取 thinking 和 tools ==========
def extract_thinking_and_tools(jsonl_path: str):
    thinking_list = []
    tools_list = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                obj = json.loads(line)
                if obj.get('type') == 'assistant':
                    thinking = ""
                    tools = []
                    for part in obj.get('message', {}).get('content', []):
                        if part.get('type') == 'thinking':
                            thinking = part.get('thinking', '')
                        elif part.get('type') == 'tool_use':
                            tools.append((part.get('name'), str(part.get('input'))))
                    if thinking:
                        thinking_list.append(thinking)
                        tools_list.append(tools)
            except Exception:
                continue
    return thinking_list, tools_list


# ========== 8. 序列分析 ==========
def analyze_sequence(
    texts, tools_seq,
    info_gain_threshold, semantic_shift_threshold,
    high_sim_threshold, low_info_threshold,
    use_semantic, ngram
) -> dict:
    if len(texts) < 2:
        return {"error": "至少需要两个 thinking 片段"}

    reversal_count = 0
    effective_count = 0
    high_similarity_loop = 0
    step_results = []

    for i in range(1, len(texts)):
        effective, metrics = is_effective_reversal(
            texts[i-1], texts[i],
            tools_seq[i-1], tools_seq[i],
            info_gain_threshold, semantic_shift_threshold,
            use_semantic, ngram
        )
        step_results.append({
            "step": i,
            "effective": effective,
            "metrics": metrics
        })
        if metrics["has_language_reversal"]:
            reversal_count += 1
            if effective:
                effective_count += 1
        if (metrics["semantic_similarity"] > high_sim_threshold and
            metrics["info_gain_rate"] < low_info_threshold and
            not metrics["tool_change"]):
            high_similarity_loop += 1

    return {
        "total_thinking_steps": len(texts),
        "reversal_steps": reversal_count,
        "effective_reversals": effective_count,
        "ineffective_reversals": reversal_count - effective_count,
        "effectiveness_rate": effective_count / reversal_count if reversal_count > 0 else 1.0,
        "loop_risk_count": high_similarity_loop,
        "step_details": step_results,
        "texts": texts,
    }


# ========== 9. 自动发现 JSONL ==========
def auto_discover_session_file(ws_path: str) -> str:
    if not ws_path:
        return ""
    slug = ws_path.replace(":", "-").replace("\\", "-").replace("/", "-").replace(".", "-").lower()
    session_dir = os.path.join(os.environ.get("USERPROFILE", os.environ.get("HOME", "")),
                               ".claude", "projects", slug)
    if os.path.isdir(session_dir):
        jsonl_files = [f for f in os.listdir(session_dir) if f.endswith(".jsonl")]
        if jsonl_files:
            jsonl_files.sort(key=lambda f: os.path.getmtime(os.path.join(session_dir, f)), reverse=True)
            return os.path.join(session_dir, jsonl_files[0])
    return ""


# ========== 10. 主函数 ==========
def main():
    parser = argparse.ArgumentParser(description="混合思考健康检测器")
    parser.add_argument("-f", "--file", default="", help="JSONL 文件路径（留空则自动发现）")
    parser.add_argument("--ws", default="", help="工作区路径（用于自动发现 JSONL）")
    parser.add_argument("--info-gain", type=float, default=0.1, help="信息增量阈值 (默认 0.1)")
    parser.add_argument("--semantic-shift", type=float, default=0.65, help="语义转变阈值 (默认 0.65)")
    parser.add_argument("--high-sim", type=float, default=0.85, help="高相似度阈值 (默认 0.85)")
    parser.add_argument("--low-info", type=float, default=0.05, help="低信息增量阈值 (默认 0.05)")
    parser.add_argument("--score-high", type=float, default=80, help="健康高分阈值 (默认 80)")
    parser.add_argument("--score-low", type=float, default=50, help="健康低分阈值 (默认 50)")
    parser.add_argument("--no-semantic", action="store_true", help="强制禁用语义模型")
    parser.add_argument("--ngram", type=int, default=2, choices=range(1, 6), help="n-gram 长度 (默认 2)")
    parser.add_argument("-v", "--verbose", action="store_true", help="输出详细步骤")
    args = parser.parse_args()

    # 自动发现
    jsonl_path = args.file
    if not jsonl_path:
        jsonl_path = auto_discover_session_file(args.ws)
    if not jsonl_path or not os.path.exists(jsonl_path):
        print("未找到会话 .jsonl 文件")
        return

    use_semantic = SEMANTIC_AVAILABLE and not args.no_semantic
    if not SEMANTIC_AVAILABLE and not args.no_semantic:
        print("⚠️ sentence-transformers 未安装，将使用 Jaccard 相似度。")
        print("   如需更准确语义检测，请运行: pip install sentence-transformers\n")

    print(f"正在读取文件: {jsonl_path}")
    thinking_list, tools_list = extract_thinking_and_tools(jsonl_path)
    print(f"读取到 {len(thinking_list)} 条 thinking 片段")
    print(f"使用 n-gram 长度: {args.ngram}\n")

    if len(thinking_list) < 2:
        print("错误：thinking 片段不足 2 条，无法分析。")
        return

    stats = analyze_sequence(
        thinking_list, tools_list,
        info_gain_threshold=args.info_gain,
        semantic_shift_threshold=args.semantic_shift,
        high_sim_threshold=args.high_sim,
        low_info_threshold=args.low_info,
        use_semantic=use_semantic,
        ngram=args.ngram
    )

    print("=" * 50)
    print("健康检测报告")
    print("=" * 50)
    print(f"总 thinking 步数:        {stats['total_thinking_steps']}")
    print(f"语言反转步数:            {stats['reversal_steps']}")
    print(f"有效反转步数:            {stats['effective_reversals']}")
    print(f"无效反转步数:            {stats['ineffective_reversals']}")
    print(f"反转有效率:              {stats['effectiveness_rate']:.2%}")
    print(f"高相似度重复空转次数:    {stats['loop_risk_count']}")
    print()

    score = 100
    if stats['effectiveness_rate'] < 0.5:
        score -= 30
    elif stats['effectiveness_rate'] < 0.7:
        score -= 15
    if stats['loop_risk_count'] > 3:
        score -= 25
    elif stats['loop_risk_count'] > 1:
        score -= 10
    score = max(0, min(100, score))
    print(f"健康度综合评分: {score:.0f}/100")

    if score >= args.score_high:
        print("✅ 结论：思考过程健康，未发现死循环。")
    elif score >= args.score_low:
        print("⚠️ 结论：存在一定重复或局部循环，建议优化提示或重置上下文。")
    else:
        print("❌ 结论：高度疑似死循环，请立即手动中断并检查提示词或代码逻辑。")

    if args.verbose and stats['ineffective_reversals'] > 0:
        print("\n无效反转详情（步数从 1 开始）：")
        count = 0
        for step_info in stats['step_details']:
            if not step_info['effective'] and step_info['metrics']['has_language_reversal']:
                idx = step_info['step']
                preview = stats['texts'][idx][:100].replace("\n", " ")
                print(f"  步 {idx}: 增率={step_info['metrics']['info_gain_rate']:.3f}, "
                      f"相似={step_info['metrics']['semantic_similarity']:.3f}, "
                      f"工具变={step_info['metrics']['tool_change']}")
                print(f"    内容: {preview}...")
                count += 1
                if count >= 10:
                    print("  ... (更多未显示)")
                    break


if __name__ == "__main__":
    main()
