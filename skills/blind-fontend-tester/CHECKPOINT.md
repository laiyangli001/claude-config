# 中断恢复机制

本技能可能因 VS Code Reload、会话超时等意外中断。每完成一步会将 checkpoint 写入持久化文件，新会话启动时自动检测并恢复进度。

## 文件格式

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

## 恢复流程

1. 检查 `.claude/projects/checkpoints/blind-frontend-tester.json` 是否存在
2. 若存在，读取并解析进度
3. 向用户报告中断位置，询问是否恢复
4. 用户确认 → 跳过已完成步骤，从失败步骤重试
5. 用户拒绝 → 删除 checkpoint，从头开始
