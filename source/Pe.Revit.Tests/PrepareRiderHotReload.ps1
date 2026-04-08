param(
    [string[]]$Files = @(),
    [string]$FilesText = "",
    [string]$ProjectPath = "C:\Users\kaitp\source\repos\Pe.Tools",
    [string]$RiderBinDirectory = "C:\Program Files\JetBrains\JetBrains Rider 2025.2\bin",
    [int]$RevitYear = 2025,
    [int]$RecentOpenWindowMinutes = 15,
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
$recentOpenArtifactPath = Join-Path $env:TEMP "pe-rider-recent-opens.json"

# This helper is intentionally scoped to runtime `.cs` files that are likely to
# matter for the live Rider/Revit session. Test project files are excluded
# because rebuilding the `.Tests` lane already updates the test assembly on disk.
function Write-Step {
    param([string]$Message)
    Write-Host "[PrepareRiderHotReload] $Message"
}

function Get-MatchingRevitSessionInfo {
    param([int]$TargetYear)

    $matchingYearProcesses = @(
        Get-Process -Name "Revit" -ErrorAction SilentlyContinue |
            ForEach-Object {
                try {
                    if ($_.MainWindowTitle -match [regex]::Escape([string]$TargetYear)) {
                        [pscustomobject]@{
                            Id = $_.Id
                            StartUtc = $_.StartTime.ToUniversalTime()
                            MainWindowTitle = $_.MainWindowTitle
                        }
                    }
                }
                catch {
                }
            }
    )

    return $matchingYearProcesses |
        Sort-Object StartUtc -Descending |
        Select-Object -First 1
}

function Test-MatchingRevitSessionRunning {
    param([int]$TargetYear)

    $revitProcesses = @(Get-Process -Name "Revit" -ErrorAction SilentlyContinue)
    if ($revitProcesses.Count -eq 0) {
        Write-Step "Skipping Rider automation because Revit is not running."
        return $false
    }

    if ($null -ne (Get-MatchingRevitSessionInfo -TargetYear $TargetYear)) {
        return $true
    }

    Write-Step "Skipping Rider automation because no Revit $TargetYear session is running."
    return $false
}

function Get-RecentOpenMap {
    $recentOpens = @{}

    if (-not (Test-Path $recentOpenArtifactPath)) {
        return $recentOpens
    }

    try {
        $content = Get-Content $recentOpenArtifactPath -Raw
        if ([string]::IsNullOrWhiteSpace($content)) {
            return $recentOpens
        }

        $entries = @((ConvertFrom-Json $content))
        foreach ($entry in $entries) {
            if ($null -eq $entry -or [string]::IsNullOrWhiteSpace($entry.Path) -or [string]::IsNullOrWhiteSpace($entry.LastOpenedUtc)) {
                continue
            }

            $lastOpenedUtc = [datetime]::Parse(
                $entry.LastOpenedUtc,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind
            )

            $revitStartUtc = $null
            if (
                $entry.PSObject.Properties.Name -contains 'RevitStartUtc' -and
                -not [string]::IsNullOrWhiteSpace($entry.RevitStartUtc)
            ) {
                $revitStartUtc = [datetime]::Parse(
                    $entry.RevitStartUtc,
                    [System.Globalization.CultureInfo]::InvariantCulture,
                    [System.Globalization.DateTimeStyles]::RoundtripKind
                )
            }

            $recentOpens[$entry.Path] = [pscustomobject]@{
                LastOpenedUtc = $lastOpenedUtc
                RevitPid = if ($entry.PSObject.Properties.Name -contains 'RevitPid') { $entry.RevitPid } else { $null }
                RevitStartUtc = $revitStartUtc
            }
        }
    }
    catch {
        Write-Step "Could not read recent Rider open cache: $($_.Exception.Message)"
    }

    return $recentOpens
}

function Save-RecentOpenMap {
    param([hashtable]$RecentOpens)

    try {
        $cutoffUtc = [datetime]::UtcNow.AddDays(-1)
        $entries = $RecentOpens.GetEnumerator() |
            Where-Object { $null -ne $_.Value -and $_.Value.LastOpenedUtc -ge $cutoffUtc } |
            Sort-Object { $_.Value.LastOpenedUtc } -Descending |
            ForEach-Object {
                [pscustomobject]@{
                    Path = $_.Key
                    LastOpenedUtc = $_.Value.LastOpenedUtc.ToString("o", [System.Globalization.CultureInfo]::InvariantCulture)
                    RevitPid = $_.Value.RevitPid
                    RevitStartUtc = if ($_.Value.RevitStartUtc -is [datetime]) {
                        $_.Value.RevitStartUtc.ToString("o", [System.Globalization.CultureInfo]::InvariantCulture)
                    }
                    else {
                        $null
                    }
                }
            }

        $entries | ConvertTo-Json | Set-Content $recentOpenArtifactPath -Encoding UTF8
    }
    catch {
        Write-Step "Could not write recent Rider open cache: $($_.Exception.Message)"
    }
}

function Get-FilesToOpen {
    param(
        [string[]]$ResolvedFiles,
        [int]$WindowMinutes,
        [pscustomobject]$CurrentRevitSession
    )

    if ($ResolvedFiles.Count -eq 0) {
        return @()
    }

    $recentOpens = Get-RecentOpenMap
    $cutoffUtc = [datetime]::UtcNow.AddMinutes(-1 * $WindowMinutes)
    $filesToOpen = @()

    foreach ($file in $ResolvedFiles) {
        $cacheEntry = $recentOpens[$file]
        $sameRevitSession =
            $null -ne $cacheEntry -and
            $cacheEntry.LastOpenedUtc -is [datetime] -and
            $cacheEntry.RevitStartUtc -is [datetime] -and
            $null -ne $CurrentRevitSession -and
            $cacheEntry.RevitPid -eq $CurrentRevitSession.Id -and
            $cacheEntry.RevitStartUtc -eq $CurrentRevitSession.StartUtc

        if ($sameRevitSession -and $cacheEntry.LastOpenedUtc -ge $cutoffUtc) {
            Write-Step "Skipping recently-opened file '$file'."
            continue
        }

        $filesToOpen += $file
    }

    return $filesToOpen
}

function Save-RecentlyOpenedFiles {
    param(
        [string[]]$ResolvedFiles,
        [pscustomobject]$CurrentRevitSession
    )

    if ($DryRun -or $ResolvedFiles.Count -eq 0) {
        return
    }

    $recentOpens = Get-RecentOpenMap
    $openedAtUtc = [datetime]::UtcNow

    foreach ($file in $ResolvedFiles) {
        $recentOpens[$file] = [pscustomobject]@{
            LastOpenedUtc = $openedAtUtc
            RevitPid = if ($null -ne $CurrentRevitSession) { $CurrentRevitSession.Id } else { $null }
            RevitStartUtc = if ($null -ne $CurrentRevitSession) { $CurrentRevitSession.StartUtc } else { $null }
        }
    }

    Save-RecentOpenMap -RecentOpens $recentOpens
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
    param(
        [string[]]$ResolvedFiles,
        [pscustomobject]$CurrentRevitSession
    )

    if ($ResolvedFiles.Count -eq 0) {
        Write-Step "No files need to be opened in Rider."
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

    Save-RecentlyOpenedFiles -ResolvedFiles $ResolvedFiles -CurrentRevitSession $CurrentRevitSession
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
        $skipWarningArg = "1"
        & $autoHotkeyExe $hotReloadAhkScript $fileListArtifact $WarningSeconds $skipWarningArg
        return
    }

    throw "AutoHotkey hot reload automation is required but was not found."
}

function Show-AutomationWarning {
    if ($SkipWarning) {
        return
    }

    if ($DryRun) {
        Write-Step "DRY RUN warning: Rider automation warning would show now."
        return
    }

    if ((Test-Path $autoHotkeyExe) -and (Test-Path $hotReloadAhkScript)) {
        & $autoHotkeyExe $hotReloadAhkScript "" $WarningSeconds "0" "warn"
        return
    }

    Write-Step "Automation warning could not be shown because AutoHotkey is unavailable."
}

try {
    if (-not (Test-MatchingRevitSessionRunning -TargetYear $RevitYear)) {
        exit 0
    }

    $currentRevitSession = Get-MatchingRevitSessionInfo -TargetYear $RevitYear
    $resolvedFiles = Normalize-FileList -InputFiles $Files -InputText $FilesText
    Write-Step "Resolved $($resolvedFiles.Count) existing file(s)."
    $filesToOpen = if ($SkipOpen) {
        @()
    }
    else {
        Get-FilesToOpen -ResolvedFiles $resolvedFiles -WindowMinutes $RecentOpenWindowMinutes -CurrentRevitSession $currentRevitSession
    }

    if ($filesToOpen.Count -gt 0) {
        Write-Step "Opening $($filesToOpen.Count) file(s) in Rider after recent-open filtering."
    }

    if ($filesToOpen.Count -gt 0 -or -not $SkipHotReload) {
        Show-AutomationWarning
    }

    if (-not $SkipOpen) {
        Open-FilesInRider -ResolvedFiles $filesToOpen -CurrentRevitSession $currentRevitSession
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
