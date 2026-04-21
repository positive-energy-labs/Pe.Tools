#Requires AutoHotkey v2.0
#SingleInstance Force

SetTitleMatchMode 2
DetectHiddenWindows true

riderSelector := "Pe.Tools ahk_exe rider64.exe"
warningSeconds := 3
skipWarning := false
mode := "full"

if A_Args.Length >= 2 {
    try {
        parsedWarningSeconds := Round(Trim(A_Args[2]) + 0)
        if (parsedWarningSeconds >= 0) {
            warningSeconds := parsedWarningSeconds
        }
    }
    catch {
    }
}

if A_Args.Length >= 3 {
    skipWarning := Trim(A_Args[3]) = "1"
}

if A_Args.Length >= 4 {
    mode := Trim(A_Args[4])
}

if (mode = "") {
    mode := "full"
}

if (mode = "warn") {
    if !skipWarning {
        WarnBeforeAutomation(warningSeconds)
    }

    ExitApp 0
}

if !WinExist(riderSelector) {
    riderSelector := "ahk_exe rider64.exe"
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
    warningWindow.AddText("c333333 w420", "Rider will be focused and receive input shortly.")
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

try {
    WinRestore riderSelector
} catch {
}

RunRiderAction(actionName) {
    global riderSelector

    savedClipboard := A_Clipboard
    SendEvent "^p"
    Sleep 100
    SendEvent "^a"
    A_Clipboard := actionName
    SendEvent "^v"
    Sleep 500
    SendEvent "{Enter}"
    Sleep 150
    A_Clipboard := savedClipboard
}

if !skipWarning {
    WarnBeforeAutomation(warningSeconds)
}

WinActivate riderSelector
if !WinWaitActive(riderSelector, , 2) {
    ExitApp 2
}

Sleep 200
RunRiderAction("Auto HR")
ExitApp 0
