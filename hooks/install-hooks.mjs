#!/usr/bin/env node
import { writeFileSync, appendFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { execSync } from "child_process";

const isUpdate = process.argv.includes("--update");
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = process.cwd();
const hookScript = resolve(__dirname, "tool-check-hook.js");
const rulesFile = resolve(__dirname, "rules.json");
const settingsFile = resolve(projectDir, ".claude", "settings.local.json");
const gitignoreFile = resolve(projectDir, ".gitignore");
const globalConfigPath = resolve(homedir(), ".claude.json");

// ── 读取全局 .claude.json ──
let globalConfig = { mcpServers: {} };
if (existsSync(globalConfigPath)) {
  globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
  if (!globalConfig.mcpServers) globalConfig.mcpServers = {};
}
const mcpServers = globalConfig.mcpServers;
const hasMcp = (name) => !!mcpServers[name];

console.log("[1] === MCP 服务安装 ===");

// ── file_system MCP ──
if (!hasMcp("file_system")) {
  console.log("[...] Installing file_system MCP...");
  try {
    execSync("npx -y @modelcontextprotocol/server-filesystem --help", {
      stdio: "pipe", timeout: 30000,
    });
    mcpServers.file_system = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem",
             projectDir.replace(/\\/g, "/"),
             resolve(homedir(), ".claude").replace(/\\/g, "/")],
    };
    console.log("[OK] file_system MCP configured");
  } catch {
    console.log("[WARN] @modelcontextprotocol/server-filesystem not available; install with: npm install -g @modelcontextprotocol/server-filesystem");
  }
} else {
  console.log("[SKIP] file_system MCP already configured");
}

// ── codegraph MCP ──
if (!hasMcp("codegraph")) {
  console.log("[...] Checking codegraph...");
  try {
    execSync("codegraph --version", { stdio: "pipe", timeout: 5000 });
    mcpServers.codegraph = {
      type: "stdio",
      command: "codegraph",
      args: ["serve", "--mcp"],
    };
    console.log("[OK] codegraph MCP configured");
  } catch {
    console.log("[WARN] codegraph not found. Install from: https://github.com/laiyangli001/codegraph");
  }
} else {
  console.log("[SKIP] codegraph MCP already configured");
}

// ── 写入 .claude.json ──
const globalConfigChanged = JSON.stringify(globalConfig) !==
  (existsSync(globalConfigPath) ? readFileSync(globalConfigPath, "utf-8") : "");
if (globalConfigChanged) {
  writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2) + "\n");
  console.log("[OK] ~/.claude.json updated");
}

console.log("\n[2] === 检测 MCP 服务 ===");
for (const [name] of Object.entries(mcpServers)) {
  console.log(`  ${name}`);
}

// ── 已知 MCP 映射表 ──
// 已知映射从工具名 → 拦截哪些内置工具
const KNOWN_MCP_RULES = {
  file_system: {
    Read:  { blockWhen: "inProject", msg: "项目内的文件用 file_system read_text_file，不要用 Read" },
    Edit:  { blockWhen: "inProject", msg: "改项目文件用 file_system edit_file，不要用 Edit" },
    Write: { blockWhen: "inProject", msg: "写项目文件用 file_system write_file，不要用 Write" },
    Glob:  { blockWhen: "always",    msg: "搜文件用 file_system search_files，不要用 Glob" },
    Bash:  { blockWhen: "cmdMatch:^(cat|head|tail|echo|sed|awk)\\s", msg: "文件操作用 file_system，不要用 Bash" },
  },
  codegraph: {
    Grep:  { blockWhen: "always",    msg: "查代码用 codegraph_explore/search/node，不要用 Grep" },
  },
  "mineru-open-mcp": {
    Read:  { blockWhen: "extMatch:\.(pdf|docx|doc|pptx|xlsx|xls)$", msg: "读文档用 mineru parse_documents，不要用 Read" },
  },
  "pdf-toolkit": {
    Read:  { blockWhen: "extMatch:\.pdf$", msg: "读 PDF 用 pdf-toolkit pdf_extract_text/pdf_to_markdown，不要用 Read" },
  },
  "chatgpt-mirror": {},
  "doubao": {},
  "claude-mirror": {},
  "chatgpt-official": {},
  "claude-code-mcp-unity": {},
};

// ── 根据 MCP 生成钩子规则（按优先级合并） ──
const rules = {};
const unknown = [];
const PRIORITY = ["mineru-open-mcp", "pdf-toolkit", "file_system", "codegraph"];

const sortedMCPs = Object.keys(mcpServers).sort((a, b) => {
  const pa = PRIORITY.indexOf(a);
  const pb = PRIORITY.indexOf(b);
  return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
});

for (const name of sortedMCPs) {
  const mcpRules = KNOWN_MCP_RULES[name];
  if (!mcpRules) { unknown.push(name); continue; }
  for (const [toolName, rule] of Object.entries(mcpRules)) {
    if (!rule) continue;  // 空规则 = 已知但无需监督
    if (!rules[toolName]) rules[toolName] = [];
    rules[toolName].push(rule);
  }
}

if (unknown.length > 0) {
  console.log("");
  console.log("[NEW] 以下 MCP 服务无监督规则，需要 Claude 分析映射：");
  for (const name of unknown) {
    console.log(`  ${name}`);
  }
  writeFileSync(resolve(__dirname, ".unknown-mcps.json"), JSON.stringify(unknown, null, 2) + "\n");
  console.log("[INFO] 已写入 .unknown-mcps.json，下次工具调用时 Claude 会收到提醒");
} else {
  // 清理旧标记
  const marker = resolve(__dirname, ".unknown-mcps.json");
  if (existsSync(marker)) try { writeFileSync(marker, "[]\n"); } catch {}
}

const toolNames = Object.keys(rules);
if (toolNames.length === 0) {
  console.log("[SKIP] No supervised MCP servers. Nothing to install.");
  process.exit(0);
}

// ── 添加始终注入的提醒 ──
rules._reminders = [
  "思考过程必须使用中文。所有思考、推理、分析、内部对话一律使用中文。"
];

// ── 写入 rules.json（到全局 hooks 目录）──
writeFileSync(rulesFile, JSON.stringify(rules, null, 2) + "\n");
console.log(`[OK] rules.json (${toolNames.length} rules)`);

// ── 写入 settings.local.json ──
const installScript = fileURLToPath(import.meta.url);

const settings = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          { type: "command", command: "node", args: [installScript, "--update"], timeout: 30 },
        ],
      },
    ],
    PreToolUse: toolNames.map((matcher) => ({
      matcher,
      hooks: [
        { type: "command", command: "node", args: [hookScript], timeout: 5 },
      ],
    })),
  },
};
writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
console.log(`[OK] settings.local.json (${toolNames.length} matchers)`);

// ── .gitignore ──
if (!readFileSync(gitignoreFile, "utf-8").includes(".claude/settings.local.json")) {
  appendFileSync(gitignoreFile, "\n.claude/settings.local.json\n");
  console.log("[OK] Added to .gitignore");
} else {
  console.log("[SKIP] Already in .gitignore");
}

const mode = isUpdate ? "UPDATE" : "INSTALL";
console.log(`\n[DONE] ${mode} complete. Tools supervised: ${toolNames.join(", ")}`);
console.log("[NEXT] Reload VS Code Window → Ctrl+Shift+P → Developer: Reload Window");
