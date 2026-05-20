// 自动安装 workspace-watcher VS Code 扩展到 ~/.vscode/extensions/
import fs from "fs";
import path from "path";
import os from "os";

const EXT_NAME = "laiyangli.deadloop-workspace-watcher";
const EXT_VERSION = "1.0.0";
const INSTALL_DIR = path.join(
  os.homedir(), ".vscode", "extensions", `${EXT_NAME}-${EXT_VERSION}`
);
const SRC_DIR = path.resolve(import.meta.dirname, "workspace-watcher");

// 检查是否已安装
if (fs.existsSync(INSTALL_DIR)) {
  console.log("[deadloop] extension already installed at", INSTALL_DIR);
  process.exit(0);
}

// 复制文件
try {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  for (const file of ["package.json", "extension.js"]) {
    fs.copyFileSync(
      path.join(SRC_DIR, file),
      path.join(INSTALL_DIR, file)
    );
  }
  console.log("[deadloop] extension installed to", INSTALL_DIR);
  console.log("[deadloop] reload VS Code to activate (Ctrl+Shift+P → Reload Window)");
} catch (err) {
  console.error("[deadloop] extension install failed:", err.message);
  // 不阻塞主流程
  process.exit(0);
}
