const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const MONITOR_DIR = path.join(process.env.USERPROFILE || "C:/Users/default", ".claude", "mcp-servers", "deadloop-monitor");
const MONITOR_SCRIPT = path.join(MONITOR_DIR, "monitor.mjs");
const LOG_FILE = path.join(MONITOR_DIR, "deadloop-monitor.jsonl");
const SETTINGS_FILE = path.join(MONITOR_DIR, "settings.json");

// ── 预设方案定义（完整参数列表，对应 Python think_health_analyzer.py）──
const PRESETS = {
  default: {
    label: "默认方案",
    // 检测器参数
    jaccardThreshold: 0.85, reversalMinCount: 5, infoNgram: 2, lowInfoThreshold: 0.05, maxStall: 3,
    // 健康分析参数
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
};

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")); } catch { return { preset: "default" }; }
}

function writeSettings(data) {
  const current = readSettings();
  Object.assign(current, data);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(current, null, 2), "utf-8");
}

class StatusBarManager {
  constructor(workspacePath) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "循环守护";
    this.unreadAlert = false;
    this.reportFile = workspacePath ? path.join(workspacePath, ".deadloop-report.md") : "";
    this.state = {
      status: "stopped",
      workspace: "", file: "",
      detectorDetails: null,
      lastPoll: "", tokenCount: 0, lastTrigger: null, cooldownLeft: 0,
      stopReason: "", stopHint: "",
    };
    this.updateDisplay();
  }

  updateState(newState) {
    Object.assign(this.state, newState);
    if (this.state.status !== "stopped" && this.state.status !== "stopping") {
      this.state.stopReason = ""; this.state.stopHint = "";
    }
    this.updateDisplay();
  }

  updateDisplay() {
    const { status, workspace, file, detectors, lastPoll, tokenCount, lastTrigger, cooldownLeft } = this.state;
    let icon = "$(pulse)", tooltipStatus = "";
    this.item.backgroundColor = undefined;
    switch (status) {
      case "monitoring": icon = "$(pulse)"; tooltipStatus = "🟢 已启动"; break;
      case "paused": icon = "$(debug-pause)"; tooltipStatus = "🟡 已暂停"; break;
      case "cooling": icon = "$(sync~spin)"; tooltipStatus = `🌀 冷却中（剩余 ${cooldownLeft} 秒）`; break;
      case "alert": icon = "$(error)"; tooltipStatus = "🔴 检测到死循环！"; this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground"); break;
      case "intervention_needed": icon = "$(warning)"; tooltipStatus = "⚠️ 需手动干预"; this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground"); break;
      case "stopped": case "stopping": icon = "$(circle-slash)"; tooltipStatus = "⚪ 已停止"; break;
      default: tooltipStatus = "❓ 未知状态";
    }

    // 有未读告警时强制显示警告图标
    if (this.unreadAlert) {
      icon = "$(warning)";
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }

    this.item.text = icon + " 循环守护";
    const { stopReason, stopHint } = this.state;
    this.item.tooltip = this.buildTooltip(tooltipStatus, workspace, file, lastPoll, tokenCount, lastTrigger, cooldownLeft, stopReason, stopHint);
    this.item.show();
  }

  buildTooltip(statusLine, workspace, file, lastPoll, tokenCount, lastTrigger, cooldownLeft, stopReason, stopHint) {
    const lines = [
      "循环守护    " + statusLine,
      "──────────────────────────────",
      "工作区: " + (workspace || "未知"),
      "监控会话: " + (file || "未知"),
      "检测器: Jaccard 相似 ✅  反转词+有效性 ✅  n-gram 增量率 ✅",
      lastPoll ? "最后轮询: " + lastPoll : "",
      "本轮 token: " + tokenCount.toLocaleString(),
      lastTrigger ? "最近触发: " + lastTrigger + "（菜单查看报告）" : "最近触发: 暂无",
      cooldownLeft > 0 ? "冷却剩余: " + cooldownLeft + " 秒" : "",
      stopReason ? "停止原因: " + stopReason : "",
      stopHint ? "提示: " + stopHint : "",
      "──────────────────────────────",
      "鼠标左键 → 打开菜单",
    ];
    return lines.filter(Boolean).join("\n");
  }

  writeReport(timeStr, details) {
    if (!this.reportFile) return;
    let entries = [];
    try {
      const content = fs.readFileSync(this.reportFile, "utf-8");
      entries = content.split(/\n(?=## )/).filter(Boolean);
    } catch {}
    const rpt = details?.jaccard ? `sim=${details.jaccard.sim.toFixed(2)} 连续${details.jaccard.streak}次(阈${details.jaccard.threshold})` : "?";
    const rev = details?.reversal ? `命中${details.reversal.count}词/200字(阈${details.reversal.threshold})` : "?";
    const stall = details?.infoStall ? `增率${details.infoStall.gainRate.toFixed(2)} 停滞${details.infoStall.stallCount}次(阈${details.infoStall.maxStall})` : "?";
    const entry = [
      `## 检测 — ${timeStr}`,
      "",
      "| 检测器 | 条件 | 结果 |",
      "|------|------|------|",
      `| Jaccard 相似度 | 连续${details?.jaccard?.streak || 0}次≥阈值 | ${rpt} |`,
      `| 反转词密度 | ≥${details?.reversal?.threshold || 5}词/200字 | ${rev} |`,
      `| n-gram 增量率 | 连续${details?.infoStall?.stallCount || 0}次停滞 | ${stall} |`,
      "",
    ].join("\n");
    entries.push(entry);
    if (entries.length > 5) entries = entries.slice(entries.length - 5);
    fs.writeFileSync(this.reportFile, entries.join("\n") + "\n", "utf-8");
  }

  registerCommands(context, commands) {
    const cmdId = "loopGuardian.showQuickPick";
    context.subscriptions.push(vscode.commands.registerCommand(cmdId, async () => {
      const options = [];
      const s = this.state.status;
      if (s === "monitoring") {
        options.push({ label: "⏸ 暂停监控", action: "pause" });
        options.push({ label: "⏹ 停止监控", action: "stop" });
      } else if (s === "paused") {
        options.push({ label: "▶ 恢复监控", action: "resume" });
      } else if (s === "stopped" || s === "stopping") {
        options.push({ label: "▶ 启动监控", action: "resume" });
      } else {
        options.push({ label: "⏹ 停止监控", action: "stop" });
      }
      options.push({ label: "📋 检测报告", action: "viewReport" });
      options.push({ label: "📋 查看日志", action: "viewLog" });
      options.push({ label: "🏥 完整会话健康度分析", action: "healthAnalysis" });
      options.push({ label: "⚙ 检测阈值设置 →", action: "thresholdConfig" });
      const choice = await vscode.window.showQuickPick(options, { placeHolder: "循环守护 – 选择操作" });
      if (!choice) return;
      if (choice.action === "viewLog") {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(LOG_FILE));
          await vscode.window.showTextDocument(doc);
        } catch (e) { vscode.window.showInformationMessage("日志文件暂不可用"); console.error(e); }
      } else if (choice.action === "viewReport") {
        this.unreadAlert = false;
        this.updateDisplay();
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.reportFile));
          await vscode.window.showTextDocument(doc);
        } catch (e) { vscode.window.showInformationMessage("暂无检测报告"); }
      } else if (choice.action === "healthAnalysis") {
        runHealthAnalysis(this.state.workspace);
      } else if (choice.action === "thresholdConfig") {
        launchConfigGui();
      } else { commands.sendCommand(choice.action); }
    }));
    this.item.command = cmdId;
  }

  dispose() { this.item.dispose(); }
}

