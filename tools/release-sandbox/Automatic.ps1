function Wait-GateAutomaticAdmission {
    $claim=Get-Content "$root\state\service\host.json" -Raw | ConvertFrom-Json;$base='http://127.0.0.1:'+$claim.port
    $length=(Get-Item (Join-Path $inputRoot $candidate[0].name)).Length
    # The host atomically persists admission BEFORE SDK child effects. Bind its actual SDK plan,
    # never a planId from this observer's separate feed check or a forced recheck response.
    Check 'No redirected SDK root' (!$env:PE_SESSION_FILES_ROOT) $env:PE_SESSION_FILES_ROOT
    $planDirectory=Join-Path $env:LOCALAPPDATA 'Pe.Revit.Sdk\sessions\updates'
    $statePath=Join-Path $root 'state\host-update.json'
    $watchStarted=[datetime]::UtcNow; $baselineRequestIds=@()
    if (Test-Path $statePath) {
        Copy-Item $statePath "$run\baseline-host-update.json"
        $baseline=Get-Content "$run\baseline-host-update.json" -Raw | ConvertFrom-Json
        $baselineRequestIds+= $baseline.requestId
        Check 'No active prior host admission' ($baseline.receipt.state -in 'ok','failed','refused') $baseline
    }
    @{watchStartedUtc=$watchStarted.ToString('o');hostPid=$before.pid;hostStartUtc=$before.processStartUtc;instanceId=$before.instanceId;baselineRequestIds=$baselineRequestIds} | ConvertTo-Json -Depth 5 | Set-Content "$run\watch-start.json"
    $productManifest=Get-Content $manifest -Raw | ConvertFrom-Json
    $feed='https://api.github.com/repos/'+$productManifest.releases+'/releases/latest'
    $deadline=[datetime]::UtcNow.AddMinutes(15);$index=0;$recheckDue=[datetime]::MinValue
    do {
        NoRevit
        if (Test-Path $statePath) {
            Copy-Item $statePath "$run\admission-$index.json"
            $state=Get-Content "$run\admission-$index.json" -Raw | ConvertFrom-Json
            if ($state.requestId -and $baselineRequestIds -notcontains $state.requestId) {
                $planPath=Join-Path $planDirectory ($state.planId+'.plan.json')
                Check 'Actual admission SDK plan exists' (Test-Path $planPath) $planPath
                Copy-Item $planPath "$run\actual-admitted-plan.json"
                $actualPlan=Get-Content "$run\actual-admitted-plan.json" -Raw | ConvertFrom-Json
                AssertAutomaticAdmission $state $actualPlan $config $length $root $watchStarted $baselineRequestIds ([datetime]::Parse($before.processStartUtc)) $feed
                $requestId=$state.requestId;$admittedPlanId=$state.planId
                @{requestId=$requestId;planId=$admittedPlanId;candidateSha256=$candidate[0].sha256;sourceRevision=$sourceReceipt.sourceRevision;actualPlanHash=(Get-FileHash "$run\actual-admitted-plan.json").Hash} | ConvertTo-Json | Set-Content "$run\bound-automatic-admission.json"
                break
            }
        }
        # Previous host must remain exact until durable handoff. A shutdown between checks is re-read
        # against admission before calling it a readiness failure.
        try {
            $incumbent=Get-Process -Id $before.pid -ErrorAction Stop
            Check 'Original host identity until admission' ($incumbent.Path -eq $before.executable -and $incumbent.StartTime.ToUniversalTime() -eq [datetime]::Parse($before.processStartUtc).ToUniversalTime()) $incumbent.Id
            $claimNow=Get-Content "$root\state\service\host.json" -Raw | ConvertFrom-Json
            Check 'Original host claim until admission' ($claimNow.pid -eq $before.pid -and $claimNow.instanceId -eq $before.instanceId) $claimNow
        } catch {
            $identityError=$_
            if (Test-Path $statePath) {$race=Get-Content $statePath -Raw | ConvertFrom-Json;if ($race.requestId -and $baselineRequestIds -notcontains $race.requestId) {$index++;continue}}
            throw $identityError
        }
        # Machine feed cadence is30min; quiet eligibility refreshes only once at120s. Read-only
        # recheck primes the current exact feed without applying. The durable admission wins all races.
        if ([datetime]::UtcNow -ge $recheckDue) {
            $validatingOffer=$false
            try {
                $hostView=Invoke-RestMethod ($base+'/host/update?recheck') -Headers @{'x-pe-runtime-service'='host'} -TimeoutSec 45
                $validatingOffer=$true
                $hostView | ConvertTo-Json -Depth 25 | Set-Content "$run\host-view-$index.json"
                if ($hostView.plan.available) {
                    AssertCandidate $hostView.plan $config $length
                    Check 'Offered plan has previous installed root/feed' ($hostView.plan.installedRoot -eq $root -and $hostView.plan.feed -eq $feed) $hostView.plan
                } elseif ($hostView.plan) {Check 'Awaiting exact candidate publication' ($hostView.plan.current -eq $config.previousVersion -and !$hostView.plan.available) $hostView.plan}
            } catch {
                if ($validatingOffer) {throw}
                $_.Exception.ToString() | Set-Content "$run\recheck-error-$index.txt"
                if (Test-Path $statePath) {$race=Get-Content $statePath -Raw | ConvertFrom-Json;if ($race.requestId -and $baselineRequestIds -notcontains $race.requestId) {$index++;continue}}
                # Only a transport shutdown race is tolerated pending durable admission. A wrong
                # offered candidate/boundary check is a failure even if the service still responds.
                throw
            }
            $recheckDue=[datetime]::UtcNow.AddSeconds(30)
        }
        $index++;Start-Sleep -Seconds 1
    } while([datetime]::UtcNow -lt $deadline)
    Check 'Automatic admission observed' ($requestId -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') $requestId
    return [pscustomobject]@{requestId=$requestId;planId=$admittedPlanId}
}
function Wait-GateUpdate([string]$RequestId,[string]$PlanId) {
    $deadline=[datetime]::UtcNow.AddMinutes(10);$index=0
    $directory=Join-Path $env:LOCALAPPDATA 'Pe.Revit.Sdk\sessions\receipts\_update'
    do {
        NoRevit
        $raw=Read-GateUpdateReceipt $directory $RequestId $PlanId "$run\raw-receipts\$index"
        if ($raw -and $raw.state -eq 'failed') {throw 'Actual updater receipt contains a failed/refused/warning leg'}
        if ($raw -and $raw.state -eq 'ok') {
            AssertTerminal $raw
            if (!(Test-Path $cli)) {throw 'Updater declared done without installed CLI'}
            $poll=Invoke-GateSdk $cli @('--installed','op','result',$RequestId) ('receipt-'+$index)
            $terminal=$poll.result.response.result
            AssertTerminal $terminal
            Check 'Exact installed SDK terminal request and plan' ($terminal.requestId -eq $RequestId -and $terminal.planId -eq $PlanId -and $poll.result.requestId -eq $RequestId -and $poll.result.response.requestId -eq $RequestId) $terminal
            return $terminal
        }
        $index++;Start-Sleep -Seconds 2
    } while([datetime]::UtcNow -lt $deadline)
    throw 'Actual update receipt did not reach terminal in ten minutes; no retry'
}