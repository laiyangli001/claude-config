; AutoIt v3 — 死循环监控辅助
; 用法:
;   AutoIt3.exe deadloop_control.au3 esc
;   AutoIt3.exe deadloop_control.au3 inject "文本"

; ── 参数检查 ──
If $CmdLine[0] < 1 Then
    ConsoleWrite("ERROR: no command" & @CRLF)
    Exit 1
EndIf

; ── 查找 VS Code 窗口 ──
Local $hWnd = WinGetHandle("[REGEXPTITLE:.*Visual Studio Code.*]")
If @error Then
    $hWnd = WinGetHandle("[REGEXPTITLE:.*VS Code.*]")
EndIf
If @error Then
    ConsoleWrite("ERROR: window not found" & @CRLF)
    Exit 1
EndIf

Local $cmd = $CmdLine[1]

; ═══════════════════════════
;  ESC — 中断 Claude Code
; ═══════════════════════════
If $cmd = "esc" Then
    ; 长按 ESC 5 秒（每 100ms 一次），确保中断生效
    Local $end = TimerInit()
    While TimerDiff($end) < 5000
        ControlSend($hWnd, "", "", "{ESC}")
        Sleep(100)
    WEnd
    ConsoleWrite("OK" & @CRLF)
    Exit 0
EndIf

; ═══════════════════════════
;  inject — 注入文本并提交
; ═══════════════════════════
If $cmd = "inject" Then
    If $CmdLine[0] < 2 Or $CmdLine[2] = "" Then
        ConsoleWrite("ERROR: no text" & @CRLF)
        Exit 1
    EndIf

    ; 用剪贴板处理中文
    ClipPut($CmdLine[2])
    Sleep(200)

    ; 全部用 ControlSend 发给窗口（不需焦点）
    ControlSend($hWnd, "", "", "{ESC}")    ; 聚焦对话框
    Sleep(200)
    ControlSend($hWnd, "", "", "^v")       ; 粘贴
    Sleep(500)
    ControlSend($hWnd, "", "", "{ENTER}")  ; Enter
    Sleep(200)
    ControlSend($hWnd, "", "", "^{ENTER}") ; Ctrl+Enter 提交
    Sleep(200)

    ConsoleWrite("OK" & @CRLF)
    Exit 0
EndIf

; ═══════════════════════════
;  paste — 只粘贴不发送
; ═══════════════════════════
If $cmd = "paste" Then
    If $CmdLine[0] < 2 Or $CmdLine[2] = "" Then
        ConsoleWrite("ERROR: no text" & @CRLF)
        Exit 1
    EndIf

    ClipPut($CmdLine[2])
    Sleep(200)

    ControlSend($hWnd, "", "", "{ESC}")    ; 聚焦对话框
    Sleep(200)
    ControlSend($hWnd, "", "", "^v")       ; 粘贴，不发送
    Sleep(200)

    ConsoleWrite("OK" & @CRLF)
    Exit 0
EndIf

; ═══════════════════════════
;  inject_file — 从文件读内容并提交
;  deadloop_control.exe inject_file "C:\path\to\tmp.txt"
; ═══════════════════════════
If $cmd = "inject_file" Then
    If $CmdLine[0] < 2 Or $CmdLine[2] = "" Then
        ConsoleWrite("ERROR: no file" & @CRLF)
        Exit 1
    EndIf
    Local $content = FileRead($CmdLine[2])
    ClipPut($content)
    Sleep(200)
    ControlSend($hWnd, "", "", "{ESC}")    ; 聚焦对话框
    Sleep(200)
    ControlSend($hWnd, "", "", "^v")       ; 粘贴
    Sleep(500)
    ControlSend($hWnd, "", "", "{ENTER}")  ; Enter
    Sleep(200)
    ControlSend($hWnd, "", "", "^{ENTER}") ; Ctrl+Enter 提交
    Sleep(200)
    ConsoleWrite("OK" & @CRLF)
    Exit 0
EndIf

; ═══════════════════════════
;  paste_file — 从文件读内容只粘贴不发送
; ═══════════════════════════
If $cmd = "paste_file" Then
    If $CmdLine[0] < 2 Or $CmdLine[2] = "" Then
        ConsoleWrite("ERROR: no file" & @CRLF)
        Exit 1
    EndIf
    Local $content = FileRead($CmdLine[2])
    ClipPut($content)
    Sleep(200)
    ControlSend($hWnd, "", "", "{ESC}")    ; 聚焦对话框
    Sleep(200)
    ControlSend($hWnd, "", "", "^v")       ; 粘贴
    Sleep(200)
    ConsoleWrite("OK" & @CRLF)
    Exit 0
EndIf

ConsoleWrite("ERROR: unknown command " & $cmd & @CRLF)
Exit 1
