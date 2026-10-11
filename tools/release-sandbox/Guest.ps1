$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:USERNAME -ne 'WDAGUtilityAccount' -or !(Test-Path 'C:\GateInput\gate.json') -or !(Test-Path 'C:\GateEvidence')) { throw 'Windows Sandbox mapped gate inputs required.' }
$run = 'C:\GateEvidence'
Start-Transcript "$run\transcript.txt" | Out-Null
. C:\GateInput\Boundary.ps1
$hookStarted = $false
function Install($file, $arguments, $name) {
    $p = Start-Process $file -ArgumentList $arguments -PassThru -WindowStyle Hidden
    if (!$p.WaitForExit(600000)) { throw "$name timed out; no retry" }
    Check $name ($p.ExitCode -in 0, 3010) $p.ExitCode
}
function Observe($root, $name) {
    $deadline = [datetime]::UtcNow.AddSeconds(90)
    do {
        try { & C:\GateInput\Observe.ps1 -InstallRoot $root -Output "$run\$name.json"; return Get-Content "$run\$name.json" -Raw | ConvertFrom-Json } catch { $lastObservationError = $_.Exception.Message }
        Start-Sleep -Seconds 1
    } while ([datetime]::UtcNow -lt $deadline)
    throw "$name readiness timed out: $lastObservationError"
}
function Check($name, [bool]$passed, $detail) {
    @{ name = $name; passed = $passed; detail = $detail; observedAtUtc = [datetime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 10 -Compress | Add-Content "$run\checks.jsonl"
    if (!$passed) { throw $name }
}
try {
    Copy-Item C:\GateInput\source-spec.json "$run\source-spec.json"
    $config = Get-Content C:\GateInput\gate.json -Raw | ConvertFrom-Json
    foreach ($file in $config.files) {
        Check "input $($file.name)" ((Get-FileHash -LiteralPath "C:\GateInput\$($file.name)").Hash -eq $file.sha256) $file.sha256
    }
    Check 'No Revit process' (@(Get-Process Revit -ErrorAction SilentlyContinue).Count -eq 0) 'No Autodesk product is launched by this gate.'
    Add-Type -Path C:\GateInput\Windows.cs
    [PeConsoleObserver]::StartEvents(); $hookStarted = $true
    $controlPid = [PeConsoleObserver]::PulseControl()
    Start-Sleep -Milliseconds 500
    $control = @([PeConsoleObserver]::DrainEvents())
    $control | ConvertTo-Json -Depth 15 | Set-Content "$run\observer-control.json"
    Check 'Observer positive control' (@($control | Where-Object { $_.Window.Displayed -and ($_.Window.ControlSentinel -or @($_.Ancestry | Where-Object Pid -eq $controlPid).Count) }).Count -gt 0) $controlPid
    foreach ($role in 'vcRuntime', 'dotnetRuntime') {
        $prerequisite = @($config.files | Where-Object role -eq $role)
        if ($prerequisite.Count -eq 1) { Install ('C:\GateInput\' + $prerequisite[0].name) ('/install /quiet /norestart /log "' + $run + '\' + $role + '.log"') $role }
    }
    $oldMsi = @($config.files | Where-Object role -eq 'previousMsi')[0]
    Install msiexec.exe ('/i "C:\GateInput\' + $oldMsi.name + '" /qn /norestart /l*v "' + $run + '\previous-install.log"') 'Previous release admission'
    $root = Join-Path $env:LOCALAPPDATA 'Positive Energy\Pe.Tools'
    $manifest = Join-Path $root 'product.payloads.json'
    $installed = Get-Content $manifest -Raw | ConvertFrom-Json
    Check 'Previous release installed identity' ($installed.version -eq $config.previousVersion) $installed.version
    Copy-Item $manifest "$run\previous-manifest.json"
    $cli = Join-Path $root 'shims\pe-revit.exe'
    $candidate = @($config.files | Where-Object role -eq 'candidateMsi')[0]
    $length = (Get-Item ('C:\GateInput\' + $candidate.name)).Length
    $planEnvelope = Invoke-GateSdk $cli @('--installed', 'update', 'check', '--manifest', $manifest) 'previous-update-check'
    AssertCandidate $planEnvelope.result $config $length
    $exe = Join-Path $root 'bin\host\Pe.Host.exe'
    if (!(Get-Process Pe.Host -ErrorAction SilentlyContinue)) { Start-Process $exe -WindowStyle Hidden -PassThru | Out-Null }
    try { $before = Observe $root 'before' } catch {
        $_.Exception.ToString() | Set-Content "$run\previous-host-unavailable.txt"
        $recovery = @($config.files | Where-Object role -eq 'recoveryZip')
        if ($recovery.Count -ne 1) { throw 'Previous host unavailable; no hashed external SDK recovery package supplied.' }
        Expand-Archive ('C:\GateInput\' + $recovery[0].name) C:\GateRecovery
        $recoveryCli = 'C:\GateRecovery\Pe.Revit.Cli.exe'
        $recoveryPlan = Invoke-GateSdk $recoveryCli @('update', 'check', '--manifest', $manifest) 'recovery-check'
        AssertCandidate $recoveryPlan.result $config $length
        $apply = Invoke-GateSdk $recoveryCli @('update', 'apply', $recoveryPlan.result.planId, '--manifest', $manifest) 'recovery-apply'
        $requestId = $apply.result.requestId
        $admittedPlanId = $recoveryPlan.result.planId
        $cli = $recoveryCli
        $mode = 'external-sdk-recovery'
    }
    if ($before) {
        $mode = 'previous-host-self-update'
        $claim = Get-Content "$root\state\service\host.json" -Raw | ConvertFrom-Json
        $url = 'http://127.0.0.1:' + $claim.port + '/host/update'
        $update = Invoke-RestMethod ($url + '?recheck') -TimeoutSec 30
        $update | ConvertTo-Json -Depth 20 | Set-Content "$run\host-update-check.json"
        AssertCandidate $update.plan $config $length
        $body = @{ planId = $update.plan.planId } | ConvertTo-Json -Compress
        $body | Set-Content "$run\host-update-request.json"
        $reply = Invoke-RestMethod $url -Method Post -ContentType application/json -Headers @{ 'x-pe-service-token' = $claim.token; Origin = 'http://127.0.0.1:' + $claim.port } -Body $body -TimeoutSec 90
        $reply | ConvertTo-Json -Depth 20 | Set-Content "$run\host-update-ack.json"
        Check 'Host accepted update' $reply.accepted $reply
        $requestId = $reply.requestId
        $admittedPlanId = $update.plan.planId
    }
    Check 'Update request identity' ($requestId -match '^[a-f0-9-]{36}$') $requestId
    $deadline = [datetime]::UtcNow.AddMinutes(10); $index = 0
    do {
        Check 'No Revit during update' (@(Get-Process Revit -ErrorAction SilentlyContinue).Count -eq 0) ''
        $poll = Invoke-GateSdk $cli @('--installed', 'op', 'result', $requestId) ('receipt-' + $index++)
        $receipt = $poll.result.response.result
        try { AssertTerminal $receipt; break } catch { $receiptError = $_.Exception.Message }
        if ($receipt.state -in 'failed', 'refused') { throw "Update terminal failure: $($receipt | ConvertTo-Json -Depth 20 -Compress)" }
        Start-Sleep -Seconds 2
    } while ([datetime]::UtcNow -lt $deadline)
    AssertTerminal $receipt
    Check 'Terminal receipt bound to request and plan' ($receipt.requestId -eq $requestId -and $receipt.planId -eq $admittedPlanId -and $poll.result.requestId -eq $requestId -and $poll.result.response.requestId -eq $requestId) $receipt
    $receipt | ConvertTo-Json -Depth 20 | Set-Content "$run\terminal-receipt.json"
    Copy-Item -LiteralPath $receipt.receiptPath -Destination "$run\raw-started-receipt.json"
    if (Test-Path ($receipt.receiptPath + '.legs.jsonl')) { Copy-Item -LiteralPath ($receipt.receiptPath + '.legs.jsonl') -Destination "$run\raw-legs.jsonl" }
    $after = Observe $root 'after'
    Check 'Responsive candidate identity' ($after.version -eq $config.candidateVersion -and (!$before -or $after.instanceId -ne $before.instanceId)) $after
    Copy-Item $manifest "$run\candidate-manifest.json"
    Start-Sleep -Seconds 45
    $events = @([PeConsoleObserver]::DrainEvents())
    $events | ConvertTo-Json -Depth 20 | Set-Content "$run\window-events.json"
    Check 'Observer dropped no events' ([PeConsoleObserver]::DroppedEvents() -eq 0) ([PeConsoleObserver]::DroppedEvents())
    $ownedShows = @($events | Where-Object { $_.Window.Displayed -and @($_.Ancestry | Where-Object { $_.Executable -like ($root + '\*') }).Count })
    Check 'No visible product console' ($ownedShows.Count -eq 0) $ownedShows
    @{ state = $(if ($mode -eq 'previous-host-self-update') { 'PROVEN' } else { 'UNPROVEN' }); lane = 'installed-sandbox'; mode = $mode; requestId = $requestId; uiBehavior = 'Tray child verified; tray icon and app window interaction UNPROVEN' } | ConvertTo-Json | Set-Content "$run\result.json"
} catch {
    $_.Exception.ToString() | Set-Content "$run\failure.txt"
    @{ state = 'UNPROVEN'; reason = $_.Exception.Message } | ConvertTo-Json | Set-Content "$run\result.json"
} finally {
    if ($hookStarted) {
        @([PeConsoleObserver]::DrainEvents()) | ConvertTo-Json -Depth 20 | Set-Content "$run\remaining-window-events.json"
        @{ droppedEvents = [PeConsoleObserver]::DroppedEvents() } | ConvertTo-Json | Set-Content "$run\observer-final.json"
        [PeConsoleObserver]::StopEvents()
    }
    Stop-Transcript | Out-Null
    Get-ChildItem -LiteralPath $run -File | Where-Object Name -ne 'output-hashes.json' | Get-FileHash -Algorithm SHA256 | Select-Object Hash, Path | ConvertTo-Json | Set-Content "$run\output-hashes.json"
}
