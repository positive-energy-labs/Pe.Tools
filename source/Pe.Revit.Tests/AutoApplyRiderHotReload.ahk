#Requires AutoHotkey v2.0
#SingleInstance Force

SetTitleMatchMode 2
DetectHiddenWindows true

riderSelector := "Pe.Tools ahk_exe rider64.exe"
fileListPath := ""
warningSeconds := 3
skipWarning := false

if A_Args.Length >= 1 {
    fileListPath := A_Args[1]
}

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

if !WinExist(riderSelector) {
    riderSelector := "ahk_exe rider64.exe"
}

if !WinExist(riderSelector) {
    ExitApp 1
}

LoadTargetFiles(path) {
    if (path = "" || !FileExist(path)) {
        return []
    }

    files := []
    for line in StrSplit(FileRead(path, "UTF-8"), "`n", "`r") {
        trimmed := Trim(line, " `t`r`n`"")
        if (trimmed = "") {
            continue
        }

        files.Push(trimmed)
    }

    return files
}

NudgeFiles(files) {
    originals := Map()

    for file in files {
        if !FileExist(file) {
            continue
        }

        original := FileRead(file, "UTF-8")
        originals[file] := original

        handle := FileOpen(file, "w", "UTF-8")
        handle.Write(original . "`r`n// PE_HOT_RELOAD_NUDGE`r`n")
        handle.Close()
    }

    return originals
}

RestoreFiles(originals) {
    for file, original in originals {
        handle := FileOpen(file, "w", "UTF-8")
        handle.Write(original)
        handle.Close()
    }
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
    SendEvent "{Esc}"
    Sleep 250
    SendEvent "^+a"
    Sleep 1200
    A_Clipboard := actionName
    Sleep 100
    SendEvent "^v"
    Sleep 1200
    SendEvent "{Enter}"
    Sleep 400
    A_Clipboard := savedClipboard
}

targetFiles := LoadTargetFiles(fileListPath)

if !skipWarning {
    WarnBeforeAutomation(warningSeconds)
}

WinActivate riderSelector
if !WinWaitActive(riderSelector, , 2) {
    ExitApp 2
}

Sleep 500
originals := NudgeFiles(targetFiles)
Sleep 500
RunRiderAction("Reload All From Disk")
Sleep 300
RestoreFiles(originals)
Sleep 500
RunRiderAction("Apply Changes")
Sleep 250
ExitApp 0
