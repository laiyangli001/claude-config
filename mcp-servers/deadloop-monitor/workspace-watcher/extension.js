const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const MONITOR_SCRIPT = "c:/Users/LaiYangLi/.claude/mcp-servers/deadloop-monitor/monitor.mjs";
const LOG_FILE = "c:/Users/LaiYangLi/.claude/mcp-servers/deadloop-monitor/monitor-output.log";

class StatusBarManager {
  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "循环守护";
    this.state = {
      status: "stopped",
      workspace: "", file: "",
      detectors: { repeat: true, reversal: true, info: true },
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
      case "cooling": icon = "$(sync~spin)"; tooltipStatus = "🌀 冷却中（剩余 ${cooldownLeft} 秒）"; break;
      case "alert": icon = "$(error)"; tooltipStatus = "🔴 检测到死循环！"; this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground"); break;
      case "intervention_needed": icon = "$(warning)"; tooltipStatus = "⚠️ 需手动干预"; this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground"); break;
      case "stopped": case "stopping": icon = "$(circle-slash)"; tooltipStatus = "⚪ 已停止"; break;
      default: tooltipStatus = "❓ 未知状态";
    }
    this.item.text = icon + " 循环守护";
    const { stopReason, stopHint } = this.state;
    this.item.tooltip = this.buildTooltip(tooltipStatus, workspace, file, detectors, lastPoll, tokenCount, lastTrigger, cooldownLeft, stopReason, stopHint);
    this.item.show();
  }

  buildTooltip(statusLine, workspace, file, detectors, lastPoll, tokenCount, lastTrigger, cooldownLeft, stopReason, stopHint) {
    const ds = [
      "重复代码块: " + (detectors?.repeat ? "✅" : "❌"),
      "反转词密度: " + (detectors?.reversal ? "✅" : "❌"),
      "信息增量率: " + (detectors?.info ? "✅" : "❌"),
    ].join("   ");
    return [
      "循环守护    " + statusLine,
      "──────────────────────────────",
      "工作区: " + (workspace || "未知"),
      "监控文件: " + (file || "未知"),
      "检测器: " + ds,
      lastPoll ? "最后轮询: " + lastPoll : "",
      "本轮 token: " + tokenCount.toLocaleString() + " / 10,000",
      lastTrigger ? "最近触发: " + lastTrigger : "最近触发: 暂无",
      cooldownLeft > 0 ? "冷却剩余: " + cooldownLeft + " 秒" : "",
      stopReason ? "停止原因: " + stopReason : "",
      stopHint ? "提示: " + stopHint : "",
      "──────────────────────────────",
      "鼠标左键 → 打开菜单",
    ].filter(Boolean).join("\n");
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
      options.push({ label: "📋 查看日志", action: "viewLog" });
      const choice = await vscode.window.showQuickPick(options, { placeHolder: "循环守护 – 选择操作" });
      if (!choice) return;
      if (choice.action === "viewLog") {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(LOG_FILE));
          await vscode.window.showTextDocument(doc);
        } catch (e) { vscode.window.showInformationMessage("日志文件暂不可用"); console.error(e); }
      } else { commands.sendCommand(choice.action); }
    }));
    this.item.command = cmdId;
  }

  dispose() { this.item.dispose(); }
}

// ── 进程管理 ──
const processes = new Map();

function startMonitor(workspacePath, onStatusUpdate) {
  if (processes.has(workspacePath)) return;

  const proc = spawn("node", [MONITOR_SCRIPT], {
    cwd: workspacePath,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
    windowsHide: true,
  });

  processes.set(workspacePath, proc);

  const heartbeatFile = path.join(workspacePath, ".deadloop-heartbeat");
  try { fs.writeFileSync(path.join(workspacePath, ".deadloop-pid"), String(proc.pid)); } catch (e) { console.error(e); }

  let stdoutBuf = "";

  const stdoutHandler = (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line.trim());
        const upd = { status: json.status.toLowerCase(), lastPoll: new Date().toLocaleTimeString() };
        if (typeof json.tokenCount === "number") upd.tokenCount = json.tokenCount;
        onStatusUpdate(upd);
      } catch (e) {
        if (line.includes("DEADLOOP_DETECTED")) {
          vscode.window.showWarningMessage("检测到 Claude Code 输出死循环！", "查看", "忽略")
            .then(choice => { if (choice === "查看") vscode.commands.executeCommand("workbench.action.terminal.focus"); });
          onStatusUpdate({ status: "alert", lastTrigger: new Date().toLocaleTimeString(), lastPoll: new Date().toLocaleTimeString() });
        } else if (line.includes("NEEDS_MANUAL")) {
          vscode.window.showErrorMessage("自动中断失败，请手动 Ctrl+C 终止 Claude Code");
          onStatusUpdate({ status: "intervention_needed", lastTrigger: new Date().toLocaleTimeString(), lastPoll: new Date().toLocaleTimeString() });
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
  };

  // 心跳文件检测：monitor.mjs 每 2 秒写文件，扩展每 3 秒读 mtime
  const checkInterval = setInterval(() => {
    try {
      const age = Date.now() - fs.statSync(heartbeatFile).mtimeMs;
      if (age > 10000) {
        cleanUp();
      }
    } catch {
      // 文件不存在或无权限 → 进程可能已死
      cleanUp();
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

function activate(context) {
  console.log("[deadloop] activate START");
  const statusBar = new StatusBarManager();
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  const wsPath = wsFolder?.uri.fsPath || "";

  const commands = {
    sendCommand: (cmd) => {
      if (cmd === "pause") { sendCommand(wsPath, "pause"); statusBar.updateState({ status: "paused", lastPoll: new Date().toLocaleTimeString() }); }
      else if (cmd === "resume") { sendCommand(wsPath, "resume"); statusBar.updateState({ status: "monitoring", lastPoll: new Date().toLocaleTimeString() }); }
      else if (cmd === "stop") { stopMonitor(wsPath); statusBar.updateState({ status: "stopped" }); }
    },
  };

  statusBar.registerCommands(context, commands);
  statusBar.updateState({
    workspace: wsPath,
    file: "projects/*/xxx.jsonl",
    lastPoll: new Date().toLocaleTimeString(),
    detectors: { repeat: true, reversal: true, info: true },
  });

  console.log("[deadloop] wsPath:", wsPath);
  if (wsPath) {
    startMonitor(wsPath, (s) => statusBar.updateState(s));
    console.log("[deadloop] startMonitor returned, proc exists:", processes.has(wsPath));
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
