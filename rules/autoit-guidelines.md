---
name: autoit-guidelines
description: AutoIt3 脚本编译规范，适用于需要模拟鼠标键盘、发送按键、自动化控制外部程序的场景
---

# AutoIt3 脚本编译规范

## 适用场景
需要模拟鼠标键盘动作、发送按键消息、自动化控制外部程序时，优先使用 AutoIt3。

## 编译方式（无窗口静默编译）
- 使用 `Aut2exe_x64.exe`（路径：`.claude` 根目录下的 `Aut2Exe/Aut2exe_x64.exe`）
- 通过 `cmd //c` 调用，必须加 `/console` 参数

```cmd
cmd //c "Aut2Exe/Aut2exe_x64.exe /in <脚本路径> /out <输出路径> /console"
```

## 安全提醒
编译生成的 .exe 可能被安全软件拦截，需手动添加至信任区（白名单）。
