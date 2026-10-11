function Read-GateUpdateReceipt([string]$Directory, [string]$RequestId, [string]$PlanId, [string]$Output) {
    if ($RequestId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'Noncanonical update request' }
    if (![IO.Directory]::Exists($Directory)) { return $null }
    $files = @([IO.Directory]::GetFiles($Directory, $RequestId + '.*.started.json'))
    if (!$files.Count) { return $null }
    if ($files.Count -ne 1) { throw 'Ambiguous started receipt for actual admission' }
    $startedPath = $files[0]
    $started = [IO.File]::ReadAllText($startedPath) | ConvertFrom-Json
    if ($started.requestId -ne $RequestId -or $started.key -ne 'update.apply' -or $started.body.requestId -ne $RequestId -or $started.body.planId -ne $PlanId -or $started.body.receiptPath -ne $startedPath) { throw 'Raw update receipt identity mismatch' }
    [IO.Directory]::CreateDirectory($Output) | Out-Null
    [IO.File]::Copy($startedPath, (Join-Path $Output 'started.json'), $true)
    $legs = @($started.body.legs)
    $legsPath = $startedPath + '.legs.jsonl'
    if ([IO.File]::Exists($legsPath)) {
        $stream = [IO.File]::Open($legsPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $reader = New-Object IO.StreamReader($stream)
        try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
        [IO.File]::WriteAllText((Join-Path $Output 'legs.jsonl'), $raw)
        # A writer may be appending the last line. Only newline-terminated records are authoritative.
        $lines = $raw.Split([char]10)
        for ($index = 0; $index -lt $lines.Length - 1; $index++) {
            if (!$lines[$index].Trim()) { continue }
            $leg = $lines[$index] | ConvertFrom-Json
            if (!$leg.name -or $leg.status -notin 'started', 'ok', 'failed', 'refused', 'warning') { throw 'Malformed updater leg' }
            $legs += $leg
        }
    }
    $receipt = $started.body
    $receipt.legs = $legs
    $receipt.state = 'running'
    if (@($legs | Where-Object status -in 'failed', 'refused', 'warning').Count) { $receipt.state = 'failed' }
    elseif (@($legs | Where-Object { $_.name -eq 'done' -and $_.status -eq 'ok' }).Count) { $receipt.state = 'ok' }
    return $receipt
}
