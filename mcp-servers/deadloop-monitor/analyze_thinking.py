#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Claude Code JSONL 会话分析脚本 - 适配 Claude Code JSONL 格式"""

import json
import re
import sys
from collections import Counter
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ========== 配置 ==========
JSONL_FILE = r"c:\Users\LaiYangLi\.claude\projects\c--Users-LaiYangLi--claude\d6ab17f0-b242-461f-83ef-2ae163d79668.jsonl"

# 反转词定义（与 deadloop-monitor config.mjs 一致）
REVERSAL_WORDS = set([
    # 中文
    "不对","不过","然而","可能","但是","虽然","尽管","也许","或许",
    "可是","却","反倒","反过来","另一方面",
    # 英文
    "but","however","although","maybe","perhaps",
    "instead","rather","actually","though",
    "on the other hand","wait","hold on",
    "let me rethink","actually","no","wrong",
])
REVERSAL_PATTERN = re.compile(
    r'|'.join(r'\b' + re.escape(w) + r'\b' if w.isascii() else re.escape(w)
              for w in REVERSAL_WORDS),
    re.IGNORECASE
)


def load_jsonl(path):
    """加载 JSONL 文件"""
    records = []
    with open(path, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append((i, json.loads(line)))
            except json.JSONDecodeError as e:
                print(f"  ⚠️  第 {i} 行 JSON 解析失败: {e}", file=sys.stderr)
    return records


def extract_thinking_and_tools(records):
    """
    从 Claude Code JSONL 提取 thinking 和对应的工具调用。
    Claude Code 格式：thinking 和 tool_use 分属不同 assistant 消息，
    tool_use 消息紧随 thinking 消息之后，且 parentUuid 指向 thinking 消息的 uuid。
    """
    items = []
    # 顺序遍历，用 i+1 找后继消息
    for i, (line_no, obj) in enumerate(records):
        if obj.get('type') != 'assistant':
            continue
        content = obj.get('message', {}).get('content', [])
        thinking_text = None
        for part in content:
            if part.get('type') == 'thinking':
                thinking_text = part.get('thinking', '')
                break
        if not thinking_text:
            continue

        uid = obj.get('uuid', '')
        ts = obj.get('timestamp', '')

        # 查找后继消息：同为 assistant 且 parentUuid == uid
        tool_calls = []
        if i + 1 < len(records):
            next_obj = records[i + 1][1]
            if (next_obj.get('type') == 'assistant'
                    and next_obj.get('parentUuid') == uid):
                next_content = next_obj.get('message', {}).get('content', [])
                for part in next_content:
                    if part.get('type') == 'tool_use':
                        tool_calls.append({
                            'name': part.get('name', ''),
                            'input': str(part.get('input', {})),
                        })

        items.append({
            'line': line_no,
            'timestamp': ts,
            'thinking': thinking_text,
            'tool_calls': tool_calls,
        })

    return items


# ========== Jaccard 相似度（字级） ==========
def jaccard_sim(s1, s2):
    set1 = set(s1)
    set2 = set(s2)
    if not set1 or not set2:
        return 0.0
    return len(set1 & set2) / len(set1 | set2)


# ========== 信息增量率（基于结巴分词词集） ==========
def information_gain_rate(prev_text, curr_text):
    try:
        import jieba
        prev_words = set(jieba.lcut(prev_text))
        curr_words = set(jieba.lcut(curr_text))
    except ImportError:
        # fallback: 按字符 unigram 计算
        prev_words = set(prev_text)
        curr_words = set(curr_text)
    if not curr_words:
        return 0.0
    new_words = curr_words - prev_words
    return len(new_words) / len(curr_words)


# ========== 重复代码块检测 ==========
def find_repeated_blocks(texts, window=3, threshold=0.85):
    repeated = []
    for i in range(len(texts) - window + 1):
        block = texts[i:i + window]
        sims = [jaccard_sim(block[j], block[j + 1]) for j in range(window - 1)]
        if all(s >= threshold for s in sims):
            repeated.append((i, i + window - 1, float(np.mean(sims))))
    return repeated


def main():
    print("=" * 60)
    print("  Claude Code 思考过程健康度分析报告")
    print("=" * 60)
    print()

    # 1. 加载
    print("[加载 JSONL...]")
    records = load_jsonl(JSONL_FILE)
    total_lines = len(records)
    print(f"  总记录数: {total_lines} 行")

    # 2. 提取 thinking
    items = extract_thinking_and_tools(records)
    n = len(items)
    print(f"  提取 thinking 片段: {n} 条")
    if n == 0:
        print("\n❌ 未找到任何 thinking 片段。")
        return
    print()

    texts = [item['thinking'] for item in items]
    timestamps = [item['timestamp'] for item in items]
    tool_calls_list = [item['tool_calls'] for item in items]

    # ===== 1. 反转词统计 =====
    print("─" * 50)
    print("📊 一、反转词统计")
    print("─" * 50)

    # 每条 thinking 的反转词
    per_item_counts = []
    total_all_counts = Counter()
    for t in texts:
        words = REVERSAL_PATTERN.findall(t.lower())
        c = Counter(words)
        per_item_counts.append(c)
        total_all_counts.update(c)

    total_rev = sum(total_all_counts.values())
    print(f"\n  总反转词出现次数: {total_rev}")
    print(f"  出现反转词的 thinking 条数: {sum(1 for c in per_item_counts if c)} / {n} ({sum(1 for c in per_item_counts if c)/n*100:.1f}%)")
    print(f"  平均每条 thinking 反转词数: {total_rev/n:.2f}")
    print(f"\n  反转词频率 TOP15:")
    for word, cnt in total_all_counts.most_common(15):
        print(f"    {word}: {cnt} 次 (出现在 {sum(1 for c in per_item_counts if word in c)} 条 thinking 中)")

    # 健康度评分 - 反转词子项
    rev_density = total_rev / n
    rev_health = 100
    if rev_density > 5:
        rev_health -= 20
    elif rev_density > 3:
        rev_health -= 10
    if total_rev > n * 3:
        rev_health -= 15

    # ===== 2. 反转词有效性比例 =====
    print("\n" + "─" * 50)
    print("📊 二、反转词有效性分析")
    print("─" * 50)

    valid_count = 0
    invalid_count = 0
    prev_tool_sigs = None
    for i, item in enumerate(items):
        current_tool_sigs = [(tc['name'], tc['input'][:80]) for tc in item['tool_calls']]
        has_reversal = bool(per_item_counts[i])
        if not has_reversal:
            prev_tool_sigs = current_tool_sigs
            continue
        if prev_tool_sigs is not None:
            # 有效: 反转后工具调用签名（名称+输入前缀）发生变化
            if current_tool_sigs != prev_tool_sigs:
                valid_count += 1
            else:
                invalid_count += 1
        else:
            valid_count += 1
        prev_tool_sigs = current_tool_sigs

    total_rev_items = valid_count + invalid_count
    if total_rev_items > 0:
        validity_rate = valid_count / total_rev_items * 100
        print(f"\n  反转词出现后工具调用发生变化: {valid_count} 次 ({validity_rate:.1f}%)")
        print(f"  反转词出现后工具调用未变化: {invalid_count} 次 ({100 - validity_rate:.1f}%)")
        rev_effectiveness = validity_rate
    else:
        print("\n  无反转词出现")
        rev_effectiveness = 100

    # ===== 3. 重复度曲线 (Jaccard) =====
    print("\n" + "─" * 50)
    print("📊 三、相邻 thinking 重复度曲线")
    print("─" * 50)

    similarities = []
    for i in range(n - 1):
        sim = jaccard_sim(texts[i], texts[i + 1])
        similarities.append(sim)

    if similarities:
        mean_sim = np.mean(similarities)
        max_sim = max(similarities)
        high_ratio = sum(1 for s in similarities if s > 0.7) / len(similarities) * 100
        print(f"\n  均值: {mean_sim:.3f}")
        print(f"  中位数: {np.median(similarities):.3f}")
        print(f"  最大值: {max_sim:.3f}")
        print(f"  最小值: {min(similarities):.3f}")
        print(f"  超过 0.7 的比例: {high_ratio:.1f}%")
        print(f"  超过 0.85 的比例: {sum(1 for s in similarities if s > 0.85) / len(similarities) * 100:.1f}%")

        # 输出高相似度片段
        high_sim_indices = [i for i, s in enumerate(similarities) if s > 0.8]
        if high_sim_indices:
            print(f"\n  高相似度片段 (>0.80, 共 {len(high_sim_indices)} 处):")
            for idx in high_sim_indices[:10]:  # 最多显示 10 处
                print(f"    #{idx} ↔ #{idx+1}: sim={similarities[idx]:.3f}")
    else:
        mean_sim = 0
        max_sim = 0
        high_ratio = 0

    # 重复度健康度子项
    sim_health = 100
    if max_sim > 0.9:
        sim_health -= 25
    elif max_sim > 0.85:
        sim_health -= 15
    if high_ratio > 10:
        sim_health -= 20
    elif high_ratio > 5:
        sim_health -= 10

    # ===== 4. 信息增量率 =====
    print("\n" + "─" * 50)
    print("📊 四、信息增量率分析")
    print("─" * 50)

    ig_rates = []
    for i in range(1, n):
        ig = information_gain_rate(texts[i - 1], texts[i])
        ig_rates.append(ig)

    if ig_rates:
        mean_ig = np.mean(ig_rates)
        low_ig_ratio = sum(1 for ig in ig_rates if ig < 0.1) / len(ig_rates) * 100
        zero_ig_ratio = sum(1 for ig in ig_rates if ig == 0) / len(ig_rates) * 100
        print(f"\n  平均信息增量率: {mean_ig:.3f}")
        print(f"  中位数: {np.median(ig_rates):.3f}")
        print(f"  增量率低于 0.1 的比例: {low_ig_ratio:.1f}%")
        print(f"  增量率为 0 的比例: {zero_ig_ratio:.1f}%")
        print(f"  增量率高于 0.5 的比例: {sum(1 for ig in ig_rates if ig > 0.5) / len(ig_rates) * 100:.1f}%")
    else:
        mean_ig = 0
        low_ig_ratio = 0
        zero_ig_ratio = 0

    # 信息增量健康度子项
    ig_health = 100
    if mean_ig < 0.1:
        ig_health -= 35
    elif mean_ig < 0.2:
        ig_health -= 15
    if low_ig_ratio > 40:
        ig_health -= 20
    elif low_ig_ratio > 20:
        ig_health -= 10

    # ===== 5. 重复代码块检测 =====
    print("\n" + "─" * 50)
    print("📊 五、重复代码块检测")
    print("─" * 50)

    repeated_blocks = find_repeated_blocks(texts, window=3, threshold=0.85)
    if repeated_blocks:
        print(f"\n  检测到 {len(repeated_blocks)} 个高度重复的连续 thinking 块 (窗口=3, 阈值=0.85):")
        for start, end, sim in repeated_blocks:
            print(f"    索引 #{start} ~ #{end}, 平均相似度 {sim:.3f}")
            # 显示预览
            preview = texts[start][:80] + "..." if len(texts[start]) > 80 else texts[start]
            print(f"    内容: {preview}")
    else:
        print(f"\n  未检测到高度重复的连续 thinking 块 ✅")
    # 用更宽松的阈值再查一次
    repeated_blocks_loose = find_repeated_blocks(texts, window=3, threshold=0.75)
    if repeated_blocks_loose and not repeated_blocks:
        print(f"  (宽松阈值 0.75 下发现 {len(repeated_blocks_loose)} 个候选块，接近但未达 0.85 阈值)")
        for start, end, sim in repeated_blocks_loose[:5]:
            print(f"    索引 #{start} ~ #{end}, sim={sim:.3f}")

    block_health = 100
    if len(repeated_blocks) > 3:
        block_health -= 30
    elif len(repeated_blocks) > 1:
        block_health -= 15
    elif len(repeated_blocks) == 1:
        block_health -= 5

    # ===== 6. 综合健康度评分 =====
    print("\n" + "═" * 50)
    print("🏥 六、综合健康度评分")
    print("═" * 50)

    # 加权计算
    weights = {
        'reversal': 0.15,
        'effectiveness': 0.15,
        'similarity': 0.25,
        'info_gain': 0.30,
        'blocks': 0.15,
    }
    health_score = (
        rev_health * weights['reversal'] +
        rev_effectiveness * weights['effectiveness'] +
        sim_health * weights['similarity'] +
        ig_health * weights['info_gain'] +
        block_health * weights['blocks']
    )
    health_score = max(0, min(100, health_score))

    print(f"\n  反转词密度健康度: {rev_health:.0f}/100 (权重 {weights['reversal']:.0%})")
    print(f"  反转词有效性健康度: {rev_effectiveness:.1f}/100 (权重 {weights['effectiveness']:.0%})")
    print(f"  重复度健康度: {sim_health:.0f}/100 (权重 {weights['similarity']:.0%})")
    print(f"  信息增量健康度: {ig_health:.0f}/100 (权重 {weights['info_gain']:.0%})")
    print(f"  重复块健康度: {block_health:.0f}/100 (权重 {weights['blocks']:.0%})")
    print(f"\n  ▶ 综合健康度评分: {health_score:.1f}/100")

    if health_score >= 80:
        print("  ▶ 诊断: 🟢 健康 — 模型思考过程正常，未发现死循环迹象")
    elif health_score >= 60:
        print("  ▶ 诊断: 🟡 轻度预警 — 存在一定重复或局部循环，建议监控")
    elif health_score >= 40:
        print("  ▶ 诊断: 🟠 中度风险 — 出现死循环模式，建议优化提示或重置上下文")
    else:
        print("  ▶ 诊断: 🔴 严重 — 高度疑似死循环，建议立即手动中断并检查")

    # ===== 7. 额外统计 =====
    print("\n" + "═" * 50)
    print("📋 七、会话概览")
    print("═" * 50)

    # 按角色统计
    role_counts = Counter()
    for _, obj in records:
        r = obj.get('type', 'unknown')
        role_counts[r] += 1

    print(f"\n  用户消息: {role_counts.get('user', 0)}")
    print(f"  助手消息: {role_counts.get('assistant', 0)}")
    print(f"  Thinking 片段: {n}")
    print(f"  总行数: {total_lines}")

    # 工具调用分布
    tool_name_counts = Counter()
    for item in items:
        for tc in item['tool_calls']:
            tool_name_counts[tc['name']] += 1

    if tool_name_counts:
        print(f"\n  工具调用分布:")
        for name, cnt in tool_name_counts.most_common():
            print(f"    {name}: {cnt} 次")

    # 会话时长
    timestamps_filtered = [ts for ts in timestamps if ts]
    if len(timestamps_filtered) >= 2:
        from datetime import datetime
        try:
            t0 = datetime.fromisoformat(timestamps_filtered[0].replace('Z', '+00:00'))
            t1 = datetime.fromisoformat(timestamps_filtered[-1].replace('Z', '+00:00'))
            # fixed: use fromisoformat
            t0 = datetime.fromisoformat(timestamps_filtered[0].replace('Z', '+00:00'))
            t1 = datetime.fromisoformat(timestamps_filtered[-1].replace('Z', '+00:00'))
            duration = (t1 - t0).total_seconds()
            print(f"\n  会话跨度: {duration / 60:.1f} 分钟")
        except Exception:
            pass

    print()
    print("=" * 60)


if __name__ == "__main__":
    main()
