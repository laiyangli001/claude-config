# ChatGPT Mirror 完整流程

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
