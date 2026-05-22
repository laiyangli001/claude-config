// 在 C:\Users\<用户名>\.claude.json 中写入 MCP 服务路径
// 如果文件已存在，合并写入，不会覆盖其他配置
import fs from "fs";
import path from "path";
import os from "os";

const configPath = path.join(os.homedir(), ".claude.json");
const serversDir = path.resolve(import.meta.dirname); // mcp-servers/

const mcpServers = {
  deepseek: {
    command: "cmd",
    args: ["/c", "node", path.join(serversDir, "deepseek-mcp", "dist", "index.js")],
  },
  "chatgpt-mirror": {
    command: "cmd",
    args: ["/c", "node", path.join(serversDir, "chatgpt-mirror-mcp", "dist", "index.js")],
  },
  "chatgpt-official": {
    command: "cmd",
    args: ["/c", "node", path.join(serversDir, "chatgpt-official-mcp", "dist", "index.js")],
  },
};

let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log(`[install] ${configPath} exists, merging MCP servers...`);
} catch {
  console.log(`[install] ${configPath} not found, creating new...`);
}

config.mcpServers = mcpServers;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
console.log("[install] MCP servers written:");
console.log(`  deepseek -> ${mcpServers.deepseek.args[2]}`);
console.log(`  chatgpt  -> ${mcpServers.chatgpt.args[2]}`);