// ── 可靠终端发送（不依赖 activeTerminal）──
function sendToTerminal(text, preserveFocus = true) {
  let term = vscode.window.activeTerminal;
  if (term && term.name.toLowerCase().includes("claude")) {
    term.show(preserveFocus);
    term.sendText(text);
    return true;
  }
  // 搜索所有终端
  term = vscode.window.terminals.find(t => t.name.toLowerCase().includes("claude"))
    || vscode.window.terminals[0];
  if (term) {
    term.show(preserveFocus);
    term.sendText(text);
    return true;
  }
  return false;
}

// ── 进程管理 ──
const processes = new Map();

function startMonitor(workspacePath, onStatusUpdate, statusBar) {
  if (processes.has(workspacePath)) return;

  // 杀掉所有此工作区旧的 monitor.mjs 进程（防止 reload 后变成孤儿进程）
  const pidFile = path.join(workspacePath, ".deadloop-pid");
  try {
    const result = require("child_process").execSync(
      `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe' AND CommandLine like '%deadloop-monitor%monitor.mjs%'\\" | Select-Object -ExpandProperty ProcessId"`,
      { encoding: "utf8", timeout: 10000 }
    );
    const pids = result.trim().split(/\s+/).filter(id => id && parseInt(id) !== process.pid);
    for (const pid of pids) {
      try { process.kill(parseInt(pid)); } catch {}
      try { require("child_process").execSync("taskkill /f /pid " + pid + " 2>nul", { timeout: 3000 }); } catch {}
    }
  } catch { /* 无旧进程 */ }

  const parentPid = typeof process.ppid === "number" ? process.ppid : 0;
  const proc = spawn("node", [MONITOR_SCRIPT, workspacePath, String(parentPid)], {
    cwd: workspacePath,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
    windowsHide: true,
  });

  processes.set(workspacePath, proc);

  const monitorDir = path.dirname(MONITOR_SCRIPT);
  const heartbeatFile = path.join(monitorDir, ".deadloop-heartbeat");
  try { fs.writeFileSync(path.join(monitorDir, ".deadloop-pid"), String(proc.pid)); } catch (e) { console.error(e); }

  let stdoutBuf = "";

  const stdoutHandler = (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line.trim());
        // action 消息：发 ESC / 注入文本到终端
        if (json.action === "sendEsc") {
          sendToTerminal("\x1b");
          continue;
        }
        if (json.action === "injectText" && json.text) {
          sendToTerminal('\x1b', false);          // ESC 聚焦 Claude 对话框
          sendToTerminal(json.text, false);        // 输入文本
          sendToTerminal('\n', false);             // Enter
          sendToTerminal('\n', false);             // Ctrl+Enter 提交
          continue;
        }
        const upd = { status: json.status.toLowerCase() };
        if (json.status.toLowerCase() !== "paused") upd.lastPoll = new Date().toLocaleTimeString();
        if (typeof json.tokenCount === "number") upd.tokenCount = json.tokenCount;
        if (typeof json.cooldownLeft === "number") upd.cooldownLeft = json.cooldownLeft;
        if (json.detectors) upd.detectorDetails = json.detectors;
        onStatusUpdate(upd);
      } catch (e) {
        if (line.includes("DEADLOOP_DETECTED")) {
          const timeStr = new Date().toLocaleString();
          statusBar.unreadAlert = true;
          statusBar.writeReport(timeStr, statusBar.state.detectorDetails);
          onStatusUpdate({ status: "alert", lastTrigger: timeStr, lastPoll: new Date().toLocaleTimeString() });
          statusBar.updateDisplay();
        } else if (line.includes("NEEDS_MANUAL")) {
          vscode.window.showErrorMessage("自动中断失败，请手动 Ctrl+C 终止 Claude Code");
          onStatusUpdate({ status: "intervention_needed", lastTrigger: new Date().toLocaleTimeString(), lastPoll: new Date().toLocaleTimeString() });
        } else {
          console.warn("[deadloop] unknown stdout line:", line.slice(0, 200));
        }
      }
    }
  };

  proc.stdout.on("data", stdoutHandler);

  const cleanUp = () => {
    if (processes.has(workspacePath)) processes.delete(workspacePath);
    try { proc.stdout.removeListener("data", stdoutHandler); } catch {}
    try { proc.stdin.end(); } catch {}
    clearInterval(checkInterval);
    onStatusUpdate({ status: "stopped", stopReason: "监控进程已退出" });
    try { fs.unlinkSync(heartbeatFile); } catch {}
    try { fs.unlinkSync(pidFile); } catch {}
  };

  // 心跳文件检测：monitor.mjs 每 2 秒写文件，扩展每 3 秒读 mtime
  // 连续 2 次（约 6 秒）检测不到心跳才判定死亡，防止 GC 停顿误杀
  let heartbeatMisses = 0;
  const checkInterval = setInterval(() => {
    try {
      const age = Date.now() - fs.statSync(heartbeatFile).mtimeMs;
      if (age > 10000) {
        heartbeatMisses++;
        if (heartbeatMisses >= 2) {
          cleanUp();
        }
      } else {
        heartbeatMisses = 0;
      }
    } catch {
      heartbeatMisses++;
      if (heartbeatMisses >= 2) {
        cleanUp();
      }
    }
  }, 3000);
}

