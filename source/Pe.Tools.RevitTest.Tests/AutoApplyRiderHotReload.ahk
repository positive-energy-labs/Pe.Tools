#Requires AutoHotkey v2.0
#SingleInstance Force

SetTitleMatchMode 2
DetectHiddenWindows true

riderSelector := "Pe.Tools ahk_exe rider64.exe"
fileListPath := ""

if A_Args.Length >= 1 {
    fileListPath := A_Args[1]
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
    Sleep 900
    SendEvent "{Enter}"
    Sleep 400
    A_Clipboard := savedClipboard
}

targetFiles := LoadTargetFiles(fileListPath)

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
