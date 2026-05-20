$wshell = New-Object -ComObject WScript.Shell; $wshell.AppActivate("Visual Studio Code"); Start-Sleep -Milliseconds 300; $wshell.SendKeys("{ESC}")
