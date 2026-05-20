import fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ── MCP Client 工厂 ──
export async function createStdioMcpClient(command, args, name = "deadloop-monitor", requestTimeout = 300000) {
  const client = new Client({ name, version: "1.0.0" }, { requestTimeout });
  const transport = new StdioClientTransport({ command, args });
  await client.connect(transport);
  return client;
}

// ── 输出清洗 ──
const ANSI_RE = /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const TOOL_CALL_RE = /<tool_result>[\s\S]*?<\/tool_result>|<invoke>[\s\S]*?<\/invoke>|<result>[\s\S]*?<\/result>/g;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*?\]?\s*/gm;

export function cleanAssistantOutput(text) {
  if (!text) return "";
  return text
    .replace(ANSI_RE, "")
    .replace(TOOL_CALL_RE, "")
    .replace(TIMESTAMP_RE, "")
    .replace(/[ \t]+/g, " ")     // 合并连续空格和 tab，保留换行
    .split("\n")
    .map(l => l.trim())
    .join("\n")
    .trim();
}

// ── .jsonl 行解析 ──
export function parseJsonlLine(line) {
  try {
    const parsed = JSON.parse(line);
    // role 可能在 message.role 或顶层 type
    const role = parsed.message?.role || parsed.type || "";
    // content 在 message.content 数组中
    const contentArr = parsed.message?.content;
    let content = "";
    if (Array.isArray(contentArr)) {
      content = contentArr
        .filter(c => c.type === "text" || c.type === "thinking")
        .map(c => c.text || "")
        .join("\n");
    } else if (typeof contentArr === "string") {
      content = contentArr;
    }
    return { role, content };
  } catch {
    return null;
  }
}

// ── 增量文件读取器 ──
export class JsonlReader {
  constructor(filePath) {
    this.filePath = filePath;
    this.lastSize = 0;
    this.buffer = "";
  }

  readLines() {
    const { size, fd, ok } = this._open();
    if (!ok) return [];

    const buf = Buffer.alloc(size - this.lastSize);
    fs.readSync(fd, buf, 0, buf.length, this.lastSize);
    fs.closeSync(fd);
    this.lastSize = size;

    this.buffer += buf.toString("utf-8");

    const parts = this.buffer.split("\n");
    if (!this.buffer.endsWith("\n")) {
      this.buffer = parts.pop() || "";
    } else {
      this.buffer = "";
    }
    return parts.filter(Boolean);
  }

  reset() {
    this.lastSize = 0;
    this.buffer = "";
  }

  _open() {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size < this.lastSize) { this.reset(); return { size: 0, fd: null, ok: false }; }
      if (stat.size === this.lastSize) return { size: 0, fd: null, ok: false };
      const fd = fs.openSync(this.filePath, "r");
      return { size: stat.size, fd, ok: true };
    } catch {
      return { size: 0, fd: null, ok: false };
    }
  }
}

// ── PowerShell SendKeys 注入 ──
import { execSync } from "child_process";
import os from "os";

const PS_PRE = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
'@

$result = @([IntPtr]::Zero)
$cb = {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder(256)
    [Win32]::GetWindowText($hWnd, $sb, 256)
    if ($sb.ToString() -match "- Visual Studio Code$$") {
        $result[0] = $hWnd
        return $false
    }
    return $true
}
[Win32]::EnumWindows($cb, [IntPtr]::Zero)
$hwnd = $result[0]
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "NOT_FOUND"; exit 1 }
if ([Win32]::IsIconic($hwnd)) { [Win32]::ShowWindow($hwnd, 9) }
[Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 300
# Ctrl+A 全选（清除当前输入），然后粘贴，延时后按 Enter
(New-Object -ComObject WScript.Shell).SendKeys('^a')
Start-Sleep -Milliseconds 200
(New-Object -ComObject WScript.Shell).SendKeys('^v')
Start-Sleep -Milliseconds 800
(New-Object -ComObject WScript.Shell).SendKeys('~^~')
Start-Sleep -Milliseconds 200
Write-Host "OK"
`;

export function injectToTerminal(text) {
  // 步骤 1: 把文本写入剪贴板（UTF-8 编码文件 + Get-Content -Encoding UTF8）
  const tmpText = os.tmpdir() + "/deadloop_text.txt";
  fs.writeFileSync(tmpText, text, "utf-8");
  try {
    execSync(
      `powershell -ExecutionPolicy Bypass -Command "Get-Content -Encoding UTF8 -Path '${tmpText}' | Set-Clipboard"`,
      { timeout: 5000 }
    );
  } catch {
    try { fs.unlinkSync(tmpText); } catch {}; return false;
  }
  // 步骤 2: 激活 VSCode 窗口 + Ctrl+A + Ctrl+V + Enter
  const tmpFile = os.tmpdir() + "/deadloop_inject.ps1";
  fs.writeFileSync(tmpFile, "﻿" + PS_PRE);
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { timeout: 10000 });
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
    try { fs.unlinkSync(tmpText); } catch {}
  }
}

function buildEscScript() {
  const escKeys = `# 发送 ESC 中断（已验证可打断 Claude Code）
(New-Object -ComObject WScript.Shell).SendKeys('{ESC}')
Start-Sleep -Milliseconds 500
Write-Host "OK"
`;
  const base = PS_PRE.replace(/# Ctrl\+A[\s\S]*/, "");
  return base + escKeys;
}

export function sendCtrlC() {
  const tmpFile = os.tmpdir() + "/deadloop_esc.ps1";
  fs.writeFileSync(tmpFile, "﻿" + buildEscScript());
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { timeout: 10000 });
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── 停止确认检查 ──
export function checkStopReason(line) {
  try {
    const j = JSON.parse(line);
    const sr = j.message?.stop_reason;
    const interrupted = j.interrupted;
    // stop_reason 为 end_turn → 自然结束
    // stop_reason 为 undefined 且 interrupted=true → 被打断
    if (sr === "end_turn") return "stopped";
    if (interrupted === true) return "interrupted";
    if (sr === "tool_use") return "running";
    if (!sr) return "interrupted"; // 未完成的流式输出
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ── 对话窗口 ──
export class DialogWindow {
  constructor(maxRounds = 5) {
    this.maxRounds = maxRounds;
    this.messages = [];
  }

  add(role, content) {
    this.messages.push({ role, content });
    const userCount = this.messages.filter(m => m.role === "user").length;
    if (userCount > this.maxRounds) {
      const firstUser = this.messages.findIndex(m => m.role === "user");
      if (firstUser >= 0) this.messages.splice(0, firstUser + 1);
    }
  }

  getRecent() {
    return this.messages.slice(-this.maxRounds * 2);
  }

  reset() {
    this.messages = [];
  }
}
