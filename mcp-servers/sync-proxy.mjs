#!/usr/bin/env node
// 同步 Windows 系统代理设置到用户环境变量
// VPN 切换服务器后执行：node sync-proxy.mjs
import { execSync } from "child_process";

// ── 读取当前系统代理 ──
let proxyServer = "";
try {
  const raw = execSync(
    `powershell -NoProfile -Command "& { $r = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if ($r.ProxyEnable -eq 1) { Write-Host $r.ProxyServer } }"`,
    { encoding: "utf-8", timeout: 5000 }
  ).trim();
  if (raw) proxyServer = raw;
} catch {}

// ── 同步到用户环境变量 ──
if (!proxyServer) {
  console.log("System proxy is disabled. Clearing HTTP_PROXY...");
  execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('HTTP_PROXY', $null, 'User'); [Environment]::SetEnvironmentVariable('HTTPS_PROXY', $null, 'User')"`, { timeout: 5000 });
  console.log("Done. New processes will connect directly.");
} else {
  const url = `http://${proxyServer}`;
  console.log(`System proxy: ${proxyServer}`);
  execSync(`setx HTTP_PROXY "${url}"`, { timeout: 3000 });
  execSync(`setx HTTPS_PROXY "${url}"`, { timeout: 3000 });
  console.log(`Env vars synced to ${url}`);
  console.log("Restart VS Code / open new terminal to apply.");
}
