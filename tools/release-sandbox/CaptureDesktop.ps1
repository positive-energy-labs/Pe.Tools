param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference='Stop'
if($env:USERNAME -ne 'WDAGUtilityAccount' -or $Output -notlike 'C:\GateEvidence\*' -or (Test-Path $Output)){throw 'Fresh ownedguest screenshot only'}
if(Get-Process Revit -ErrorAction SilentlyContinue){throw 'NoRevitguest required'}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CapturePhysicalNative {
 [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect bounds);
 public struct Rect {public int Left,Top,Right,Bottom;}
}
"@
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$logical=[System.Windows.Forms.SystemInformation]::VirtualScreen
$prior=[CapturePhysicalNative]::SetThreadDpiAwarenessContext([intptr](-4))
if($prior -eq [intptr]::Zero){throw ('DPI context calibration failed: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
$bitmap=$null;$graphics=$null
try {
 $x=[CapturePhysicalNative]::GetSystemMetrics(76);$y=[CapturePhysicalNative]::GetSystemMetrics(77);$width=[CapturePhysicalNative]::GetSystemMetrics(78);$height=[CapturePhysicalNative]::GetSystemMetrics(79)
 if($width -lt $logical.Width -or $height -lt $logical.Height){throw 'Physical bounds smaller than logical bounds'}
 $bitmap=New-Object Drawing.Bitmap $width,$height
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 $graphics.CopyFromScreen($x,$y,0,0,[Drawing.Size]::new($width,$height))
 $bitmap.Save($Output,[Drawing.Imaging.ImageFormat]::Png)
 $windows=@(Get-Process | Where-Object MainWindowHandle -ne 0 | ForEach-Object {$rect=New-Object CapturePhysicalNative+Rect;[CapturePhysicalNative]::GetWindowRect($_.MainWindowHandle,[ref]$rect) | Out-Null;@{pid=$_.Id;name=$_.ProcessName;title=$_.MainWindowTitle;responding=$_.Responding;physicalBounds=$rect}})
 @{atUtc=[datetime]::UtcNow.ToString('o');logicalBounds=@{x=$logical.X;y=$logical.Y;width=$logical.Width;height=$logical.Height};physicalBounds=@{x=$x;y=$y;width=$width;height=$height};dpiContext='PER_MONITOR_AWARE_V2';previousContext=$prior.ToInt64();windows=$windows;imageSha256=(Get-FileHash $Output).Hash} | ConvertTo-Json -Depth 8 | Set-Content ($Output+'.json')
}finally{if($graphics){$graphics.Dispose()};if($bitmap){$bitmap.Dispose()};[CapturePhysicalNative]::SetThreadDpiAwarenessContext($prior) | Out-Null}