function stopMonitor(workspacePath) {
  const proc = processes.get(workspacePath);
  if (!proc) return;
  try { proc.stdin.write(JSON.stringify({ command: "stop" }) + "\n"); } catch (e) { console.error(e); }
  setTimeout(() => {
    if (processes.has(workspacePath)) {
      try { proc.kill("SIGTERM"); } catch (e) { console.error(e); }
      processes.delete(workspacePath);
    }
  }, 3000);
}

function sendCommand(workspacePath, command) {
  const proc = processes.get(workspacePath);
  if (proc) { try { proc.stdin.write(JSON.stringify({ command }) + "\n"); } catch (e) { console.error(e); } }
}

// ── 启动 GUI 配置界面 ──
function launchConfigGui() {
  const guiScript = path.join(MONITOR_DIR, "config_gui.py");
  const pythonPath = path.join(process.env.USERPROFILE || "C:/Users/default", "AppData", "Local", "Python", "bin", "python.exe");
  const py = fs.existsSync(pythonPath) ? pythonPath : "python";
  const child = require("child_process");
  child.exec(`"${py}" "${guiScript}"`, (err, stdout, stderr) => {
    if (err) {
      vscode.window.showErrorMessage(`启动配置界面失败: ${err.message}`);
      console.error("[launchConfigGui]", err, stderr);
    }
  });
}

