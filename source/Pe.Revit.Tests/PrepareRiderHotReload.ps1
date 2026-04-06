param(
    [string[]]$Files = @(),
    [string]$FilesText = "",
    [string]$ProjectPath = "C:\Users\kaitp\source\repos\Pe.Tools",
    [string]$RiderBinDirectory = "C:\Program Files\JetBrains\JetBrains Rider 2025.2\bin",
    [int]$WarningSeconds = 3,
    [switch]$SkipOpen,
    [switch]$SkipFormat,
    [switch]$SkipHotReload,
    [switch]$SkipWarning,
    [switch]$DryRun
)

$rider64 = Join-Path $RiderBinDirectory "rider64.exe"
$hotReloadAhkScript = Join-Path $PSScriptRoot "AutoApplyRiderHotReload.ahk"
$autoHotkeyExe = "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"

# This helper is intentionally scoped to runtime `.cs` files that are likely to
# matter for the live Rider/Revit session. Test project files are excluded
# because rebuilding the `.Tests` lane already updates the test assembly on disk.
function Write-Step {
    param([string]$Message)
    Write-Host "[PrepareRiderHotReload] $Message"
}

function Get-GitDirtyFiles {
    try {
        return git -C $ProjectPath status --porcelain |
            ForEach-Object {
                if ($_.Length -ge 4) {
                    $_.Substring(3).Trim()
                }
            } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Sort-Object -Unique
    }
    catch {
        Write-Step "Could not read git status: $($_.Exception.Message)"
        return @()
    }
}

function Normalize-FileList {
    param([string[]]$InputFiles, [string]$InputText)

    $combined = @()

    if ($null -ne $InputFiles) {
        $combined += $InputFiles
    }

    if (-not [string]::IsNullOrWhiteSpace($InputText)) {
        $combined += ($InputText -split "[`r`n;|]+" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    if ($combined.Count -eq 0) {
        $combined = Get-GitDirtyFiles
    }

    return $combined |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_.Trim().Trim('"') } |
        Where-Object { $_ -like "*.cs" } |
        Where-Object { $_ -notmatch '(?i)[\\/][^\\/]*test[^\\/]*[\\/]' } |
        ForEach-Object {
            if ([System.IO.Path]::IsPathRooted($_)) { $_ } else { Join-Path $ProjectPath $_ }
        } |
        Where-Object { Test-Path $_ } |
        Select-Object -Unique
}

function Open-FilesInRider {
    param([string[]]$ResolvedFiles)

    if ($ResolvedFiles.Count -eq 0) {
        Write-Step "No files to open."
        return
    }

    if (-not (Test-Path $rider64)) {
        throw "Rider launcher not found at '$rider64'."
    }

    Write-Step "Opening $($ResolvedFiles.Count) file(s) in Rider."
    if ($DryRun) {
        $ResolvedFiles | ForEach-Object { Write-Step "DRY RUN open: $_" }
        return
    }

    foreach ($file in $ResolvedFiles) {
        Write-Step "Opening '$file' in Rider."
        & $rider64 $ProjectPath $file | Out-Null
        Start-Sleep -Milliseconds 500
    }
}

function Nudge-FilesForHotReload {
    param([string[]]$ResolvedFiles)

    Write-Step "Transient file nudge is handled inside the AHK sequence."
}

function Write-FileListArtifact {
    param([string[]]$ResolvedFiles)

    $artifactPath = Join-Path $env:TEMP "pe-rider-hot-reload-files.txt"
    if ($DryRun) {
        return $artifactPath
    }

    [System.IO.File]::WriteAllLines($artifactPath, $ResolvedFiles)
    return $artifactPath
}

function Invoke-HotReload {
    param([string[]]$ResolvedFiles)

    Write-Step "Invoking Rider hot reload trigger."
    if ($DryRun) {
        return
    }

    if ((Test-Path $autoHotkeyExe) -and (Test-Path $hotReloadAhkScript)) {
        $fileListArtifact = Write-FileListArtifact -ResolvedFiles $ResolvedFiles
        $skipWarningArg = if ($SkipWarning) { "1" } else { "0" }
        & $autoHotkeyExe $hotReloadAhkScript $fileListArtifact $WarningSeconds $skipWarningArg
        return
    }

    throw "AutoHotkey hot reload automation is required but was not found."
}

try {
    $resolvedFiles = Normalize-FileList -InputFiles $Files -InputText $FilesText
    Write-Step "Resolved $($resolvedFiles.Count) existing file(s)."

    if (-not $SkipOpen) {
        Open-FilesInRider -ResolvedFiles $resolvedFiles
    }

    if (-not $SkipFormat) {
        Nudge-FilesForHotReload -ResolvedFiles $resolvedFiles
    }

    if (-not $SkipHotReload) {
        Invoke-HotReload -ResolvedFiles $resolvedFiles
    }
}
catch {
    Write-Error $_
    exit 1
}
