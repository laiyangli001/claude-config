## 浏览器自动化健壮性改造计划

### 背景
当前 MCP 服务在调用浏览器访问 AI 网站时，缺乏系统性的网络检测、重试和错误处理机制。经常出现：
- 网站响应慢导致超时
- 网络波动导致连接重置
- 页面加载异常导致无错误提示
- 同一问题多次重试没有退避策略

### 目标
为所有 MCP 服务（mcp-chatgpt-mirror、mcp-chatgpt-official、mcp-deepseek、mcp-doubao）增加统一的：
1. **网络健康检测** — 调用前检测目标网站是否可达
2. **指数退避重试** — 按错误类型分级重试
3. **错误分类** — 瞬时/永久/限流，不同策略
4. **页面加载监控** — 监听 pageerror、超时、关键元素
5. **浏览器健康检查** — 心跳检测、僵尸页面回收

### 涉及文件

| 文件 | 改动 |
|------|------|
| `mcp-servers/shared/browser.mjs` | 增加网络检测、指数退避重试 |
| `mcp-servers/shared/answer.mjs` | 增加等待超时、页面错误监听 |
| `mcp-servers/mcp-doubao/src/index.ts` | 完善发送逻辑和网络检测 |
| `mcp-servers/mcp-chatgpt-mirror/src/index.ts` | 同步网络检测 |
| `mcp-servers/mcp-chatgpt-official/src/index.ts` | 同步网络检测 |
| `mcp-servers/mcp-deepseek/src/index.ts` | 同步网络检测 |

### 改造方案

#### 1. 网络健康检测（shared/browser.mjs）

新增 `checkSiteReachable(url)` 函数：
- 用 Node.js `https.get` 发 HEAD 请求，超时 10s
- 返回 200/302 视为可达，否则抛异常
- 从 `launchBrowser` 中调用，失败则提前返回清晰错误

#### 2. 指数退避重试

```
瞬时错误（ECONNRESET/ETIMEDOUT等）：重试 3 次，退避 500ms → 1s → 2s
永久错误（404/DNS失败等）：不重试
限流（429/503）：退避 60s
```

#### 3. 错误分类

```
TransientError — 网络超时、连接重置、浏览器崩溃 → 自动重试
PermanentError — 404、403、DNS 永久失败 → 直接失败
RetryableError — 429、503、"系统繁忙" → 长退避重试
```

#### 4. 页面加载监控

- `page.on('pageerror')` 记录但不立即失败
- 关键元素 `waitForSelector` 设置独立超时
- 页面卡死检测：`page.evaluate` 心跳

#### 5. 浏览器健康检查

- 定期执行 `page.evaluate("1+1")` 检测页面是否响应
- 连续失败自动重建浏览器

### 测试方案

1. 调用 `ask_doubao`，断网后应提示"网站不可达"而非卡死
2. 连续调用 3 次，确认浏览器复用正常
3. 网络不稳定场景：限速模拟，验证重试机制
4. 上传附件 + 连续调用验证
