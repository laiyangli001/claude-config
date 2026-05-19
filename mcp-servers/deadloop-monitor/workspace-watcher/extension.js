const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");

// monitor.mjs 的绝对路径（相对于本文件）
const MONITOR_SCRIPT = path.resolve(__dirname, "..", "monitor.mjs");

/** 每个工作区 -> 子进程 */
const processes = new Map();

function startMonitor(workspacePath) {
  if (processes.has(workspacePath)) return;

  const proc = spawn("node", [MONITOR_SCRIPT], {
    cwd: workspacePath,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env },
  });

  processes.set(workspacePath, proc);

  proc.on("exit", (code) => {
    processes.delete(workspacePath);
  });

  proc.on("error", (err) => {
    console.error(`[deadloop-watcher] Failed to start monitor for ${workspacePath}: ${err.message}`);
    processes.delete(workspacePath);
  });
}

function stopMonitor(workspacePath) {
  const proc = processes.get(workspacePath);
  if (!proc) return;
  proc.kill("SIGTERM");
  processes.delete(workspacePath);
}

function activate(context) {
  // 为当前已打开的工作区启动监控
  for (const folder of vscode.workspace.workspaceFolders || []) {
    startMonitor(folder.uri.fsPath);
  }

  // 监听工作区变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.added) {
        startMonitor(folder.uri.fsPath);
      }
      for (const folder of event.removed) {
        stopMonitor(folder.uri.fsPath);
      }
    })
  );
}

function deactivate() {
  for (const [workspacePath, proc] of processes) {
    proc.kill("SIGTERM");
  }
  processes.clear();
}

module.exports = { activate, deactivate };
