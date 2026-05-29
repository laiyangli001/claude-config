// 在 ~/.claude.json 中写入 MCP 服务路径
// 已存在的服务不会被覆盖（合并模式）
import fs from "fs";
import path from "path";
import os from "os";

const configPath = path.join(os.homedir(), ".claude.json");
const serversDir = path.resolve(import.meta.dirname);

const mcpServers = {
  "deepseek": {
    command: "cmd",
    args: ["/c", "node", path.join(serversDir, "mcp-deepseek", "dist", "index.js")],
  },
  "chatgpt-mirror": {
    command: "cmd",
    args: ["/c", "node", path.join(serversDir, "mcp-chatgpt-mirror", "dist", "index.js")],
  },
  "chatgpt-official": {
    command: "cmd",
    args: ["/c", "node", path.join(serversDir, "mcp-chatgpt-official", "dist", "index.js")],
  },
  "doubao": {
    command: "cmd",
    args: ["/c", "node", path.join(serversDir, "mcp-doubao", "dist", "index.js")],
  },
  "mineru-open-mcp": {
    command: "uvx",
    args: ["mineru-open-mcp"],
    env: { MINERU_API_TOKEN: "${MINERU_API_TOKEN}" },
  },
};

let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log(`[install] ${configPath} exists, merging MCP servers...`);
} catch {
  console.log(`[install] ${configPath} not found, creating new...`);
}

// 合并模式：保留已有服务，新增/覆盖本项目定义的服务
config.mcpServers = { ...config.mcpServers, ...mcpServers };

// 清理残留的旧 D: 盘配置
for (const [key, val] of Object.entries(config.mcpServers)) {
  const args = val.args || [];
  if (args.some((a) => typeof a === "string" && /^d:\/claude_mcp/i.test(a.replace(/\\/g, "/")))) {
    delete config.mcpServers[key];
    console.log(`  [cleanup] removed stale D: drive entry: ${key}`);
  }
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
console.log("[install] MCP servers merged:");
for (const [name, srv] of Object.entries(mcpServers)) {
  console.log(`  ${name} -> ${srv.args.join(" ")}`);
}
