# ai-services 导入的完整流程

## 一、浏览器初始化

```
ensureBrowser()
  │
  ├─ 已有 browserContext 且 page 可用?
  │   └─ ✅ 直接返回（缓存命中，秒级）
  │
  ├─ CDP 端口（9222）尝试复用
  │   ├─ tryConnectCDP(9222)
  │   │   ├─ ✅ 连上 → 返回已有浏览器
  │   │   │   └─ 扫描已有页:
  │   │   │       ├─ 有 chatgpt.2233.ai + ProseMirror → 复用（isPageReady=true）
  │   │   │       ├─ 有 2233.ai 域名的页 → 用它导航
  │   │   │       └─ 都没有 → 用第一个页或新建
  │   │   └─ ❌ 连不上 → 启动新浏览器
  │   └─── launchPersistentContext + --remote-debugging-port=9222
  │
  └─ 返回 { page, context }
```

## 二、聊天页初始化

```
askChatGPT(question, attachments)
  │
  ├─ ensureBrowser() → {page, context}
  │
  └─ if (!isPageReady)   ← 首次或 CDP 未找到聊天页
       │
       ├─ 导航到 chatgpt.2233.ai/
       │
       ├─ 检测是否跳到 dashboard
       │   ├─ 是 → pg.goto("https://chatgpt.2233.ai/") ← 同标签页
       │   └─ 否 → 跳过
       │
       ├─ 等 ProseMirror 输入框（60s）
       │
       ├─ Cookie 检测登录
       │   ├─ 无 session → Toast 提示登录 → 等 180s
       │   └─ 有 session → 继续
       │
       ├─ 确认输入框可见 → isPageReady = true
       └─ 结束
```

## 三、发送与回答

```
  │
  ├─ 上传附件（如果有）
  │
  ├─ 输入问题（dispatchEvent 触发 React）
  │
  ├─ 发送（三级降级）
  │   ├─ 1. Enter
  │   ├─ 2. Ctrl+Enter
  │   └─ 3. 找 Send/发送 按钮点击
  │
  ├─ 等回答
  │   ├─ body 文本增长检测
  │   └─ 稳定确认（连续 3s 不变）
  │
  ├─ 提取回答
  └─ 返回结果
```

## 四、浏览器复用场景

### 场景 A：同一会话连续调用

```
第 1 次 → ensureBrowser() → 启动/连接浏览器 → isPageReady=true
第 2 次 → ensureBrowser() → 缓存命中 → 直接返回
第 3 次 → ensureBrowser() → 缓存命中 → 直接返回
...
```

### 场景 B：Reload 后复用

```
Reload Window
  │
  ├─ MCP 服务重启
  │
  ├─ ensureBrowser()
  │   ├─ tryConnectCDP(9222)
  │   │   └─ ✅ 旧 Chrome 还在运行 → 直接连接
  │   └─ 扫描已有页 → 找到聊天页 → isPageReady=true
  │
  └─ 跳过初始化 → 直接发送 → 获取回答
      （不需要重新导航、登录、配置）
```

### 场景 C：浏览器意外关闭

```
ensureBrowser()
  ├─ tryConnectCDP(9222) ❌ 连不上
  ├─ killOrphanChrome + 删锁文件
  └─ 启动新 Chrome + --remote-debugging-port=9222
      → 回到「首次启动」流程
```

## 五、关键设计决策

| 决策 | 原因 |
|------|------|
| CDP 端口硬编码 9222 | 无需配置，标准 Chrome 调试端口 |
| 登录检测走 Cookie | 比 DOM 检测更可靠 |
| 发送 Enter → Ctrl+Enter → 按钮 | 兼容不同焦点状态 |
| 回答检测 body 文本增长 | 通用，不受 DOM 结构变化影响 |
| CDP 不关已有页 | 用户浏览器里的其他标签页不能动 |
| 同标签页导航 | 避免新标签页导致 page 引用失效 |


# MCP 服务接入规范

添加一个新的 AI 网页 MCP 服务时，按以下步骤排查和适配。

## 一、前置准备

```bash
# 1. 复制现有服务结构
cp -r mcp-servers/mcp-chatgpt-mirror mcp-servers/mcp-新服务名

# 2. 修改 package.json 中的 name
# 3. 修改 src/index.ts 中的服务名、工具名、URL
# 4. 注册到 install-mcp-config.mjs 和 .claude.json
```

## 二、页面结构探索（禁止猜测）

用 Playwright 探测页面，不要猜测 DOM 结构：

