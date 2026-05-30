const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const MONITOR_DIR = path.join(process.env.USERPROFILE || "C:/Users/default", ".claude", "mcp-servers", "deadloop-monitor");
const LOG_FILE = path.join(MONITOR_DIR, "deadloop-monitor.jsonl");
const CLAUDE_SETTINGS = path.join(process.env.USERPROFILE || "C:/Users/default", ".claude", "settings.json");

// ── 预设方案定义 ──
const PRESETS = {
  default: {
    label: "默认方案", jaccardThreshold: 0.85, reversalMinCount: 5, infoNgram: 2, lowInfoThreshold: 0.05, maxStall: 3,
    infoGainThreshold: 0.1, semanticShift: 0.65, scoreHigh: 80, scoreLow: 50, useSemantic: false, verbose: false,
  },
  conservative: {
    label: "保守检测（减少误报）", jaccardThreshold: 0.88, reversalMinCount: 6, infoNgram: 2, lowInfoThreshold: 0.03, maxStall: 4,
    infoGainThreshold: 0.12, semanticShift: 0.65, scoreHigh: 80, scoreLow: 60, useSemantic: false, verbose: false,
  },
  sensitive: {
    label: "灵敏检测（尽早发现）", jaccardThreshold: 0.80, reversalMinCount: 4, infoNgram: 1, lowInfoThreshold: 0.08, maxStall: 2,
    infoGainThreshold: 0.08, semanticShift: 0.65, scoreHigh: 80, scoreLow: 40, useSemantic: false, verbose: false,
  },
};

function readSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(MONITOR_DIR, "settings.json"), "utf-8")); } catch { return { preset: "default" }; }
}
function writeSettings(data) {
  const current = readSettings();
  Object.assign(current, data);
  fs.writeFileSync(path.join(MONITOR_DIR, "settings.json"), JSON.stringify(current, null, 2), "utf-8");
}

// ════════════════════════════════════════
// StatusBar
// ════════════════════════════════════════

class StatusBarManager {
  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "循环守护";
    this.state = { status: "hook_mode", workspace: "", lastTrigger: null };
    this.updateDisplay();
  }

  updateState(newState) {
    Object.assign(this.state, newState);
    this.updateDisplay();
  }

  updateDisplay() {
    const { status, workspace, lastTrigger } = this.state;
    let icon = "$(pulse)", tooltipStatus = "🟢 运行中";
    this.item.backgroundColor = undefined;
    if (status === "alert") {
      icon = "$(error)"; tooltipStatus = "🔴 检测到死循环！";
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (status === "hook_disabled") {
      icon = "$(circle-slash)"; tooltipStatus = "⚪ 已禁用";
    }
    const settings = readSettings();
    const preset = PRESETS[settings.preset] || PRESETS.default;
    const hookOn = isHookActive();
    const hookLabel = hookOn ? "✅ 已启用" : "❌ 已停用";
    this.item.text = icon + " 循环守护";
    this.item.tooltip = [
      "循环守护    " + tooltipStatus,
      "──────────────────────────────",
      "Stop Hook   " + hookLabel,
      "预设方案    " + preset.label,
      "相似阈值    " + preset.jaccardThreshold.toFixed(2),
      "反转词      ≥" + preset.reversalMinCount + " 词/200字",
      "信息增量    <" + preset.lowInfoThreshold.toFixed(2) + " 触发停滞",
      workspace ? "工作区      " + workspace : "",
      lastTrigger ? "最近触发:   " + lastTrigger : "",
      "──────────────────────────────",
      "左键 → 打开菜单",
    ].filter(Boolean).join("\n");
    this.item.show();
  }

  registerCommands(context) {
    const cmdId = "loopGuardian.showQuickPick";
    context.subscriptions.push(vscode.commands.registerCommand(cmdId, async () => {
      const hookOn = isHookActive();
      const toggleLabel = hookOn ? "⏹ 停用 Stop Hook（需 Reload）" : "▶ 启用 Stop Hook（需 Reload）";
      const options = [
        { label: toggleLabel, action: "toggleHook" },
        { label: "📋 查看日志", action: "viewLog" },
        { label: "⚙ 检测阈值设置 →", action: "thresholdConfig" },
        { label: "🏥 完整会话健康度分析", action: "healthAnalysis" },
      ];
      const choice = await vscode.window.showQuickPick(options, { placeHolder: "循环守护 – 选择操作" });
      if (!choice) return;
      if (choice.action === "toggleHook") {
        toggleHook(this);
      } else if (choice.action === "viewLog") {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(LOG_FILE));
          await vscode.window.showTextDocument(doc);
        } catch (e) { vscode.window.showInformationMessage("日志文件暂不可用"); }
      } else if (choice.action === "thresholdConfig") {
        launchConfigGui();
      } else if (choice.action === "healthAnalysis") {
        runHealthAnalysis();
      }
    }));
    this.item.command = cmdId;
  }

  dispose() { this.item.dispose(); }
}

