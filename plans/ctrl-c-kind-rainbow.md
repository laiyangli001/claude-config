# MCP 服务文件夹重组方案

## 变更内容

### 1. 新建 `ai-services/` — 存放外部 AI 网页服务
将 `mcp-chatgpt-mirror/`、`mcp-chatgpt-official/`、`mcp-deepseek/`、`mcp-doubao/` 移入，同时去掉 `mcp-` 前缀。

### 2. 新建 `office-tools/` — 存放办公文档工具
将 `scripts/` 移入 `mcp-servers/` 并改名 `office-tools/`。`setup-proxy.mjs` 和 `proxy-detect.sh` 不是office-tools，移回根目录。

## 目录结构对比

### 整理前
```
mcp-servers/
├── mcp-chatgpt-mirror/   # ChatGPT 镜像站
├── mcp-chatgpt-official/ # ChatGPT 官方站
├── mcp-deepseek/         # DeepSeek 网页版
├── mcp-doubao/           # 豆包 AI
├── shared/               # 共享模块
├── roles/                # 角色模板
├── python3.13.3/         # 内嵌 Python
├── node_modules/         # 依赖
├── install-mcp-config.mjs
└── ...

scripts/
├── md-to-pdf.mjs
├── md-preview.mjs
├── _gen-custom.mjs
├── themes/
├── setup-proxy.mjs       # 代理配置
└── proxy-detect.sh       # 代理配置
```

### 整理后
```
mcp-servers/                    # 所有服务统一目录
├── ai-services/                  # 免费多模态 AI 网页服务
│   ├── chatgpt-mirror/
│   ├── chatgpt-official/
│   ├── deepseek/
│   ├── doubao/
│   ├── shared/                   # AI 服务共享模块
│   └── roles/                    # AI 角色模板
├── office-tools/               # 办公文档工具
│   ├── md-to-pdf.mjs
│   ├── md-preview.mjs
│   ├── themes/
│   └── ...
├── deadloop-monitor/           # 死循环监控（名称不变）
│   ├── stop-hook.mjs
│   ├── config.mjs
│   ├── helpers.mjs
│   └── ...
├── python3.13.3/               # 内嵌 Python（各服务公用）
├── node_modules/               # 依赖（各服务公用）
├── install-mcp-config.mjs      # MCP 注册脚本
└── ...

scripts/                        # 仅保留代理工具
├── setup-proxy.mjs
└── proxy-detect.sh
```

## 需更新的引用

| 文件 | 修改内容 |
|------|----------|
| `install-mcp-config.mjs` | `mcp-xxx` → `ai-services/xxx` |
| `.mcp.json` | 4 处绝对路径更新 |
| 各服务 `src/index.ts` | `../../shared/` → `../shared/`、`../../roles/` → `../roles/` |
| `md-to-pdf.mjs`（office-tools内） | `../mcp-servers/` → `../`（同级目录） |
| `md-preview.mjs`（office-tools内） | `../mcp-servers/` → `../` |
| `_gen-custom.mjs`（office-tools内） | 硬编码绝对路径 `c:/Users/LaiYangLi/.claude/mcp-servers/` → `../` 相对路径 |
| `settings.json` | stop-hook 路径 `deadloop-monitor/` → `mcp-servers/deadloop-monitor/` |
| `extension.js` | MONITOR_DIR 路径更新 |
| `.bashrc` | `proxy-detect.sh` 路径更新 |
| `.gitignore` | `deadloop-monitor/` 路径规则更新 |
| `install-deadloop.bat` | `%~dp0..\deadloop-monitor` → `%~dp0mcp-servers\deadloop-monitor` |

## 操作步骤
1. 创建 `ai-services/`，移动 4 个服务并改名，将 `shared/` 和 `roles/` 也移入
2. 批量修改每个 AI 服务内的 `src/index.ts`：`../../shared/` → `../shared/`、`../../roles/` → `../roles/`（如有）
3. 在每个 AI 服务目录中运行 `tsc` 重新编译
4. 创建 `office-tools/`，将 `scripts/` 下的 `md-to-pdf.mjs`、`md-preview.mjs`、`_gen-custom.mjs`、`themes/`、`css-extract-sample.md`、`css-extract-sample.html` 移入
5. 修改 office-tools 内 `.mjs` 中 `../mcp-servers/` → `../`（移至同目录下），`_gen-custom.mjs` 的硬编码绝对路径改为相对路径
6. `setup-proxy.mjs` 和 `proxy-detect.sh` 保留在根目录 `scripts/`
7. 移动 `deadloop-monitor/` 到 `mcp-servers/` 下
8. 更新 `install-mcp-config.mjs`：`mcp-xxx` → `ai-services/xxx`
9. 更新 `.mcp.json` 中 4 处绝对路径
10. 更新 `settings.json` 中 stop-hook 路径：`deadloop-monitor/` → `mcp-servers/deadloop-monitor/`
11. 更新 `extension.js` 中 MONITOR_DIR
12. 更新 `install-deadloop.bat`：`%~dp0..\deadloop-monitor` → `%~dp0mcp-servers\deadloop-monitor`
13. 检查 `.bashrc`：如 proxy-detect.sh 路径已指向正确的根目录 `scripts/` 则跳过，否则修正
14. 更新 `.gitignore`：`deadloop-monitor/` → `mcp-servers/deadloop-monitor/`
15. 执行 `node install-mcp-config.mjs` 更新 `~/.claude.json`
16. 清理空目录和过时文件
17. 测试验证
