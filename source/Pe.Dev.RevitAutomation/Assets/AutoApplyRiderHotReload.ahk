#Requires AutoHotkey v2.0
#SingleInstance Force

SetTitleMatchMode 2
DetectHiddenWindows true

riderSelector := "Pe.Tools ahk_exe rider64.exe"
warningSeconds := 3
skipWarning := false

if A_Args.Length >= 1 {
    try {
        parsedWarningSeconds := Round(Trim(A_Args[1]) + 0)
        if (parsedWarningSeconds >= 0) {
            warningSeconds := parsedWarningSeconds
        }
    }
    catch {
    }
}

if A_Args.Length >= 2 {
    skipWarning := Trim(A_Args[2]) = "1"
}

if !WinExist(riderSelector) {
    riderSelector := "ahk_exe rider64.exe"
}

if !WinExist(riderSelector) {
    riderSelector := "ahk_exe rider.exe"
}

if !WinExist(riderSelector) {
    ExitApp 1
}

WarnBeforeAutomation(seconds) {
    if (seconds <= 0) {
        return
    }

    SoundBeep 900, 120

    warningWindow := Gui("+AlwaysOnTop -Caption +Border +ToolWindow")
    warningWindow.BackColor := "FFF4CC"
    warningWindow.MarginX := 18
    warningWindow.MarginY := 14
    warningWindow.SetFont("s11", "Segoe UI")
    warningWindow.AddText("c1F1F1F w420", "Pe.Tools hot reload automation")
    warningWindow.SetFont("s10", "Segoe UI")
    warningWindow.AddText("c333333 w420", "Rider will be focused and receive reload/apply actions shortly.")
    countdown := warningWindow.AddText("c7A5300 w420", "")
    warningWindow.Show("AutoSize Center NoActivate")

    Loop seconds {
        remaining := seconds - A_Index + 1
        suffix := remaining = 1 ? "" : "s"
        countdown.Value := "Focusing Rider in " remaining " second" suffix "..."
        Sleep 1000
    }

    warningWindow.Destroy()
}

RunRiderAction(actionName, waitMilliseconds) {
    savedClipboard := A_Clipboard
    SendEvent "^p"
    Sleep 1200
    SendEvent "^a"
    Sleep 150
    A_Clipboard := actionName
    SendEvent "^v"
    Sleep 1200
    SendEvent "{Enter}"
    Sleep waitMilliseconds
    A_Clipboard := savedClipboard
}

try {
    WinRestore riderSelector
} catch {
}

if !skipWarning {
    WarnBeforeAutomation(warningSeconds)
}

WinActivate riderSelector
if !WinWaitActive(riderSelector, , 3) {
    ExitApp 2
}

Sleep 1500
; Keep these action names explicit so the pe-dev/Rider contract can be tuned if Rider renames actions.
RunRiderAction("Reload All from Disk", 2500)
Sleep 1000
RunRiderAction("Apply Changes", 6000)
Sleep 250
ExitApp 0