// ── 阈值配置菜单 ──
async function showThresholdConfig(commands, wsPath) {
  const settings = readSettings();
  const currentPreset = settings.preset || "default";
  const preset = PRESETS[currentPreset] || PRESETS.default;

  const items = [
    { label: `● ${preset.label}`, description: "(当前)", action: "noop" },
    { label: "", action: "separator" },
  ];
  // 列出所有可选预设
  for (const [key, p] of Object.entries(PRESETS)) {
    if (key !== currentPreset) {
      items.push({ label: `○ ${p.label}`, action: "preset", presetKey: key });
    }
  }
  items.push({ label: "", action: "separator" });
  items.push({ label: "── 实时检测参数 ──", action: "sepDetect" });
  items.push({ label: `高相似度阈值 [${preset.jaccardThreshold}]`, description: "--high-sim", action: "setJaccard" });
  items.push({ label: `反转词阈值 [${preset.reversalMinCount}]`, description: "每200字命中数", action: "setReversal" });
  items.push({ label: `低信息增量阈值 [${preset.lowInfoThreshold}]`, description: "--low-info", action: "setLowInfo" });
  items.push({ label: `n-gram [${preset.infoNgram}]`, description: "--ngram", action: "setNgram" });
  items.push({ label: `连续停滞上限 [${preset.maxStall}]`, description: "maxStall", action: "setMaxStall" });
  items.push({ label: "", action: "separator" });
  items.push({ label: "── 健康分析参数 ──", action: "sepAnalysis" });
  items.push({ label: `有效反转信息增量 [${preset.infoGainThreshold}]`, description: "--info-gain", action: "setInfoGain" });
  items.push({ label: `语义转变阈值 [${preset.semanticShift}]`, description: "--semantic-shift", action: "setSemanticShift" });
  items.push({ label: `健康高分阈值 [${preset.scoreHigh}]`, description: "--score-high", action: "setScoreHigh" });
  items.push({ label: `健康低分阈值 [${preset.scoreLow}]`, description: "--score-low", action: "setScoreLow" });
  items.push({ label: `详细输出 ${preset.verbose ? "✅" : "❌"}`, description: "-v", action: "toggleVerbose" });
  items.push({ label: `语义模型 ${preset.useSemantic ? "✅" : "❌"}`, description: "--no-semantic 取反", action: "toggleSemantic" });
  items.push({ label: "", action: "separator" });
  items.push({ label: "恢复默认设置", action: "reset" });

  const choice = await vscode.window.showQuickPick(items, { placeHolder: "阈值配置 — 选择预设或调节单个参数" });
  if (!choice || choice.action === "noop" || choice.action.startsWith("sep")) return;

  if (choice.action === "preset" && choice.presetKey) {
    const p = PRESETS[choice.presetKey];
    writeSettings({ preset: choice.presetKey, ...p });
    sendReloadConfig(wsPath, commands);
    vscode.window.showInformationMessage(`已应用预设: ${p.label}`);
  } else if (choice.action === "reset") {
    writeSettings({ preset: "default", ...PRESETS.default });
    sendReloadConfig(wsPath, commands);
    vscode.window.showInformationMessage("已恢复默认设置");
  } else if (choice.action === "toggleVerbose") {
    writeSettings({ preset: "custom", verbose: !preset.verbose });
    vscode.window.showInformationMessage(`详细输出: ${preset.verbose ? "关闭" : "打开"}`);
  } else if (choice.action === "toggleSemantic") {
    writeSettings({ preset: "custom", useSemantic: !preset.useSemantic });
    vscode.window.showInformationMessage(`语义模型: ${preset.useSemantic ? "关闭" : "打开"}`);
  } else if (choice.action.startsWith("set")) {
    const paramConfig = {
      setJaccard: { prompt: "高相似度阈值 (0.50~1.00)", default: String(preset.jaccardThreshold), type: "float", min: 0.5, max: 1 },
      setReversal: { prompt: "反转词阈值 (1~20)", default: String(preset.reversalMinCount), type: "int", min: 1, max: 20 },
      setLowInfo: { prompt: "低信息增量阈值 (0.00~1.00)", default: String(preset.lowInfoThreshold), type: "float", min: 0, max: 1 },
      setNgram: { prompt: "n-gram (1~5)", default: String(preset.infoNgram), type: "int", min: 1, max: 5 },
      setMaxStall: { prompt: "连续停滞上限 (1~10)", default: String(preset.maxStall), type: "int", min: 1, max: 10 },
      setInfoGain: { prompt: "有效反转信息增量阈值 (0.00~1.00)", default: String(preset.infoGainThreshold), type: "float", min: 0, max: 1 },
      setSemanticShift: { prompt: "语义转变阈值 (0.00~1.00)", default: String(preset.semanticShift), type: "float", min: 0, max: 1 },
      setScoreHigh: { prompt: "健康高分阈值 (0~100)", default: String(preset.scoreHigh), type: "int", min: 0, max: 100 },
      setScoreLow: { prompt: "健康低分阈值 (0~100)", default: String(preset.scoreLow), type: "int", min: 0, max: 100 },
    }[choice.action];
    if (!paramConfig) return;

    const input = await vscode.window.showInputBox({
      prompt: paramConfig.prompt,
      value: paramConfig.default,
      validateInput: (v) => {
        const n = paramConfig.type === "int" ? parseInt(v) : parseFloat(v);
        return (!isNaN(n) && n >= paramConfig.min && n <= paramConfig.max) ? null : `取值 ${paramConfig.min}~${paramConfig.max}`;
      },
    });
    if (!input) return;

    const keyMap = {
      setJaccard: "jaccardThreshold", setReversal: "reversalMinCount", setLowInfo: "lowInfoThreshold",
      setNgram: "infoNgram", setMaxStall: "maxStall",
      setInfoGain: "infoGainThreshold", setSemanticShift: "semanticShift",
      setScoreHigh: "scoreHigh", setScoreLow: "scoreLow",
    };
    const newSettings = { preset: "custom" };
    newSettings[keyMap[choice.action]] = paramConfig.type === "int" ? parseInt(input) : parseFloat(input);
    writeSettings(newSettings);
    sendReloadConfig(wsPath, commands);
    vscode.window.showInformationMessage("阈值已更新");
  }
}

