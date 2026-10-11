function Invoke-GateSdk($exe, $arguments, $name) {
    & $exe @arguments --json > "$run\$name.json" 2> "$run\$name.stderr.txt"
    $code = $LASTEXITCODE
    @{ name = $name; argv = $arguments; executable = $exe; sha256 = (Get-FileHash $exe).Hash; exitCode = $code } | ConvertTo-Json -Compress | Add-Content "$run\commands.jsonl"
    return Get-Content "$run\$name.json" -Raw | ConvertFrom-Json
}
function AssertCandidate($plan, $config, [long]$candidateLength) {
    $msi = @($config.files | Where-Object role -eq 'candidateMsi')[0]
    if (!$plan.available -or $plan.current -ne $config.previousVersion -or $plan.latest -ne $config.candidateVersion -or $plan.msi.digest -ne ('sha256:' + $msi.sha256.ToLowerInvariant()) -or $plan.msi.size -ne $candidateLength) { throw 'Published feed does not offer the exact expected candidate.' }
    if (@($plan.revits).Count -ne 0 -or @($plan.effects.restartYears).Count -ne 0 -or @($plan.effects.reopen).Count -ne 0 -or @($plan.blockers).Count -ne 0) { throw 'Sandbox update must have an empty Revit fleet and no document restoration.' }
}
function AssertTerminal($receipt) {
    if ($receipt.state -ne 'ok' -or @($receipt.legs | Where-Object { $_.status -in 'failed', 'refused', 'warning' }).Count -or !@($receipt.legs | Where-Object { $_.name -eq 'install' -and $_.status -eq 'ok' -and $_.exitCode -in 0, 3010 }).Count -or !@($receipt.legs | Where-Object { $_.name -eq 'done' -and $_.status -eq 'ok' }).Count) { throw 'Update has no successful terminal installation/restoration receipt.' }
}

function Invoke-GateMcpRead([string]$BaseUrl, [string]$Output) {
    $headers = @{ 'x-pe-runtime-service' = 'host'; Accept = 'application/json, text/event-stream' }
    $sessionId = $null; $failure = $null; $cleanupFailed = $false
    function Rpc($name, $body) {
        $request = $body | ConvertTo-Json -Depth 15 -Compress
        $request | Set-Content "$Output\$name.request.json"
        $response = Invoke-WebRequest "$BaseUrl/mcp" -Method Post -UseBasicParsing -Headers $headers -ContentType 'application/json' -Body $request -TimeoutSec 30
        $response.Content | Set-Content "$Output\$name.response.json"
        @{ method = 'POST'; url = "$BaseUrl/mcp"; headers = $headers; status = $response.StatusCode } | ConvertTo-Json -Depth 5 -Compress | Add-Content "$Output\mcp-http.jsonl"
        return $response
    }
    try {
        $init = Rpc 'initialize' @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{ protocolVersion = '2025-11-25'; capabilities = @{}; clientInfo = @{ name = 'installed-boundary-proof'; version = '1' } } }
        $sessionId = $init.Headers['mcp-session-id']
        if ($sessionId) { $headers['mcp-session-id'] = $sessionId; $headers['mcp-protocol-version'] = '2025-11-25' }
        $initial = $init.Content | ConvertFrom-Json
        if ($init.StatusCode -ne 200 -or $initial.jsonrpc -ne '2.0' -or $initial.error -or $initial.id -ne 1 -or $initial.result.protocolVersion -ne '2025-11-25' -or !$sessionId) { throw 'MCP initialization failed.' }
        $notification = Rpc 'initialized' @{ jsonrpc = '2.0'; method = 'notifications/initialized' }
        if ($notification.StatusCode -ne 202) { throw 'MCP initialized notification was not accepted.' }
        $response = Rpc 'find' @{ jsonrpc = '2.0'; id = 2; method = 'tools/call'; params = @{ name = 'pe_find'; arguments = @{} } }
        $answer = $response.Content | ConvertFrom-Json
        if ($response.StatusCode -ne 200 -or $answer.jsonrpc -ne '2.0' -or $answer.error -or $answer.id -ne 2 -or $answer.result.isError) { throw ('Installed MCP pe_find failed: ' + $response.Content) }
        $content = @($answer.result.content | Where-Object type -eq 'text')
        if ($content.Count -ne 1) { throw 'One structured capability map required.' }
        $map = $content[0].text | ConvertFrom-Json
        if (!$map.map -or !$map.sources -or !($map.PSObject.Properties.Name -contains 'sessions') -or @($map.sessions).Count -ne 0) { throw 'Expected a real no-Revit capability map.' }
        $map | ConvertTo-Json -Depth 30 | Set-Content "$Output\capability-map.json"
    } catch { $failure = $_.Exception.Message } finally {
        if ($sessionId) {
            try {
                $closed = Invoke-WebRequest "$BaseUrl/mcp" -Method Delete -UseBasicParsing -Headers $headers -TimeoutSec 10
                @{ method = 'DELETE'; url = "$BaseUrl/mcp"; headers = $headers; status = $closed.StatusCode } | ConvertTo-Json -Depth 5 | Set-Content "$Output\session-close.json"
                if ($closed.StatusCode -ne 200) { throw "MCP session close returned $($closed.StatusCode)." }
            } catch { $cleanupFailed = $true; $failure = (($failure, ('MCP cleanup failed: ' + $_.Exception.Message) | Where-Object { $_ }) -join '; ') }
        }
    }
    @{ state = $(if ($failure) { 'UNPROVEN' } else { 'PROVEN' }); lane = 'mcp-read-protocol'; reason = $failure; cleanupFailed = $cleanupFailed; tool = 'pe_find'; inference = 'not invoked' } | ConvertTo-Json | Set-Content "$Output\protocol-result.json"
    if ($failure) { throw $failure }
}
