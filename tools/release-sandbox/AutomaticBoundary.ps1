function AssertAutomaticAdmission($admission,$plan,$config,[long]$candidateLength,[string]$installRoot,[datetime]$watchStarted,$baselineRequestIds,[datetime]$hostStarted,[string]$feed) {
    if ($admission.requestId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or $admission.planId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {throw 'Automatic admission IDs are not canonical'}
    if ($baselineRequestIds -contains $admission.requestId -or [datetime]::Parse($admission.admittedAtUtc).ToUniversalTime() -lt $watchStarted.ToUniversalTime()) {throw 'Stale prior request is not automatic crossing proof'}
    if ($plan.planId -ne $admission.planId -or $plan.product -ne 'Pe.Tools' -or $plan.installedRoot -ne $installRoot -or $plan.feed -ne $feed -or [datetime]::Parse($plan.observedAtUtc).ToUniversalTime() -lt $hostStarted.ToUniversalTime() -or [datetime]::Parse($plan.observedAtUtc).ToUniversalTime() -gt [datetime]::Parse($admission.admittedAtUtc).ToUniversalTime()) {throw 'Actual admission SDK plan root/feed/identity/time is not bound'}
    AssertCandidate $plan $config $candidateLength
    if (@($plan.effects.close).Count -ne 0 -or !$plan.quiet) {throw 'Automatic Sandbox plan must be quiet with no Revit close effects'}
}