function sendReloadConfig(wsPath, commands) {
  commands.sendCommand("reloadConfig");
}

const ANALYZE_SCRIPT = path.join(MONITOR_DIR, "think_health_analyzer.py");

function runHealthAnalysis(wsPath) {
  if (!wsPath) { vscode.window.showInformationMessage("未检测到工作区"); return; }
  const settings = readSettings();
  const preset = PRESETS[settings.preset] || PRESETS.default;
  const args = [
    ANALYZE_SCRIPT, "--ws", wsPath,
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
      const proc = spawn("python", args, {
        cwd: MONITOR_DIR,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      let stdout = "", stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());
      proc.on("close", () => {
        if (stdout) {
          // 在 VS Code 中打开新文档显示报告
          vscode.workspace.openTextDocument({ content: stdout, language: "markdown" }).then(doc => {
            vscode.window.showTextDocument(doc);
          });
        } else {
          vscode.window.showErrorMessage("健康度分析失败: " + (stderr || "未知错误"));
        }
        resolve();
      });
      proc.on("error", (err) => {
        vscode.window.showErrorMessage("无法启动分析进程: " + err.message);
        resolve();
      });
    });
  });
}

const ACTIVATE_MARKER = path.join(MONITOR_DIR, ".deadloop-activated");

function activate(context) {
  try { fs.writeFileSync(ACTIVATE_MARKER, String(Date.now())); } catch {}
  console.log("[deadloop] activate START");
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  const wsPath = wsFolder?.uri.fsPath || "";
  const statusBar = new StatusBarManager(wsPath);

  const commands = {
    sendCommand: (cmd) => {
      if (cmd === "pause") { sendCommand(wsPath, "pause"); statusBar.updateState({ status: "paused", lastPoll: new Date().toLocaleTimeString() }); }
      else if (cmd === "resume") {
        if (statusBar.state.status === "stopped" || statusBar.state.status === "stopping") {
          startMonitor(wsPath, (s) => statusBar.updateState(s), statusBar);
        } else {
          sendCommand(wsPath, "resume");
        }
        statusBar.updateState({ status: "monitoring", lastPoll: new Date().toLocaleTimeString() });
      }
      else if (cmd === "stop") { stopMonitor(wsPath); statusBar.updateState({ status: "stopped" }); }
    },
  };

  statusBar.registerCommands(context, commands);
  const slug = wsPath.replace(/[:\\/.]/g, '-').toLowerCase();
  statusBar.updateState({
    workspace: wsPath,
    file: slug,
    lastPoll: new Date().toLocaleTimeString(),
    detectors: { repeat: true, reversal: true, info: true },
  });

  console.log("[deadloop] wsPath:", wsPath);
  if (wsPath) {
    try {
      startMonitor(wsPath, (s) => statusBar.updateState(s), statusBar);
      console.log("[deadloop] startMonitor returned, proc exists:", processes.has(wsPath));
    } catch (e) {
      console.error("[deadloop] startMonitor error:", e.message);
      try { fs.writeFileSync("c:/Users/LaiYangLi/.claude/.deadloop-error", e.message); } catch {}
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const f of event.added) startMonitor(f.uri.fsPath, (s) => statusBar.updateState(s));
      for (const f of event.removed) stopMonitor(f.uri.fsPath);
    }),
    statusBar
  );
}

function deactivate() {
  for (const [ws, proc] of processes) {
    try {
      const { execSync } = require("child_process");
      execSync("taskkill /f /pid " + proc.pid + " 2>nul");
    } catch {
      try { proc.kill(); } catch {}
    }
  }
  processes.clear();
}

module.exports = { activate, deactivate };
