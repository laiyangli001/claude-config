---
name: autoit-compilation
description: 用 @Aut2Exe 符号 + cmd //c + /console 静默编译 AutoIt 脚本为 exe
metadata:
  type: reference
---

编译 deadloop_control.au3 为 exe，必须用批处理调用 cmd //c + /console 实现无窗口静默编译：

```
rm -f "C:\Users\LaiYangLi\.claude\mcp-servers\deadloop-monitor\deadloop_control.exe" && cmd //c "@Aut2Exe/Aut2exe_x64.exe /in C:\Users\LaiYangLi\.claude\mcp-servers\deadloop-monitor\deadloop_control.au3 /out C:\Users\LaiYangLi\.claude\mcp-servers\deadloop-monitor\deadloop_control.exe /console"
```

**@ 符号说明:** 代表 .claude 根目录（即 %USERPROFILE%\.claude\）。Aut2Exe 已移至 `@Aut2Exe/` 作为全局编译工具。

**Why:** 直接运行 Aut2Exe.exe 会弹出 GUI 窗口导致编译卡住。必须通过 cmd /c 传递 /console 参数才能无窗口编译。
**How to apply:** 每次修改 .au3 后，先删旧的 .exe，再用 cmd //c + /console 编译。
