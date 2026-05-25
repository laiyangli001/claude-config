#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
参数配置 GUI — 基于 Flet 框架

自动读取 package.json，根据字段类型动态生成编辑控件。
支持 str/int/float/bool/list/dict，可递归嵌套。
进程管理：运行命令、长按 ESC 停止、状态监控。

依赖安装:
    pip install flet pynput

运行:
    python config_gui.py
"""

import os
import sys
import json
import asyncio
import subprocess
import threading
import time
import platform
from datetime import datetime

import flet as ft
from pynput import keyboard

# ── 常量 ──
CONFIG_FILE = "package.json"
DEFAULT_CONFIG = {
    "name": "my_app",
    "version": "1.0",
    "debug": False,
    "threads": 4,
    "output_dir": "./output",
    "command": 'python -c "import time; time.sleep(3600)"',
    "advanced": {
        "max_retries": 3,
        "timeout": 30.5,
        "log_level": "info",
    },
}
OS_NAME = platform.system()

# ── GUI 显示过滤（不展示在 Tab 中的 package.json 一级 key）──
GUI_HIDDEN_KEYS = {"name", "version", "description", "author", "license",
                   "main", "scripts", "private", "keywords", "repository"}

# ── 死循环监控配置 ──
DEADLOOP_DIR = os.path.expanduser("~/.claude/mcp-servers/deadloop-monitor")
DEADLOOP_JSON = os.path.join(DEADLOOP_DIR, "deadloop-config.json")

# 预设方案 key → 显示标签映射
DEADLOOP_PRESET_NAMES = {
    "default": "默认方案",
    "conservative": "保守检测（减少误报）",
    "sensitive": "灵敏检测（尽早发现）",
    "custom": "自定义",
}

# 预设方案固定值（custom 从配置文件读取）
DEADLOOP_PRESETS = {
    "default": {
        "jaccardThreshold": 0.85, "reversalMinCount": 5, "infoNgram": 2,
        "lowInfoThreshold": 0.05, "maxStall": 3, "infoGainThreshold": 0.1,
        "semanticShift": 0.65, "scoreHigh": 80, "scoreLow": 50,
    },
    "conservative": {
        "jaccardThreshold": 0.88, "reversalMinCount": 6, "infoNgram": 2,
        "lowInfoThreshold": 0.03, "maxStall": 4, "infoGainThreshold": 0.12,
        "semanticShift": 0.65, "scoreHigh": 80, "scoreLow": 60,
    },
    "sensitive": {
        "jaccardThreshold": 0.80, "reversalMinCount": 4, "infoNgram": 1,
        "lowInfoThreshold": 0.08, "maxStall": 2, "infoGainThreshold": 0.08,
        "semanticShift": 0.65, "scoreHigh": 80, "scoreLow": 40,
    },
}
DEADLOOP_FIELD_META = {
    "jaccardThreshold": ("高相似度阈值", 0.50, 1.00, 0.01,
        "死循环检测的高相似度阈值",
        "更不敏感（需要更相似才告警）",
        "更敏感（稍相似就告警）"),
    "reversalMinCount": ("反转词阈值", 1, 20, 1,
        "反转词密度检测：200字窗口内命中数",
        "更不敏感（需要更多反转词）",
        "更敏感（少量反转词即告警）"),
    "lowInfoThreshold": ("低信息增量阈值", 0, 1, 0.01,
        "死循环检测的低信息增量阈值",
        "更不敏感（需要更少信息才告警）",
        "更敏感（信息略少就告警）"),
    "infoNgram": ("n-gram 长度", 1, 5, 1,
        "信息增量率计算粒度",
        "更平滑（只关注长模式）",
        "更敏感（关注单个字符变化）"),
    "maxStall": ("连续停滞上限", 1, 10, 1,
        "低信息停滞连续次数上限",
        "更宽容（允许更多连续停滞）",
        "更严格（少次停滞即告警）"),
    "infoGainThreshold": ("有效反转信息增量", 0, 1, 0.01,
        "有效反转要求的信息增量",
        "更严格（要求更多新信息）",
        "更宽松（少量新信息也算有效）"),
    "semanticShift": ("语义转变阈值", 0, 1, 0.01,
        "低于此值算思路转变",
        "更敏感（更容易判为转变）",
        "更不敏感（需要更大转变）"),
    "scoreHigh": ("健康高分阈值", 0, 100, 1,
        "健康度评分高分线",
        "更难得到「健康」",
        "更容易得到「健康」"),
    "scoreLow": ("健康低分阈值", 0, 100, 1,
        "健康度评分警告线（低于此值算危险）",
        "更容易落入「危险」",
        "更容易落入「警告」"),
}


class ConfigApp:
    """主应用类"""

    def __init__(self, page: ft.Page):
        self.page = page
        self.config_path = None
        self.raw_config = {}
        self.control_refs = {}   # field_path → control
        self.process = None
        self._monitor_alive = False

        # ── 配置页面 ──
        page.title = "参数配置工具"
        page.window.min_width = 900
        page.window.min_height = 500
        page.window.width = 1100
        page.window.height = 610
        page.padding = 0
        page.theme_mode = ft.ThemeMode.DARK
        page.on_close = self.on_close
        page.scroll = ft.ScrollMode.AUTO

        # ── 查找配置文件 ──
        self._discover_config()

        # ── 构建 UI ──
        self._build_ui()

        # ── 启动 ESC 监听 ──
        self._start_esc_monitor()

        page.update()

    # ════════════════════════════════════════════
    # 配置文件 I/O
    # ════════════════════════════════════════════

    def _discover_config(self):
        """在当前目录找 package.json"""
        path = os.path.join(os.getcwd(), CONFIG_FILE)
        if os.path.isfile(path):
            self.config_path = path
            with open(path, "r", encoding="utf-8") as f:
                self.raw_config = json.load(f)
        else:
            self.raw_config = DEFAULT_CONFIG.copy()
            self.config_path = None

    def _save_json(self, path, data):
        """写 JSON 文件（原子写入）"""
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    def _collect_values(self):
        """从控件收集当前值，保持 raw_config 结构"""
        return self._collect_recursive(self.raw_config, "")

    def _collect_recursive(self, node, prefix):
        if isinstance(node, dict):
            result = {}
            for k in node:
                child = f"{prefix}.{k}" if prefix else k
                result[k] = self._collect_recursive(node[k], child)
            return result
        elif isinstance(node, list):
            ctrl = self.control_refs.get(prefix)
            if ctrl and hasattr(ctrl, "value"):
                return ctrl.value
            return node
        elif isinstance(node, bool):
            ctrl = self.control_refs.get(prefix)
            if ctrl and hasattr(ctrl, "value"):
                return ctrl.value
            return node
        elif isinstance(node, int):
            ctrl = self.control_refs.get(prefix)
            if ctrl and hasattr(ctrl, "value"):
                try:
                    return int(ctrl.value)
                except (ValueError, TypeError):
                    return node
            return node
        elif isinstance(node, float):
            ctrl = self.control_refs.get(prefix)
            if ctrl and hasattr(ctrl, "value"):
                try:
                    return float(ctrl.value)
                except (ValueError, TypeError):
                    return node
            return node
        else:
            ctrl = self.control_refs.get(prefix)
            if ctrl and hasattr(ctrl, "value"):
                return ctrl.value
            return node

    # ════════════════════════════════════════════
    # UI 构建
    # ════════════════════════════════════════════

    def _build_ui(self):
        """构建完整界面"""
        self.page.clean()
        self.control_refs = {}

        # ── 方案选择（AppBar title 区）──
        self._build_preset_selector()

        # ── 主内容区（只有参数，无右侧面板）──
        self._build_param_area(self.page)

        # ── 底部状态栏 ──
        self._build_statusbar()

    def _build_statusbar(self):
        """底部状态栏"""
        self.lbl_status = ft.Text("修改参数后，点保存，保存为自定义方案", size=12, color=ft.Colors.GREY_400)
        bar = ft.Container(
            content=ft.Row(
                controls=[self.lbl_status, ft.Container(expand=True)],
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            padding=ft.Padding(left=16, right=16, top=6, bottom=6),
            bgcolor=ft.Colors.GREY_900 if self.page.theme_mode == ft.ThemeMode.DARK else ft.Colors.GREY_200,
            border=ft.Border(top=ft.BorderSide(1, ft.Colors.GREY_800), left=ft.BorderSide(0), right=ft.BorderSide(0), bottom=ft.BorderSide(0)),
        )
        self.page.add(bar)

    def _build_preset_selector(self):
        """构建 AppBar，标题 + 方案选择 + 操作按钮"""
        preset_keys = list(DEADLOOP_PRESET_NAMES.keys())
        cfg = self._load_deadloop_config()
        current_preset = cfg.get("_preset", "default")
        if current_preset not in preset_keys:
            current_preset = "custom"

        def on_preset_change(e):
            key = e.control.value
            if key == "custom":
                # 从文件读取保存的自定义值
                try:
                    with open(DEADLOOP_JSON, "r", encoding="utf-8") as f:
                        raw = json.load(f)
                    cv = raw.get("custom_vals", {})
                except Exception:
                    cv = {}
                if cv:
                    cv["_preset"] = "custom"
                    self._deadloop_cfg = cv
                else:
                    self._deadloop_cfg = {"_preset": "custom", **DEADLOOP_PRESETS["default"]}
            else:
                self._deadloop_cfg = {"_preset": key, **DEADLOOP_PRESETS[key]}
            self._refresh_deadloop_values()

        self._preset_dd = ft.Dropdown(
            value=current_preset,
            options=[ft.DropdownOption(k, DEADLOOP_PRESET_NAMES[k]) for k in preset_keys],
            on_select=lambda e: on_preset_change(e),
            width=220, height=38, text_size=14,
            border=ft.InputBorder.OUTLINE,
        )

        self.page.appbar = ft.AppBar(
            title=ft.Container(
                expand=True,
                content=ft.Row(
                    spacing=4,
                    alignment=ft.MainAxisAlignment.CENTER,
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    controls=[
                        ft.Text("阈值预设方案", size=16, weight=ft.FontWeight.W_600),
                        self._preset_dd,
                    ],
                ),
            ),
            bgcolor=ft.Colors.GREY_900 if self.page.theme_mode == ft.ThemeMode.DARK else ft.Colors.GREY_200,
            actions=[
                ft.IconButton(icon=ft.Icons.SAVE, tooltip="保存", on_click=self._on_save_deadloop),
                ft.Container(width=8),
                ft.IconButton(
                    icon=ft.Icons.LIGHT_MODE if self.page.theme_mode == ft.ThemeMode.DARK else ft.Icons.DARK_MODE,
                    tooltip="切换主题",
                    on_click=lambda _: self._set_theme(ft.ThemeMode.LIGHT if self.page.theme_mode == ft.ThemeMode.DARK else ft.ThemeMode.DARK),
                ),
                ft.Container(width=4),
                ft.IconButton(icon=ft.Icons.EXIT_TO_APP, tooltip="退出", on_click=self._on_exit),
            ],
        )
        self.page.update()

    def _build_param_area(self, page):
        """构建参数编辑区（直接添加控件到页面）"""
        scroll_col = ft.Column(spacing=0, scroll=ft.ScrollMode.AUTO, expand=True)
        self._build_deadloop_controls(scroll_col)
        page.add(ft.Container(content=scroll_col, padding=16, expand=True))

    # ════════════════════════════════════════════
    # 死循环监控配置页
    # ════════════════════════════════════════════

    def _load_deadloop_config(self):
        """从 JSON 读死循环配置，不存在则返回 default 方案"""
        try:
            with open(DEADLOOP_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
            preset = data.get("_preset", "default")
            if preset == "custom":
                custom_vals = data.get("custom_vals", {})
                if custom_vals:
                    custom_vals["_preset"] = "custom"
                    return custom_vals
                return {"_preset": "custom", **DEADLOOP_PRESETS["default"]}
            if preset not in DEADLOOP_PRESETS:
                preset = "default"
            return {"_preset": preset, **DEADLOOP_PRESETS[preset]}
        except (FileNotFoundError, json.JSONDecodeError):
            return {"_preset": "default", **DEADLOOP_PRESETS["default"]}

    def _save_deadloop_config(self, cfg):
        """存死循环配置到 JSON"""
        os.makedirs(DEADLOOP_DIR, exist_ok=True)
        tmp = DEADLOOP_JSON + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DEADLOOP_JSON)

    def _build_deadloop_controls(self, parent):
        """构建死循环监控参数调节控件"""
        if not hasattr(self, '_deadloop_cfg') or self._deadloop_cfg is None:
            self._deadloop_cfg = self._load_deadloop_config()
        cfg = self._deadloop_cfg

        # ── 实时检测参数 ──
        parent.controls.append(ft.Text("实时检测参数", size=17, weight=ft.FontWeight.W_600))
        parent.controls.append(self._build_deadloop_header())
        self._deadloop_fields = {}
        det_fields = ["jaccardThreshold", "reversalMinCount", "lowInfoThreshold", "infoNgram", "maxStall"]
        for key in det_fields:
            parent.controls.append(self._build_deadloop_row(key, cfg))

        parent.controls.append(ft.Divider(height=1, color=ft.Colors.GREY_700))

        # ── 健康分析参数 ──
        parent.controls.append(ft.Text("健康分析参数", size=17, weight=ft.FontWeight.W_600))
        parent.controls.append(self._build_deadloop_header())
        health_fields = ["infoGainThreshold", "semanticShift", "scoreHigh", "scoreLow"]
        for key in health_fields:
            parent.controls.append(self._build_deadloop_row(key, cfg))



    # 列宽常量（desc/up/down 用 expand 自适应）
    _DL_COLUMNS = dict(
        name_w=140, val_w=65, range_w=85, default_w=55,
        desc_e=3, up_e=3, down_e=3,
    )

    def _build_deadloop_header(self):
        """构建表头行"""
        c = self._DL_COLUMNS
        return ft.Container(
            content=ft.Row(
                spacing=0,
                controls=[
                    ft.Container(width=c["name_w"], content=ft.Text("参数名称", size=14, color=ft.Colors.GREY_400)),
                    ft.Container(width=c["val_w"], content=ft.Text("数值", size=14, color=ft.Colors.GREY_400)),
                    ft.Container(width=c["range_w"], content=ft.Text("范围", size=14, color=ft.Colors.GREY_400)),
                    ft.Container(width=c["default_w"], content=ft.Text("默认", size=14, color=ft.Colors.GREY_400)),
                    ft.Container(expand=c["desc_e"], content=ft.Text("作用", size=14, color=ft.Colors.GREY_400)),
                    ft.Container(expand=c["up_e"], content=ft.Text("调高", size=14, color=ft.Colors.GREY_400)),
                    ft.Container(expand=c["down_e"], content=ft.Text("调低", size=14, color=ft.Colors.GREY_400)),
                ],
            ),
            padding=ft.Padding(left=12, top=2, right=0, bottom=2),
            bgcolor=ft.Colors.GREY_900 if self.page.theme_mode == ft.ThemeMode.DARK else ft.Colors.GREY_300,
            border_radius=4,
        )

    def _build_deadloop_row(self, key, cfg):
        """构建一行参数：表格对齐各列"""
        label, vmin, vmax, step, desc, up_effect, down_effect = DEADLOOP_FIELD_META[key]
        default_val = DEADLOOP_PRESETS["default"][key]
        val = cfg.get(key, default_val)
        c = self._DL_COLUMNS

        def on_change(e, k=key):
            try:
                raw = e.control.value.strip()
                if raw == "" or raw == "-":
                    return
                if isinstance(vmin, int):
                    v = int(float(raw))
                else:
                    v = float(raw)
                limited = v < vmin or v > vmax
                v = max(vmin, min(vmax, v))
                self._deadloop_cfg[k] = v
                if limited:
                    e.control.value = str(v)
                    self.update_status(f"值已限制在 {vmin} ~ {vmax} 范围内")
                # 修改参数时自动切换到自定义方案
                preset = self._deadloop_cfg.get("_preset", "")
                if preset != "custom":
                    self._deadloop_cfg["_preset"] = "custom"
                    self._preset_dd.value = "custom"
                self.page.update()
            except (ValueError, TypeError):
                pass

        tf = ft.TextField(
            value=str(val), width=c["val_w"]-4, height=34, text_size=15,
            border=ft.InputBorder.UNDERLINE,
            on_change=on_change,
        )
        self._deadloop_fields[key] = tf

        return ft.Container(
            content=ft.Row(
                spacing=0,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
                controls=[
                    ft.Container(width=c["name_w"], content=ft.Text(label, size=15, weight=ft.FontWeight.W_500)),
                    ft.Container(width=c["val_w"], content=tf),
                    ft.Container(width=c["range_w"], content=ft.Text(f"{vmin}~{vmax}", size=14, color=ft.Colors.GREY_400)),
                    ft.Container(width=c["default_w"], content=ft.Text(str(default_val), size=14, color=ft.Colors.GREY_400)),
                    ft.Container(expand=c["desc_e"], content=ft.Text(desc, size=14)),
                    ft.Container(expand=c["up_e"], content=ft.Text(up_effect, size=14)),
                    ft.Container(expand=c["down_e"], content=ft.Text(down_effect, size=14)),
                ],
            ),
            padding=ft.Padding(left=12, top=1, right=0, bottom=1),
        )

    def _refresh_deadloop_values(self):
        """切换方案后刷新所有参数的显示值"""
        for key, tf in self._deadloop_fields.items():
            tf.value = str(self._deadloop_cfg.get(key, DEADLOOP_PRESETS["default"][key]))
        self.page.update()

    def _on_save_deadloop(self, e=None):
        """保存死循环配置到 JSON 文件"""
        try:
            preset = self._deadloop_cfg.get("_preset", "custom")
            if preset == "custom":
                # 自定义方案：只存值到 custom_vals
                vals = {k: v for k, v in self._deadloop_cfg.items() if k != "_preset"}
                self._save_deadloop_config({"_preset": "custom", "custom_vals": vals})
            else:
                self._save_deadloop_config(self._deadloop_cfg)
            self.update_status("已保存")
        except Exception as ex:
            self._show_dialog("保存失败", str(ex))

    def _build_controls(self, data, prefix=""):
        """递归生成控件列表，每项为 ft.Row(label + control) 或 ExpansionTile"""
        controls = []

        if not isinstance(data, dict):
            # 非 dict 类型直接放在根 tab 下
            row = ft.Row(
                controls=[
                    ft.Container(width=140, content=ft.Text(str(prefix), weight=ft.FontWeight.W_500)),
                    self._create_control(data, prefix, str(data)),
                ],
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            )
            controls.append(row)
            return controls

        for key, value in data.items():
            field_path = f"{prefix}.{key}" if prefix else key

            if isinstance(value, dict):
                # dict → ExpansionTile（可折叠分组）
                tile = ft.ExpansionTile(
                    title=ft.Text(key, weight=ft.FontWeight.W_600),
                    subtitle=ft.Text(f"{len(value)} 项", size=11, color=ft.Colors.GREY),
                    initially_expanded=True,
                    controls=self._build_controls(value, field_path),
                    tile_padding=ft.Padding(left=8, top=0, right=0, bottom=0),
                )
                controls.append(tile)
            else:
                row = ft.Row(
                    controls=[
                        ft.Container(
                            width=140,
                            content=ft.Text(key, weight=ft.FontWeight.W_500),
                        ),
                        self._create_control(value, field_path, str(value)),
                    ],
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                )
                controls.append(row)

        return controls

    def _create_control(self, value, field_path, str_value=""):
        """根据值类型创建编辑控件"""
        if isinstance(value, bool):
            switch = ft.Switch(
                value=value,
                on_change=lambda e, p=field_path: self._on_control_change(p, e.control.value),
            )
            self.control_refs[field_path] = switch
            return switch

        elif isinstance(value, int):
            tf = ft.TextField(
                value=str(value),
                width=200,
                height=40,
                text_size=14,
                border=ft.InputBorder.UNDERLINE,
                on_change=lambda e, p=field_path: self._on_control_change(p, e.control.value),
            )
            self.control_refs[field_path] = tf
            return tf

        elif isinstance(value, float):
            tf = ft.TextField(
                value=str(value),
                width=200,
                height=40,
                text_size=14,
                border=ft.InputBorder.UNDERLINE,
                on_change=lambda e, p=field_path: self._on_control_change(p, e.control.value),
            )
            self.control_refs[field_path] = tf
            return tf

        elif isinstance(value, list):
            options = [ft.dropdown.Option(str(v)) for v in value] if value else [ft.dropdown.Option("")]
            selected = str(value[0]) if value else ""
            dd = ft.Dropdown(
                value=selected if any(o.key == selected for o in options) else options[0].key,
                options=options,
                width=200,
                height=40,
                text_size=14,
                on_change=lambda e, p=field_path: self._on_control_change(p, e.control.value),
            )
            self.control_refs[field_path] = dd
            return dd

        else:
            # str 或其他
            tf = ft.TextField(
                value=str(value) if value is not None else "",
                width=400,
                height=40,
                text_size=14,
                border=ft.InputBorder.UNDERLINE,
                on_change=lambda e, p=field_path: self._on_control_change(p, e.control.value),
            )
            self.control_refs[field_path] = tf
            return tf

    def _build_side_panel(self, parent_row):
        """右侧按钮面板"""
        panel = ft.Column(
            width=160,
            spacing=10,
            horizontal_alignment=ft.CrossAxisAlignment.CENTER,
        )

        panel.controls.extend([
            ft.Container(height=12),
            ft.Button(
                content="▶ 运行",
                icon=ft.Icons.PLAY_ARROW,
                color=ft.Colors.GREEN_ACCENT_400,
                width=130, height=44,
                on_click=self._on_run,
            ),
            ft.Button(
                content="■ 停止",
                icon=ft.Icons.STOP,
                color=ft.Colors.RED_ACCENT_400,
                width=130, height=44,
                on_click=self._on_stop,
            ),
            ft.Divider(height=2, color=ft.Colors.GREY_700),
            ft.Button(
                content="↺ 恢复默认", width=130,
                on_click=self._on_reset_default,
            ),
            ft.Text("主题", size=11, color=ft.Colors.GREY),
            ft.Row(
                alignment=ft.MainAxisAlignment.CENTER,
                controls=[
                    ft.IconButton(
                        icon=ft.Icons.LIGHT_MODE,
                        tooltip="浅色",
                        on_click=lambda _: self._set_theme(ft.ThemeMode.LIGHT),
                    ),
                    ft.IconButton(
                        icon=ft.Icons.DARK_MODE,
                        tooltip="深色",
                        on_click=lambda _: self._set_theme(ft.ThemeMode.DARK),
                    ),
                ],
            ),
        ])

        # 弹簧
        panel.controls.append(ft.Container(expand=True))

        parent_row.controls.append(
            ft.Container(
                content=panel,
                padding=ft.Padding(left=8, right=8, top=12, bottom=12),
                border=ft.Border(left=ft.BorderSide(1, ft.Colors.GREY_800), right=ft.BorderSide(0), top=ft.BorderSide(0), bottom=ft.BorderSide(0)),
            )
        )


    # ════════════════════════════════════════════
    # 回调
    # ════════════════════════════════════════════

    def _on_control_change(self, field_path, value):
        """控件值变化时标记（可扩展为自动保存）"""
        pass

    def _on_save(self, e=None):
        """保存到当前文件"""
        updated = self._collect_values()
        if self.config_path:
            try:
                self._save_json(self.config_path, updated)
                with open(self.config_path, "r", encoding="utf-8") as f:
                    self.raw_config = json.load(f)
                self.update_status("已保存")
            except Exception as ex:
                self._show_dialog("保存失败", str(ex))
        else:
            self._on_save_as(e)

    def _on_save_as(self, e=None):
        """另存为（使用 FilePicker）"""
        def on_result(result: ft.FilePickerResultEvent):
            if not result.path:
                return
            try:
                updated = self._collect_values()
                self._save_json(result.path, updated)
                self.config_path = result.path
                with open(result.path, "r", encoding="utf-8") as f:
                    self.raw_config = json.load(f)
                self.update_status("已保存")
                self.page.update()
            except Exception as ex:
                self._show_dialog("保存失败", str(ex))

        picker = ft.FilePicker(on_result=on_result)
        self.page.overlay.append(picker)
        self.page.update()
        picker.save_file(
            file_name=self.config_path or CONFIG_FILE,
            file_type=ft.FilePickerFileType.CUSTOM,
            allowed_extensions=["json"],
        )

    def _on_reload(self, e=None):
        """从文件重新加载"""
        if not self.config_path:
            self.update_status("无配置文件")
            return
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                self.raw_config = json.load(f)
            self._build_ui()
            self.update_status("已重新加载")
            self.page.update()
        except Exception as ex:
            self._show_dialog("加载失败", str(ex))

    def _on_reset_default(self, e=None):
        """恢复默认方案"""
        self._save_deadloop_config({"_preset": "default", **DEADLOOP_PRESETS["default"]})
        self._build_ui()

    def _set_theme(self, mode: ft.ThemeMode):
        self.page.theme_mode = mode
        self._build_ui()
        self.page.update()

    # ════════════════════════════════════════════
    # 进程管理
    # ════════════════════════════════════════════

    def _on_run(self, e=None):
        """读取 command 启动子进程"""
        if self.process and self.process.poll() is None:
            self._show_dialog("提示", "进程已在运行中")
            return

        # 先保存
        try:
            updated = self._collect_values()
            if self.config_path:
                self._save_json(self.config_path, updated)
                with open(self.config_path, "r", encoding="utf-8") as f:
                    self.raw_config = json.load(f)
        except Exception as ex:
            self.update_status(f"保存失败: {ex}")
            return

        cmd = self.raw_config.get("command", "")
        if not cmd:
            self._show_dialog("提示", "配置中未设置 command 字段")
            return

        try:
            self.process = subprocess.Popen(
                cmd, shell=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if OS_NAME == "Windows" else 0,
            )
        except Exception as ex:
            self._show_dialog("启动失败", str(ex))
            self.update_status(f"启动失败: {ex}")
            return

        self.update_status(f"运行中 (PID: {self.process.pid})")
        self.page.update()

        # 后台监控
        self._monitor_alive = True
        threading.Thread(target=self._monitor_loop, daemon=True).start()

    def _monitor_loop(self):
        """后台线程：轮询进程是否存活"""
        while self._monitor_alive and self.process:
            time.sleep(1)
            if self.process.poll() is not None:
                rc = self.process.poll()
                self.process = None
                self.update_status(f"已停止 (退出码: {rc})")
                try:
                    self.page.update()
                except Exception:
                    pass
                break

    def _on_stop(self, e=None):
        self._stop_process()

    def _stop_process(self):
        if not self.process or self.process.poll() is not None:
            self.process = None
            self.update_status("就绪")
            try:
                self.page.update()
            except Exception:
                pass
            return

        pid = self.process.pid
        try:
            if OS_NAME == "Windows":
                subprocess.call(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            else:
                import signal
                try:
                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                except AttributeError:
                    self.process.terminate()
        except Exception:
            try:
                self.process.kill()
            except Exception:
                pass
        finally:
            self.process = None
            self.update_status("已停止")
            try:
                self.page.update()
            except Exception:
                pass

    # ════════════════════════════════════════════
    # ESC 全局监听
    # ════════════════════════════════════════════

    def _start_esc_monitor(self):
        """启动 ESC 长按监听后台线程"""
        self._esc_active = True
        threading.Thread(target=self._esc_loop, daemon=True).start()

    def _esc_loop(self):
        """pynput 监听 ESC，长按 ≥1s 停止进程"""
        held = False
        hold_start = None

        def on_press(key):
            nonlocal held, hold_start
            if key == keyboard.Key.esc and not held:
                held = True
                hold_start = time.time()

        def on_release(key):
            nonlocal held, hold_start
            if key == keyboard.Key.esc:
                held = False
                hold_start = None

        listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        listener.start()

        try:
            while self._esc_active:
                if held and hold_start and (time.time() - hold_start >= 1.0):
                    self._stop_process()
                    held = False
                    hold_start = None
                time.sleep(0.05)
        finally:
            listener.stop()

    # ════════════════════════════════════════════
    # 工具方法
    # ════════════════════════════════════════════

    def update_status(self, message):
        """更新底部状态栏文字"""
        if hasattr(self, 'lbl_status') and self.lbl_status:
            self.lbl_status.value = message
        try:
            self.page.update()
        except Exception:
            pass

    def _show_dialog(self, title, content):
        """显示弹窗"""
        dlg = ft.AlertDialog(
            title=ft.Text(title),
            content=ft.Text(content),
            actions=[ft.TextButton("确定", on_click=lambda _: self._close_dialog(dlg))],
        )
        self.page.overlay.append(dlg)
        self.page.update()
        dlg.open = True
        self.page.update()

    def _close_dialog(self, dlg):
        dlg.open = False
        self.page.update()

    def _on_exit(self, e=None):
        """退出按钮回调"""
        asyncio.create_task(self._async_close())

    async def on_close(self):
        """窗口关闭事件（page.on_close 绑定）"""
        await self._async_close()

    async def _async_close(self):
        """实际关闭逻辑"""
        self._esc_active = False
        self._monitor_alive = False
        self._stop_process()
        await self.page.window.destroy()


# ════════════════════════════════════════════
# 入口
# ════════════════════════════════════════════

def main(page: ft.Page):
    ConfigApp(page)


if __name__ == "__main__":
    ft.run(main)
