param([string]$InputDirectory='C:\GateInput',[string]$Output='C:\GateEvidence')
$inputRoot=$InputDirectory
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if ($env:USERNAME -ne 'WDAGUtilityAccount' -or ($inputRoot -ne 'C:\GateInput' -and $inputRoot -notlike 'C:\GateEvidence\*') -or ($Output -ne 'C:\GateEvidence' -and $Output -notlike 'C:\GateEvidence\*')) {throw 'Owned mapped guest required'}
$run=$Output;if(Test-Path "$run\result.json"){throw 'Fresh output required'}
$run=$Output;New-Item -ItemType Directory $run -Force | Out-Null;Start-Transcript "$run\transcript.txt" | Out-Null
. "$inputRoot\Boundary.ps1"
. "$inputRoot\Evidence.ps1"
. "$inputRoot\AutomaticBoundary.ps1"
. "$inputRoot\Automatic.ps1"
. "$inputRoot\UpdateReceipt.ps1"
. "$inputRoot\CompareSdkClosure.ps1"
. "$inputRoot\InstalledClosure.ps1"
$hookStarted=$false
function Check($name,[bool]$passed,$detail) {@{name=$name;passed=$passed;detail=$detail;atUtc=[datetime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 20 -Compress | Add-Content "$run\checks.jsonl";if (!$passed){throw $name}}
function NoRevit {Check 'No Revit' (@(Get-Process Revit -ErrorAction SilentlyContinue).Count -eq 0) ''}
function Observe($name) {$deadline=[datetime]::UtcNow.AddSeconds(90);do {try {& "$inputRoot\Observe.ps1" -InstallRoot $root -Output "$run\$name.json";return (Get-Content "$run\$name.json" -Raw | ConvertFrom-Json)} catch {$lastError=$_.Exception.Message};Start-Sleep -Seconds 1} while([datetime]::UtcNow -lt $deadline);throw "Observer readiness timeout: $lastError"}
function Install($file,$arguments,$name) {
    $process=Start-Process $file -ArgumentList $arguments -PassThru -WindowStyle Hidden;$handle=$process.Handle
    if(!$process.WaitForExit(600000)){throw "$name timed out; no retry"}
    Check $name ($process.ExitCode -in 0,3010) $process.ExitCode
}
try {
    $config=Get-Content "$inputRoot\gate.json" -Raw | ConvertFrom-Json;Copy-Item "$inputRoot\source-spec.json" "$run\source-spec.json";Copy-Item "$inputRoot\gate.json" "$run\gate.json"
    Check 'Different exact versions' ($config.previousVersion -ne $config.candidateVersion) $config.candidateVersion
    foreach ($script in $config.scripts) {Check ('Script '+$script.name) ((Get-FileHash (Join-Path $inputRoot $script.name)).Hash -eq $script.sha256) $script.sha256}
    foreach ($file in $config.files) {Check ('Input '+$file.name) ((Get-FileHash (Join-Path $inputRoot $file.name)).Hash -eq $file.sha256) $file.sha256}
    $candidate=@($config.files | Where-Object role -eq 'candidateMsi');$source=@($config.files | Where-Object role -eq 'candidateReceipt')
    Check 'One final candidate MSI and receipt' ($candidate.Count -eq 1 -and $source.Count -eq 1) ''
    $receipt=Get-Content (Join-Path $inputRoot $source[0].name) -Raw | ConvertFrom-Json
    Check 'Original exact final candidate receipt' ($receipt.productKind -eq 'Msi' -and $receipt.releaseVersion -eq $config.candidateVersion -and $receipt.sha256 -eq $candidate[0].sha256 -and $receipt.sourceRevision -eq $config.sourceRevision -and $receipt.sourceRevision -match '^[0-9a-f]{40}$') $receipt
    $root=Join-Path $env:LOCALAPPDATA 'Positive Energy\Pe.Tools';$manifest=Join-Path $root 'product.payloads.json';$cli=Join-Path $root 'shims\pe-revit.exe'
    NoRevit;Add-Type -Path "$inputRoot\Windows.cs";[PeConsoleObserver]::StartEvents();$hookStarted=$true
    $controlPid=[PeConsoleObserver]::PulseControl();Start-Sleep -Milliseconds 500;$control=@([PeConsoleObserver]::DrainEvents());$control | ConvertTo-Json -Depth 20 | Set-Content "$run\observer-control.json"
    Check 'Native observer calibrated' (@($control | Where-Object {$_.Window.Displayed -and ($_.Window.ControlSentinel -or @($_.Ancestry | Where-Object Pid -eq $controlPid).Count)}).Count -gt 0 -and [PeConsoleObserver]::DroppedEvents() -eq 0) $controlPid
    $retainedInputs=@($config.files|Where-Object role -eq 'previousIdentity')
    if(!$retainedInputs.Count) {
        foreach($role in 'vcRuntime','dotnetRuntime') {
            $prerequisite=@($config.files|Where-Object role -eq $role)
            if($prerequisite.Count) {Install (Join-Path $inputRoot $prerequisite[0].name) ('/install /quiet /norestart /log "'+$run+'\'+$role+'.log"') $role}
        }
        $oldMsi=@($config.files|Where-Object role -eq 'previousMsi')[0]
        Install msiexec.exe ('/i "'+(Join-Path $inputRoot $oldMsi.name)+'" /qn /norestart /l*v "'+$run+'\previous-install.log"') 'Previous release direct admission'
    }
    ConvertTo-Json -InputObject @([PeConsoleObserver]::DrainEvents()) -Depth 20|Set-Content "$run\admission-window-events.json"
    Check 'Admission zero dropped events' ([PeConsoleObserver]::DroppedEvents() -eq 0) ''
    $installed=Get-Content $manifest -Raw|ConvertFrom-Json
    Check 'Authentic previous installed version' ($installed.version -eq $config.previousVersion) $installed.version
    Copy-Item $manifest "$run\previous-manifest.json";Assert-GateInstalledClosure 'previous'
    if(!$retainedInputs.Count -and !(Get-Process Pe.Host -ErrorAction SilentlyContinue)) {Start-Process (Join-Path $root 'bin\host\Pe.Host.exe') -ArgumentList '--open' -WindowStyle Hidden|Out-Null}
    try {$before=Observe 'before'} catch {
        $_.Exception.ToString()|Set-Content "$run\previous-host-unavailable.txt"
        $recovery=@($config.files|Where-Object role -eq 'recoveryZip')
        if(!$recovery.Count){throw 'Previous host unavailable; normal automatic update FALSIFIED; no external recovery input'}
        Expand-Archive (Join-Path $inputRoot $recovery[0].name) "$run\external-sdk"
        $cli="$run\external-sdk\Pe.Revit.Cli.exe"
        $recoveryPlan=Invoke-GateSdk $cli @('update','check','--manifest',$manifest) 'external-recovery-check';AssertCandidate $recoveryPlan.result $config (Get-Item (Join-Path $inputRoot $candidate[0].name)).Length
        $apply=Invoke-GateSdk $cli @('update','apply',$recoveryPlan.result.planId,'--manifest',$manifest) 'external-recovery-apply'
        $binding=[pscustomobject]@{requestId=$apply.result.requestId;planId=$recoveryPlan.result.planId};$mode='external-sdk-recovery'
    }
    if($before) {
        Check 'Previous responsive installed identity' ($before.version -eq $config.previousVersion) $before
        if($retainedInputs.Count) {$retained=Get-Content (Join-Path $inputRoot $retainedInputs[0].name) -Raw|ConvertFrom-Json;Check 'Exact retained previous incarnation' ($before.pid -eq $retained.pid -and $before.processStartUtc -eq $retained.processStartUtc -and $before.instanceId -eq $retained.instanceId) $retained}
        $sourceReceipt=$receipt;$binding=Wait-GateAutomaticAdmission;$mode='previous-host-automatic-update'
    }
    $requestId=$binding.requestId;$admittedPlanId=$binding.planId
    $terminal=Wait-GateUpdate $requestId $admittedPlanId
    $terminal | ConvertTo-Json -Depth 25 | Set-Content "$run\terminal-receipt.json"
    Copy-Item $terminal.receiptPath "$run\raw-started.json";Copy-Item ($terminal.receiptPath+'.legs.jsonl') "$run\raw-legs.jsonl"
    $work=Join-Path $env:TEMP ('Pe.Revit.Sdk\update\'+$requestId);Copy-Item $work "$run\sdk-work" -Recurse
    $stub=Get-Content "$run\sdk-work\update.ps1" -Raw
    $waitLine=[regex]::Match($stub,'(?m)^\$waitPids = @\(([^)]*)\)').Groups[1].Value
    $waitIds=@($waitLine.Split(',') | ForEach-Object {$_.Trim()})
    if($before){Check 'Automatic stub waits original host PID' ($waitIds -contains [string]$before.pid) $waitIds}
    $consumed=@(Get-ChildItem "$run\sdk-work" -Recurse -Filter '*.msi');Check 'One exact consumed final candidate MSI' ($consumed.Count -eq 1 -and (Get-FileHash $consumed[0].FullName).Hash -eq $candidate[0].sha256) $candidate[0].sha256
    $after=Observe 'after';Check 'Responsive successor incarnation' ($after.version -eq $config.candidateVersion -and (!$before -or $after.instanceId -ne $before.instanceId)) $after
    Assert-GateInstalledClosure
    & "$inputRoot\ReadInstalledMcp.ps1" -InstallRoot $root -Output "$run\installed-mcp"
    Copy-Item $manifest "$run\candidate-manifest.json"
    # Observe helper already binds the actual claimed port/PID/tray. Read current claim for canonical status.
    $claimAfter=Get-Content "$root\state\service\host.json" -Raw | ConvertFrom-Json
    $status=Invoke-RestMethod ('http://127.0.0.1:'+$claimAfter.port+'/host/status') -Headers @{'x-pe-runtime-service'='host'} -TimeoutSec 10
    $status | ConvertTo-Json -Depth 20 | Set-Content "$run\successor-status.json"
    Check 'Successor canonical installed owner' ($status.installedRoot -eq $root -and $status.serviceName -eq 'host' -and $status.sourceRoot -eq $null -and $status.processId -eq $after.pid) $status
    $second=Start-Process (Join-Path $root 'bin\host\Pe.Host.exe') -ArgumentList '--open' -WindowStyle Hidden -PassThru
    $secondHandle=$second.Handle
    if(!$second.WaitForExit(60000)){throw 'Second --open did not exit; no retry'}
    Check 'Second open exits successfully' ($second.ExitCode -eq 0) $second.ExitCode
    $reused=Observe 'second-open'
    Check 'Second open reuses exact successor identity and tray' ($reused.pid -eq $after.pid -and $reused.processStartUtc -eq $after.processStartUtc -and $reused.instanceId -eq $after.instanceId -and (($reused.tray|ConvertTo-Json -Compress) -eq ($after.tray|ConvertTo-Json -Compress))) $reused
    $quietStarted=[datetime]::UtcNow
    $quietDeadline=$quietStarted.AddSeconds(120)
    while([datetime]::UtcNow -lt $quietDeadline) {NoRevit;$quiet=Observe ('quiet-'+[datetime]::UtcNow.ToString('HHmmss'));Check 'Successor identity stable' ($quiet.pid -eq $after.pid -and $quiet.instanceId -eq $after.instanceId) $quiet.pid;Start-Sleep -Seconds 5}
    @{startedUtc=$quietStarted.ToString('o');completedUtc=[datetime]::UtcNow.ToString('o');seconds=([datetime]::UtcNow-$quietStarted).TotalSeconds}|ConvertTo-Json|Set-Content "$run\quiet-interval.json"
    $events=@([PeConsoleObserver]::DrainEvents());ConvertTo-Json -InputObject $events -Depth 25 | Set-Content "$run\window-events.json"
    Check 'Zero dropped events' ([PeConsoleObserver]::DroppedEvents() -eq 0) ''
    Assert-GateConsoleEvents $events $root
    & "$inputRoot\CaptureDesktop.ps1" -Output "$run\desktop-physical.png"
    $successResult=@{state=$(if($mode -eq 'previous-host-automatic-update'){'PROVEN'}else{'UNPROVEN'});lane='installed-sandbox';mode=$mode;previous=$config.previousVersion;candidate=$config.candidateVersion;requestId=$requestId;planId=$admittedPlanId;ui='Physical full desktop captured; human image inspection separately required';directAdmission='Separate from automatic update';recovery='Never proves ordinary automatic update'}
} catch {$_.Exception.ToString() | Set-Content "$run\failure.txt";@{state='UNPROVEN';reason=$_.Exception.Message} | ConvertTo-Json | Set-Content "$run\result.json"} finally {
    Complete-GateEvidence $run {
        try {
            if ($hookStarted) {
                try {
                    $remaining=@([PeConsoleObserver]::DrainEvents())
                    ConvertTo-Json -InputObject $remaining -Depth 25 | Set-Content "$run\remaining-events.json"
                    @{droppedEvents=[PeConsoleObserver]::DroppedEvents()} | ConvertTo-Json | Set-Content "$run\observer-final.json"
                    Check 'Final zero dropped events' ([PeConsoleObserver]::DroppedEvents() -eq 0) ''
                    Assert-GateConsoleEvents $remaining $root
                } finally {[PeConsoleObserver]::StopEvents()}
            }
        } finally {Stop-Transcript | Out-Null}
    } $successResult
}
