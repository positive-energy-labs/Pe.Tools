param(
    [Parameter(Mandatory)][string]$Installer,
    [string]$NextInstaller,
    [string]$Out = (Join-Path ([IO.Path]::GetTempPath()) ('pe-crossing-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss'))),
    # Without this the kit only validates the installer and prints the plan: nothing is installed or started.
    [switch]$Execute
)
$ErrorActionPreference = 'Stop'
# The installed-lane crossing (host ledger, wave F1 "native crossing"): the checks no source run can prove.
# Run -Execute only on a clean machine or a Windows Sandbox guest. It refuses a machine that already has
# the product, so it can never touch an owner's installed Pe.Tools.

function Test-ProductInstalled {
    $roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root) {
            $name = (Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue).DisplayName
            if ($name -like '*Pe.Tools*' -or $name -like '*Pe Tools*') { return $true }
        }
    }
    return $false
}

function Get-ServiceRecord {
    $directory = Join-Path $env:LOCALAPPDATA 'Positive Energy/Pe.Tools/state/service'
    if (-not (Test-Path -LiteralPath $directory)) { return $null }
    foreach ($file in Get-ChildItem -LiteralPath $directory -Filter '*.json') {
        $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
        if ($record.lane -ne 'installed') { continue }
        if (Get-Process -Id $record.pid -ErrorAction SilentlyContinue) { return $record }
    }
    return $null
}

# The step bodies run in the caller's scope, so the host they talk to is script state.
function Invoke-HostRequest([string]$Method, [string]$Path, $Body) {
    $arguments = @{ Uri = ('http://127.0.0.1:' + $script:hostRecord.port + $Path); Method = $Method; TimeoutSec = 15
        Headers = @{ 'x-pe-service-token' = $script:hostRecord.token } }
    if ($Body) { $arguments.Body = ($Body | ConvertTo-Json -Compress); $arguments.ContentType = 'application/json' }
    Invoke-RestMethod @arguments
}

function New-Step([string]$Id, [string]$Mode, [string]$Title, [string[]]$Instructions, [scriptblock]$Run) {
    [pscustomobject]@{ id = $Id; mode = $Mode; title = $Title; instructions = $Instructions; run = $Run }
}