// ════════════════════════════════════════
// Stop Hook 开关
// ════════════════════════════════════════

function isHookActive() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf-8"));
    return !!(cfg.hooks?.Stop);
  } catch { return false; }
}

function toggleHook(statusBar) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf-8"));
    if (cfg.hooks?.Stop) {
      delete cfg.hooks.Stop;
      if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
      fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2), "utf-8");
      statusBar.updateState({ status: "hook_disabled" });
      vscode.window.showInformationMessage("⏹ Stop Hook 已关闭，Reload Window 后生效");
    } else {
      if (!cfg.hooks) cfg.hooks = {};
      cfg.hooks.Stop = [{
        hooks: [{
          type: "command",
          command: "node",
          args: [path.join(MONITOR_DIR, "stop-hook.mjs").replace(/\\/g, "/")],
          timeout: 15,
        }],
      }];
      fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2), "utf-8");
      statusBar.updateState({ status: "hook_mode" });
      vscode.window.showInformationMessage("▶ Stop Hook 已开启，Reload Window 后生效");
    }
  } catch (e) {
    vscode.window.showErrorMessage("操作失败: " + e.message);
  }
}

// ════════════════════════════════════════
// GUI 配置界面
// ════════════════════════════════════════

function launchConfigGui() {
  const guiScript = path.join(MONITOR_DIR, "config_gui.py");
  let py = path.join(MONITOR_DIR, "..", "python3.13.3", "python.exe");
  if (!fs.existsSync(py)) py = "python";
  const child = require("child_process");
  child.exec(`"${py}" "${guiScript}"`, (err, stdout, stderr) => {
    if (err) {
      vscode.window.showErrorMessage(`启动配置界面失败: ${err.message}`);
    }
  });
}

// ════════════════════════════════════════
// 健康度分析
// ════════════════════════════════════════

function runHealthAnalysis() {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  const wsPath = wsFolder?.uri.fsPath || "";
  if (!wsPath) { vscode.window.showInformationMessage("未检测到工作区"); return; }
  const settings = readSettings();
  const preset = PRESETS[settings.preset] || PRESETS.default;
  const args = [
    path.join(MONITOR_DIR, "think_health_analyzer.py"), "--ws", wsPath,
    "--high-sim", String(preset.jaccardThreshold),
    "--low-info", String(preset.lowInfoThreshold),
    "--ngram", String(preset.infoNgram),
    "--info-gain", String(preset.infoGainThreshold),
    "--semantic-shift", String(preset.semanticShift),
    "--score-high", String(preset.scoreHigh),
    "--score-low", String(preset.scoreLow),
  ];
  if (!preset.useSemantic) args.push("--no-semantic");
  if (preset.verbose) args.push("-v");
  vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "正在分析会话健康度…", cancellable: false }, async () => {
    return new Promise((resolve) => {
      const proc = spawn("python", args, { cwd: MONITOR_DIR, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      let stdout = "", stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());
      proc.on("close", () => {
        if (stdout) {
          vscode.workspace.openTextDocument({ content: stdout, language: "markdown" }).then(doc => vscode.window.showTextDocument(doc));
        } else {
          vscode.window.showErrorMessage("分析失败: " + (stderr || "未知错误"));
        }
        resolve();
      });
      proc.on("error", () => { vscode.window.showErrorMessage("无法启动分析进程"); resolve(); });
    });
  });
}

// ════════════════════════════════════════
// 激活 / 停用
// ════════════════════════════════════════

function activate(context) {
  console.log("[deadloop] activate (hook mode)");
  const statusBar = new StatusBarManager();
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  const wsPath = wsFolder?.uri.fsPath || "";
  const initialState = isHookActive() ? "hook_mode" : "hook_disabled";
  statusBar.updateState({ status: initialState, workspace: wsPath });
  statusBar.registerCommands(context);
  context.subscriptions.push(statusBar);
}

function deactivate() {}

module.exports = { activate, deactivate };
