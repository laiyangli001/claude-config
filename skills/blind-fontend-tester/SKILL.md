---
name: blind-frontend-tester
description: |
  盲测前端自动化工程师。模拟无法直接看到画面的测试工程师，通过浏览器
  自动化工具控制页面，逐步验证交互逻辑，并在异常时自动探查、截图或
  编写临时脚本，最终生成可回归执行的测试代码。
---

## 触发条件

用户描述一个前端操作场景（如"打开登录页，输入账号密码，点击登录，验证跳转"）。

## 中断恢复机制

本技能可能因 VS Code Reload、会话超时等意外中断。每完成一步会将 checkpoint
写入持久化文件，新会话启动时自动检测并恢复进度。

### Checkpoint 文件格式

路径：`.claude/projects/checkpoints/blind-frontend-tester.json`

```json
{
  "skill": "blind-frontend-tester",
  "url": "https://example.com/login",
  "step": 3,
  "completed": ["打开页面", "输入账号"],
  "failed": ["点击登录"],
  "selectors": { "username": "#username" },
  "testFile": "login-flow.spec.ts",
  "updatedAt": "2026-06-03T10:30:00.000Z"
}
```

### 恢复流程

执行任何步骤前先检测 checkpoint：

1. 检查 `.claude/projects/checkpoints/blind-frontend-tester.json` 是否存在
2. 若存在，读取并解析进度
3. 向用户报告中断位置，询问是否恢复
4. 用户确认 -> 跳过已完成步骤，从失败步骤重试
5. 用户拒绝 -> 删除 checkpoint，从头开始

## 执行步骤

### 第 0 步：检测中断恢复

- 若 checkpoint 存在 -> 读取进度，展示给用户，请求确认是否恢复
- 用户确认 -> 跳转到对应 `第 N 步`，跳过 `completed` 中的步骤
- 用户拒绝 -> 删除 checkpoint，执行 `第 1 步`

### 第 1 步：理解需求

确认用户描述的前端场景，明确以下信息：
- **目标 URL**：要测试的页面地址
- **操作步骤**：需要执行哪些交互（点击、输入、选择等）
- **验证点**：每一步的预期结果（弹窗出现、页面跳转、数据更新等）

写 checkpoint：`{step: 1, completed: ["理解需求"], url, steps, ...}`

### 第 2 步：导航与初始化

打开目标 URL，等待页面加载完成。

写 checkpoint：`{step: 2, completed: ["理解需求", "导航"], url, ...}`

### 第 3 步：分步操作循环

对每个交互步骤执行以下流程：

1. **获取页面状态** -- 优先使用可访问性树获取当前页面结构
2. **描述预期** -- 用文字说明预期结果
3. **执行动作** -- 点击、输入等操作，等待页面反应
4. **预期检测** -- 检测页面是否符合预期

#### 正常流程

- 默认超时 15 秒（复杂页面 30 秒）
- 匹配成功 -> 标记 ✅ 并记录元素选择器
- 选择器优先级：`data-testid` > `id` > `aria-label` > 稳定文本
- -> 更新 checkpoint：追加到 `completed`，更新 `selectors`

#### 超时 -> 异常恢复

连续 2 次失败 -> 暂停并向用户报告阻塞，请求决策。更新 checkpoint：记录失败步骤到 `failed` 数组。

### 第 4 步：视觉需求兜底

当自动检测无法确认页面真实渲染时，主动请求截图。

### 第 5 步：长耗时操作监控

上传、长加载等操作将超时设为 60 秒，卡死时提示用户手动完成。

### 第 6 步：编译回归测试

所有步骤验证通过后，将流程转换为 Playwright 测试脚本（TypeScript）：

- 写入 `.spec.ts` 文件
- 执行 `npx playwright test` 运行测试
- 若失败，根据错误定位修改选择器或等待策略，自动重试直至通过

写 checkpoint：`{step: 6, completed: [...], testFile, ...}`

### 第 7 步：交付并清理

输出测试报告摘要。任务完成后删除 checkpoint 文件。
