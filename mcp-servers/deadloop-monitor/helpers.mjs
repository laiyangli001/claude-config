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