# The ordered crossing. `auto` steps run under -Execute; `human` steps are printed with what to click and
# what to see, because they need a real login, a real turn or a person's eyes on a window.
function Get-CrossingPlan([string]$Installer, [string]$NextInstaller, [string]$Out) {
    $steps = @(
        (New-Step 'install' 'auto' 'Install the MSI silently' @("msiexec /i `"$Installer`" /qn /norestart") {
            $log = Join-Path $Out 'install.log'
            $process = Start-Process msiexec -ArgumentList @('/i', "`"$Installer`"", '/qn', '/norestart', '/l*v', "`"$log`"") -PassThru -Wait
            if ($process.ExitCode -notin 0, 3010) { throw "msiexec exited $($process.ExitCode); see $log" }
            "installed (exit $($process.ExitCode))"
        }),
        (New-Step 'host-up' 'auto' 'The installed host starts and answers' @('Waits up to 120 s for an installed service record with a live process, then reads /pe/providers.') {
            $deadline = [DateTime]::UtcNow.AddSeconds(120)
            while (-not ($script:hostRecord = Get-ServiceRecord)) {
                if ([DateTime]::UtcNow -gt $deadline) { throw 'No installed host appeared. Start Pe.Tools from the Start menu and re-run -Execute is not supported: read install.log.' }
                Start-Sleep -Seconds 2
            }
            $providers = Invoke-HostRequest 'GET' '/pe/providers'
            "host $($script:hostRecord.version) on port $($script:hostRecord.port); $(@($providers).Count) providers"
        }),
        (New-Step 'sign-in-console' 'auto' 'Sign in opens a visible console' @('POST /pe/providers/<id>/open-login must answer opened:true, and a new console window must exist.') {
            $providers = @(Invoke-HostRequest 'GET' '/pe/providers')
            $target = @($providers | Where-Object { $_.auth -ne 'ready' -and $_.state -ne 'ready' } | Select-Object -First 1)
            $id = if ($target.Count) { $target[0].id } else { 'codex' }
            $before = @(Get-Process powershell, pwsh, cmd, WindowsTerminal -ErrorAction SilentlyContinue | ForEach-Object Id)
            $answer = Invoke-HostRequest 'POST' "/pe/providers/$id/open-login" $null
            if (-not $answer.opened) { throw "open-login refused: $($answer | ConvertTo-Json -Compress)" }
            Start-Sleep -Seconds 3
            $made = @(Get-Process powershell, pwsh, cmd, WindowsTerminal -ErrorAction SilentlyContinue | Where-Object { $_.Id -notin $before -and $_.MainWindowHandle -ne 0 })
            if (-not $made.Count) { throw 'open-login said opened, but no console window with a handle appeared.' }
            "console for $id opened (pid $($made[0].Id))"
        }),
        (New-Step 'paste-code' 'human' 'The console accepts a pasted code and closes when finished' @(
            'In the console the previous step opened, finish the sign-in in the browser it opens.',
            'Paste the code the provider shows (Claude: the OAuth code) into the console with right-click or Ctrl+V.',
            'SEE: the code lands in the console, the sign-in completes, and the console closes by itself.',
            'SEE: Settings > Providers shows the provider ready without a restart.') $null),
        (New-Step 'login-expired' 'human' 'A revoked login reads expired, not ready' @(
            'Revoke the signed-in subscription from the provider account page (or delete its token in the harness credential store).',
            'In Pea, send any message with that provider selected.',
            'SEE: Send is refused in the provider words, "<Harness> sign-in expired. Sign in again.", and the composer offers the repair.',
            'SEE: the provider row in Settings reads signed-in expired, not ready.') $null),
        (New-Step 'quit-guard' 'human' 'Quit host asks before cutting a running turn' @(
            'Start a long Pea turn (ask it to count slowly to 200, one number per line).',
            'Right-click the tray icon and choose Quit host.',
            'SEE: a dialog says 1 Pea turn is running and asks Quit anyway?',
            'Choose No: SEE the host and the turn carry on. Quit again and choose Yes: SEE the host stop and the tray go.') $null),
        (New-Step 'update-reopen' 'human' 'An update reopens the tray window on the same route' $(if ($NextInstaller) { @(
            'Open the tray window and navigate to /machine (or a Pea thread) so the route is not Home.',
            "Install the next version over this one: msiexec /i `"$NextInstaller`" /qn /norestart (or use the in-app Update).",
            'SEE: after the host restarts, the tray window comes back by itself on the same route.',
            'Then Quit host from the tray, launch Pe.Tools from Start: SEE the window does NOT open by itself.') } else { @(
            'Not run: pass -NextInstaller <newer msi> to name the version to update to.') }) $null)
    )
    $steps
}

function Invoke-Crossing([string]$Installer, [string]$NextInstaller, [string]$Out, [bool]$Execute) {
    if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw "Installer not found: $Installer" }
    if ([IO.Path]::GetExtension($Installer) -ne '.msi') { throw 'The installer must be the final MSI.' }
    if ($NextInstaller -and -not (Test-Path -LiteralPath $NextInstaller -PathType Leaf)) { throw "Next installer not found: $NextInstaller" }
    $hash = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
    $plan = Get-CrossingPlan $Installer $NextInstaller $Out
    $report = [ordered]@{ installer = $Installer; sha256 = $hash; execute = $Execute; startedUtc = [DateTime]::UtcNow.ToString('o'); steps = @() }
    if ($Execute) {
        $script:hostRecord = $null
        if (Test-ProductInstalled) { throw 'Pe.Tools is already installed here. Run the crossing on a clean machine or a Windows Sandbox guest, never over an owner install.' }
        if (@(Get-Process Revit -ErrorAction SilentlyContinue).Count) { throw 'Revit is running. The crossing installs and restarts products; close it first.' }
        New-Item -ItemType Directory -Force -Path $Out | Out-Null
    }
    foreach ($step in $plan) {
        $entry = [ordered]@{ id = $step.id; mode = $step.mode; title = $step.title; instructions = $step.instructions; outcome = 'planned' }
        if ($Execute -and $step.mode -eq 'auto') {
            try { $entry.outcome = 'passed'; $entry.detail = & $step.run } catch { $entry.outcome = 'failed'; $entry.detail = $_.Exception.Message }
        } elseif ($step.mode -eq 'human') { $entry.outcome = 'human' }
        $report.steps += $entry
        if ($entry.outcome -eq 'failed') { break }
    }
    $report
}

if ($MyInvocation.InvocationName -eq '.') { return }
$report = Invoke-Crossing $Installer $NextInstaller $Out $Execute.IsPresent
if ($Execute) { $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Out 'crossing.json') -Encoding UTF8 }
Write-Output ('Crossing for {0} (sha256 {1}) -- {2}' -f $report.installer, $report.sha256.Substring(0, 12), $(if ($Execute) { 'executed' } else { 'plan only, nothing was installed or started' }))
$n = 0
foreach ($step in $report.steps) {
    $n++
    Write-Output ('{0}. [{1}] {2}: {3}' -f $n, $step.mode.ToUpper(), $step.title, $step.outcome)
    if ($step.detail) { Write-Output ('     ' + $step.detail) }
    if ($step.mode -eq 'human' -or -not $Execute) { foreach ($line in $step.instructions) { Write-Output ('     - ' + $line) } }
}
if ($Execute) { Write-Output ('Report: ' + (Join-Path $Out 'crossing.json')) }
if (@($report.steps | Where-Object outcome -eq 'failed').Count) { exit 1 }
