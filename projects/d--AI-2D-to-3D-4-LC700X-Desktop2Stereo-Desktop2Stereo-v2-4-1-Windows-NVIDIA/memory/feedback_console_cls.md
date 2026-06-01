---
name: console-cls-timing
description: Windows 控制台清屏要在 subprocess.Popen 之前、在父进程中执行才可靠
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 86e68d50-e180-47c2-93fb-799430b110f1
---

Windows 控制台清屏的正确做法：在 **父进程** 中、**subprocess.Popen 之前** 执行 `os.system('cls')`。

**错误做法：**
- 在子进程（main.py）中清屏 → 控制台句柄可能无效，cls 可能失败
- 用 ctypes kernel32 API 清屏 → COORD 结构体传参容易写错
- cls 放到 subprocess.Popen 之后 → 子进程和父进程抢控制台输出

**正确做法:**
```python
# 在 gui.py 中、Popen 之前
import os
os.system('cls')
print("[Main] 正在启动...")
self.process = subprocess.Popen(cmd)
```

**Why:** 父进程的控制台句柄始终有效，`os.system('cls')` 简单可靠。时机最关键——清屏后再启动子进程。
