---
name: respond-before-probing
description: 用户开场后必须先回应，不先跑诊断命令
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 86e68d50-e180-47c2-93fb-799430b110f1
---

用户说"开始今天的工作/开始/我们开工"等开场白时，直接回应等待指令，不要先跑 ls / find / 摸项目状态之类的命令。

**Why:** 那些命令是黑盒，用户不知道你在干嘛，也无法中断。
**How to apply:** 开场白后直接一句"有什么需要做的？"就够了。如果有必要确认状态，先问用户能不能检查一下。
