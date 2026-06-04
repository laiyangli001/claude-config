; Chrome getDisplayMedia 截图对话框处理
; 用法:
;   screenshot-dialog.exe --activate "窗口标题"  激活目标窗口后退出
;   screenshot-dialog.exe --dialog            在 Chrome 窗口上点击对话框按钮

Local $mode = ""
If $CmdLine[0] >= 1 Then $mode = $CmdLine[1]

If $mode = "--activate" And $CmdLine[0] >= 2 Then
  Local $h = WinGetHandle($CmdLine[2])
  If $h <> 0 Then
    WinActivate($h)
    Sleep(500)
  EndIf
  Exit 0
EndIf

If $mode = "--dialog" Then
  ; 找 Chrome 主窗口
  Local $hChrome = 0
  For $t = 1 To 30
    $hChrome = WinGetHandle("[REGEXPTITLE:(?i)Claude.*Chrome|Google Chrome|Chromium|2233]", "")
    If $hChrome <> 0 Then ExitLoop
    Sleep(500)
  Next

  If $hChrome = 0 Then
    ConsoleWrite("ERROR: Chrome window not found" & @CRLF)
    Exit 1
  EndIf

  ; 等对话框渲染
  Sleep(3000)

  ; 获取 Chrome 窗口位置
  Local $pos = WinGetPos($hChrome)
  If @error Then
    ConsoleWrite("ERROR: WinGetPos failed" & @CRLF)
    Exit 2
  EndIf

  ; 对话框在 Chrome 窗口内居中显示，约 700x500
  ; Chrome 标题栏约 30-40px，所以实际内容区域偏移
  Local $dlgW = 700
  Local $dlgH = 500
  Local $dlgX = $pos[0] + ($pos[2] - $dlgW) / 2
  Local $dlgY = $pos[1] + ($pos[3] - $dlgH) / 2

  ; 1. 点击"窗口" tab（对话框宽度42%，顶部28px）
  MouseClick("left", $dlgX + $dlgW * 0.42, $dlgY + 28, 1)
  Sleep(1000)

  ; 2. 点击第一个列表项（中部偏左）
  MouseClick("left", $dlgX + $dlgW * 0.35, $dlgY + $dlgH * 0.45, 1)
  Sleep(800)

  ; 3. 点击"分享"按钮（右下往回）
  MouseClick("left", $dlgX + $dlgW - 90, $dlgY + $dlgH - 30, 1)

  ; 等对话框关闭（检测 Chrome 窗口内的变化）
  Sleep(3000)
  ConsoleWrite("SUCCESS: Dialog handled" & @CRLF)
  Exit 0
EndIf

ConsoleWrite("ERROR: Unknown mode" & @CRLF)
Exit 3
