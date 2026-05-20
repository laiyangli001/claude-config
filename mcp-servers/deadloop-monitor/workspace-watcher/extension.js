const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");

const MONITOR_SCRIPT = path.resolve(__dirname, "..", "monitor.mjs");
const processes = new Map();
const statusBarItems = new Map(); // workspacePath → StatusBarItem

function createStatusBarItem(workspacePath) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  item.command = "deadloop-watcher.showMenu";
  item.text = "$(pulse) 监控中";
  item.tooltip = `监控: ${workspacePath}\n点击打开控制菜单`;
  item.show();
  return item;
}

function updateStatusBar(workspacePath, status) {
  const item = statusBarItems.get(workspacePath);
  if (!item) return;
  const icons = {
    MONITORING: "$(pulse) 监控中",
    COOLDOWN: "$(sync~spin) 冷却中",
    HELPING: "$(error) 死循环!",
    PAUSED: "$(debug-pause) 已暂停",
    IDLE: "$(circle-outline) 等待中",
  };
  item.text = icons[status] || "$(question) " + status;
}

function startMonitor(workspacePath) {
  if (processes.has(workspacePath)) return;

  const proc = spawn("node", [MONITOR_SCRIPT], {
    cwd: workspacePath,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
  });

  processes.set(workspacePath, proc);

  // 记录 PID
  try {
    const pidFile = path.join(workspacePath, ".deadloop-pid");
    require("fs").writeFileSync(pidFile, String(proc.pid));
  } catch {}

  // 监听 stdout 事件
  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("DEADLOOP_DETECTED")) {
      vscode.window.showWarningMessage(
        "检测到 Claude Code 输出死循环！",
        "查看",
        "忽略"
      ).then((choice) => {
        if (choice === "查看") {
          vscode.commands.executeCommand(
            "workbench.action.terminal.focus"
          );
        }
      });
      updateStatusBar(workspacePath, "HELPING");
    } else if (text.includes("NEEDS_MANUAL")) {
      vscode.window.showErrorMessage(
        "自动中断失败，请手动 Ctrl+C 终止 Claude Code"
      );
    } else {
      // 尝试解析 JSON 状态更新
      try {
        const json = JSON.parse(text.trim());
        if (json.status) {
          updateStatusBar(workspacePath, json.status.toUpperCase());
        }
      } catch {}
    }
  });

  proc.on("exit", () => {
    processes.delete(workspacePath);
    const item = statusBarItems.get(workspacePath);
    if (item) { item.hide(); item.dispose(); statusBarItems.delete(workspacePath); }
  });

  proc.on("error", (err) => {
    processes.delete(workspacePath);
  });
}

function stopMonitor(workspacePath) {
  const proc = processes.get(workspacePath);
  if (!proc) return;
  proc.stdin.write(JSON.stringify({ command: "stop" }) + "\n");
  setTimeout(() => {
    if (processes.has(workspacePath)) {
      proc.kill("SIGTERM");
      processes.delete(workspacePath);
    }
  }, 3000);
}

function sendCommand(workspacePath, command) {
  const proc = processes.get(workspacePath);
  if (!proc) return;
  proc.stdin.write(JSON.stringify({ command }) + "\n");
}

function activate(context) {
  // 注册控制菜单命令
  context.subscriptions.push(
    vscode.commands.registerCommand("deadloop-watcher.showMenu", async () => {
      const activeFolder = vscode.workspace.workspaceFolders?.[0];
      if (!activeFolder) {
        vscode.window.showInformationMessage("没有打开的工作区");
        return;
      }
      const wsPath = activeFolder.uri.fsPath;
      const proc = processes.get(wsPath);

      const options = [];
      if (proc) {
        options.push("暂停监控", "停止监控", "查看状态");
      } else {
        options.push("启动监控");
      }

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: `监控控制: ${wsPath}`,
      });

      if (!choice) return;
      if (choice === "启动监控") startMonitor(wsPath);
      else if (choice === "暂停监控") sendCommand(wsPath, "pause");
      else if (choice === "停止监控") stopMonitor(wsPath);
      else if (choice === "查看状态") sendCommand(wsPath, "status");
    })
  );

  // 为当前工作区启动监控 + 状态栏
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const wsPath = folder.uri.fsPath;
    statusBarItems.set(wsPath, createStatusBarItem(wsPath));
    startMonitor(wsPath);
  }

  // 工作区变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.added) {
        const p = folder.uri.fsPath;
        statusBarItems.set(p, createStatusBarItem(p));
        startMonitor(p);
      }
      for (const folder of event.removed) {
        const p = folder.uri.fsPath;
        stopMonitor(p);
        const item = statusBarItems.get(p);
        if (item) { item.dispose(); statusBarItems.delete(p); }
      }
    })
  );
}

function deactivate() {
  for (const [ws, proc] of processes) {
    proc.kill("SIGTERM");
  }
  processes.clear();
  for (const [ws, item] of statusBarItems) {
    item.dispose();
  }
  statusBarItems.clear();
}

module.exports = { activate, deactivate };
