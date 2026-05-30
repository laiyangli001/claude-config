import { execSync } from "child_process";
import fs from "fs";
import os from "os";

const PS = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
'@

function Find-VSCodeWindow {
    $target = [IntPtr]::Zero
    $cb = {
        param($hWnd, $lParam)
        $sb = New-Object System.Text.StringBuilder(256)
        [Win32]::GetWindowText($hWnd, $sb, 256)
        if ($sb.ToString() -match "- Visual Studio Code$") {
            $script:target = $hWnd
            return $false
        }
        return $true
    }
    [Win32]::EnumWindows($cb, [IntPtr]::Zero)
    return $script:target
}

$hwnd = Find-VSCodeWindow
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "NOT_FOUND"; exit 1 }
if ([Win32]::IsIconic($hwnd)) { [Win32]::ShowWindow($hwnd, 9) }
[Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 500
(New-Object -ComObject WScript.Shell).SendKeys("env中文file测试~")
Write-Host "OK"
`;

const tmpFile = os.tmpdir() + "/deadloop_test2.ps1";
fs.writeFileSync(tmpFile, "﻿" + PS);
try {
  const out = execSync(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { timeout: 5000, encoding: "utf-8" });
  console.log("OUT:", out.trim());
} catch(e) {
  console.log("ERR:", e.stderr || e.message);
}
