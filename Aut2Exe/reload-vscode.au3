; 自动执行 VS Code Reload Window
; 完成后自动通知 Claude Code 继续任务

; === 第一步：发送 Reload 命令 ===
Send("^+p")
Sleep(1500)
Send("Reload Window")
Sleep(1200)
Send("{Enter}")
Sleep(300)
Send("{Enter}")

; === 第二步：等 VS Code 重启完成 ===
WinWaitClose("[REGEXPTITLE:(?i).*Visual Studio Code.*]", "", 15)
WinWait("[REGEXPTITLE:(?i).*Visual Studio Code.*]", "", 30)

; === 第三步：等扩展加载完毕 ===
Sleep(8000)

; === 第四步：激活 VS Code 并发送通知 ===
WinActivate("[REGEXPTITLE:(?i).*Visual Studio Code.*]")
WinWaitActive("[REGEXPTITLE:(?i).*Visual Studio Code.*]", "", 10)

; 确保焦点在输入区后发送消息
Sleep(1000)
Send("Reload window 完成，继续任务")
Sleep(500)
Send("{ENTER}")
Sleep(300)
Send("^{ENTER}")