```javascript
// 启动浏览器
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://目标网址', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3000));

// 1. 找输入框
let edits = await page.locator('[contenteditable]').count();
let textareas = await page.locator('textarea').count();
console.log('contenteditable:', edits, 'textarea:', textareas);

// 2. 找发送按钮（看按钮文字和图标）
const btns = await page.locator('button').all();
for (const b of btns) {
  const text = (await b.textContent()).trim();
  if (text) console.log('button:', text);
}

// 3. 检查 Cookies（判断登录态）
const cookies = await page.context().cookies();
console.log('cookies:', cookies.map(c => c.name + '=' + c.value.slice(0,20)));
```

## 三、登录检测

不要在页面完全加载前检测登录状态。

```typescript
// 加载完成后等待 2-3 秒让 JS 渲染完
await sleep(2000);

// 检查 cookies（优先于页面按钮检测）
const cookies = await browserContext!.cookies();
const hasSession = cookies.some(c =>
  c.name === "session_id" && c.value.length > 10   // 具体 cookie 名需从第2步确认
);

// 按钮检测作为辅助
if (!hasSession && await pg.locator("登录按钮选择器").isVisible()) {
  await showToast(pg, "🔑 请登录...");
  await pg.locator("登录按钮选择器").waitFor({ state: "hidden", timeout: 180000 });
}
```

关键：不要用关键词猜 cookie，要实际打印出来看。

## 四、输入框适配

四种常见输入方式：

| 输入方式 | 发送方式 | 适用 |
|---------|---------|------|
| `contenteditable div` | `innerText` + `dispatchEvent` + Enter | ChatGPT |
| `textarea` | `fill()` + Enter | DeepSeek、豆包 |
| `textarea`（React） | `fill()` + 原生 value setter + `dispatchEvent("input")` + Enter | 豆包 |
| 任意输入框 | 检测发送按钮并点击 | 兜底 |

React 无法感知时用原生 setter：

```typescript
await input.evaluate((el: HTMLTextAreaElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, "value"
  )?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, question);
```

## 五、回答提取（三级降级策略）

```typescript
// 第1级：内部数据结构
let answer = await page.evaluate(() => {
  // 尝试 _ROUTER_DATA、__NEXT_DATA__、__INITIAL_STATE__ 等
  // 具体 key 需从页面实际打印确认
  try {
    const data = (window as any)._ROUTER_DATA;
    // ... 具体路径需实际探索
  } catch {}
  return "";
});

// 第2级：DOM 选择器
if (!answer) {
  answer = await page.evaluate(() => {
    const msgEls = document.querySelectorAll(
      '[class*="message"], article, [role="article"]'
    );
    const last = msgEls[msgEls.length - 1];
    return last ? last.textContent?.trim() || "" : "";
  });
}

// 第3级：页面文本过滤（兜底）
if (!answer || answer.length < 5) {
  answer = await page.evaluate(() => {
    const lines = document.body.innerText.split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 15); // 过滤短 UI 文字
    return lines.slice(-3).join("\n");
  });
}
```

## 六、回答完成检测

```typescript
// 1. 检测 stop 按钮（优先级高）
const stopBtn = page.locator(STOP_BTN_SEL);
if (await stopBtn.isVisible()) {
  await stopBtn.waitFor({ state: "hidden" });
} else {
  // 2. 文本增长检测（兜底）
  const textBefore = document.body.innerText.length;
  // 等待文本增长（输入框清空也可能减少长度，必须检测增长）
  await waitFor(() => document.body.innerText.length > textBefore);
}
```

## 七、Toast 进度提示

每个关键阶段在页面内浮动提示：

```typescript
await showToast(pg, "⏳ 打开页面...");
await showToast(pg, "🔑 请登录...");
await showToast(pg, "📤 发送中...");
await showToast(pg, "⏳ 等待回答...");
await showToast(pg, "✅ 回答完成");
```

提示框设计：大字体（18px）、左上角定位、可拖拽移动、不挡聊天区域。

## 八、错误处理

```typescript
try {
  await withRetry(() => pg.goto(url, { timeout: 30000 }));
} catch (err) {
  if (isTransientError(err)) // 网络波动 → 自动重试（指数退避）
  if (isRateLimitError(err)) // 限流 → 长退避 60s
  if (isPermanentError(err)) // 404/DNS 失败 → 直接报错
}
```

## 关键经验总结

1. **探测 > 猜测** — 任何选择器都要打印出来确认，不要猜
2. **内部数据结构优先** — `_ROUTER_DATA` > DOM 选择器 > 文本过滤
3. **Cookie 检测登录** — 打印所有 cookie 确认登录态标记，不要猜 key
4. **三小时定律** — 若 3 小时内还搞不定选择器/提取，说明方向错了
5. **shared 模块优先** — 浏览器管理、回答检测、上传都用 shared/，每个服务只写导航和选择器
