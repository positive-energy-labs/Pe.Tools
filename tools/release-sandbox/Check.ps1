$ErrorActionPreference = 'Stop'
$scratch = Join-Path $env:TEMP ('pe-sandbox-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $scratch | Out-Null
try {
    . "$PSScriptRoot\Boundary.ps1"
    . "$PSScriptRoot\Evidence.ps1"
    . "$PSScriptRoot\AutomaticBoundary.ps1"
    . "$PSScriptRoot\UpdateReceipt.ps1"
    . "$PSScriptRoot\CompareSdkClosure.ps1"
    & "$PSScriptRoot\CheckAutomatic.ps1"
    Add-Type -Path "$PSScriptRoot\Windows.cs"
    $privateStatic = [Reflection.BindingFlags]'NonPublic,Static'
    $activeControl = [PeConsoleObserver].GetField('controlTitle', $privateStatic)
    $caption = 'PE_CONSOLE_OBSERVER_CONTROL_' + [guid]::NewGuid().ToString('N')
    $activeControl.SetValue($null, $caption)
    $controlTitle = [PeConsoleObserver].GetMethod('IsControlTitle', $privateStatic)
    foreach ($title in $caption, (' ' + $caption + ' ')) {
        if (!$controlTitle.Invoke($null, @($title))) { throw 'Exact trimmed control caption was refused.' }
    }
    foreach ($title in '', 'PE_CONSOLE_OBSERVER_CONTROL', ('PE_CONSOLE_OBSERVER_CONTROL_' + [guid]::NewGuid().ToString('N')), ($caption + '-other'), ('other-' + $caption)) {
        if ($controlTitle.Invoke($null, @($title))) { throw 'Unrelated caption was accepted as the control.' }
    }
    $controlMatch = [PeConsoleObserver].GetMethod('MatchesControl', $privateStatic)
    $controlStarted = [DateTime]::UtcNow
    $controlEvent = [PeConsoleObserver+EventEvidence]::new()
    $controlEvent.AtUtc = $controlStarted.ToString('o')
    $controlEvent.Window = [PeConsoleObserver+Window]::new(); $controlEvent.Window.Handle = 'control'; $controlEvent.Window.Displayed = $true; $controlEvent.Window.Title = $caption
    if (!$controlMatch.Invoke($null, @($controlEvent, 'control', $controlStarted)) -or $controlMatch.Invoke($null, @($controlEvent, 'foreign', $controlStarted)) -or $controlMatch.Invoke($null, @($controlEvent, 'control', $controlStarted.AddSeconds(1)))) { throw 'Control event accepted a different window or old event.' }
    $controlEvent.Window.Title = $caption + '-foreign'; $controlEvent.Window.ControlSentinel = $true
    if ($controlMatch.Invoke($null, @($controlEvent, 'control', $controlStarted))) { throw 'Stale sentinel flag accepted a foreign control caption.' }
    $activeControl.SetValue($null, $null)
    if ($controlTitle.Invoke($null, @($caption))) { throw 'Retired control caption remained eligible.' }
    $controlWait = [PeConsoleObserver].GetMethod('WaitForControl', $privateStatic)
    $controlDelay = [Diagnostics.Stopwatch]::StartNew()
    $controlWait.Invoke($null, @([Func[bool]]{ $controlDelay.ElapsedMilliseconds -ge 40 }, 1000))
    $refused = $false
    try { $controlWait.Invoke($null, @([Func[bool]]{ $false }, 40)) } catch {
        if ($_.Exception.GetBaseException() -isnot [TimeoutException]) { throw }
        $refused = $true
    }
    if (!$refused) { throw 'Never-visible control did not time out.' }
    foreach ($exit in 0, 7) {
        $process = Start-Process (Join-Path $PSHOME 'powershell.exe') -ArgumentList ('-NoProfile -NonInteractive -Command exit ' + $exit) -PassThru -WindowStyle Hidden
        $handle = $process.Handle
        if (!$process.WaitForExit(15000) -or $process.ExitCode -ne $exit) { throw 'Short-lived process collector lost exit code.' }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $packageDirectory = Join-Path $scratch 'sdk-package'; $shims = Join-Path $scratch 'sdk-shims'
    New-Item -ItemType Directory $packageDirectory, $shims | Out-Null
    '<package><metadata><version>0.1.0-beta.196</version></metadata></package>' | Set-Content "$packageDirectory\Pe.Revit.Cli.nuspec"
    foreach ($name in 'Pe.Revit.Cli.exe', 'Pe.Revit.Cli.dll', 'Pe.Revit.Cli.deps.json', 'Pe.Revit.Cli.runtimeconfig.json', 'loader/net48/Pe.Revit.Loader.dll', 'loader/net8.0-windows/Pe.Revit.Loader.dll', 'bridge/net48/Pe.Revit.Bridge.dll', 'bridge/net8.0-windows/Pe.Revit.Bridge.dll', 'bootstrap/net48/Pe.Revit.Loader.Bootstrap.dll', 'bootstrap/net8.0-windows/Pe.Revit.Loader.Bootstrap.dll') {
        $original = Join-Path $packageDirectory ('tools/net8.0/any/' + $name)
        $installed = Join-Path $shims $(if ($name -eq 'Pe.Revit.Cli.exe') { 'pe-revit.exe' } else { $name })
        New-Item -ItemType Directory (Split-Path $original), (Split-Path $installed) -Force | Out-Null
        $name | Set-Content $original; Copy-Item $original $installed
    }
    $package = Join-Path $scratch 'sdk-closure.nupkg'; $archive = [IO.Compression.ZipFile]::Open($package, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem $packageDirectory -File -Recurse) {
            $name = $file.FullName.Substring($packageDirectory.Length + 1).Replace('\', '/')
            $entry = $archive.CreateEntry($name); $output = $entry.Open(); $input = [IO.File]::OpenRead($file.FullName)
            try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
        }
    } finally { $archive.Dispose() }
    CompareSdkClosure $package $shims '0.1.0-beta.196' "$scratch\sdk-closure.json"
    foreach ($bad in 'version', 'bytes') {
        if ($bad -eq 'bytes') { 'changed runtime' | Set-Content "$shims\Pe.Revit.Cli.dll" }
        $refused = $false
        try { CompareSdkClosure $package $shims $(if ($bad -eq 'version') { '0.1.0-beta.197' } else { '0.1.0-beta.196' }) "$scratch\sdk-refused-$bad.json" } catch { $refused = $true }
        if (!$refused) { throw 'Original SDK closure accepted changed version or bytes.' }
    }
    $evidence = Join-Path $scratch 'evidence'
    New-Item -ItemType Directory (Join-Path $evidence 'nested') -Force | Out-Null
    $activePath = Join-Path $evidence 'nested\redirect.txt'
    'active stdout bytes' | Set-Content $activePath
    $writer = [IO.File]::Open($activePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    try {
        Complete-GateEvidence $evidence {} @{ state = 'PROVEN' }
        $hashes = Get-Content "$evidence\output-hashes.json" -Raw | ConvertFrom-Json
        if (@($hashes | Where-Object Path -eq $activePath).Count -ne 1 -or (Get-Content "$evidence\result.json" -Raw | ConvertFrom-Json).state -ne 'PROVEN') { throw 'Active redirected file or nested evidence was omitted.' }
    } finally { $writer.Dispose() }
    foreach ($failure in 'cleanup', 'hash') {
        $refused = $false
        try {
            if ($failure -eq 'cleanup') { Complete-GateEvidence $evidence { throw 'Injected cleanup failure' } @{ state = 'PROVEN' } }
            else { Complete-GateEvidence $evidence {} @{ state = 'PROVEN' } { param($path) throw 'Injected hash failure' } }
        } catch { $refused = $true }
        $failed = Get-Content "$evidence\result.json" -Raw | ConvertFrom-Json
        if (!$refused -or $failed.state -eq 'PROVEN' -or ($failure -eq 'hash' -and !$failed.collectionFailed) -or ($failure -eq 'cleanup' -and !$failed.cleanupFailed)) { throw 'Finalization failure retained false success.' }
    }
    $run = $scratch
    $fakeSdk = Join-Path $scratch 'fake-sdk.ps1'
    '@{ result = @{ state = ''ok''; received = $args } } | ConvertTo-Json -Depth 5' | Set-Content $fakeSdk
    $fake = Invoke-GateSdk (Join-Path $PSHOME 'powershell.exe') @('-NoProfile', '-File', $fakeSdk, '--installed', 'value with spaces') 'fake-sdk'
    if ($fake.result.state -ne 'ok' -or $fake.result.received[0] -ne '--installed' -or $fake.result.received[1] -ne 'value with spaces' -or $fake.result.received[2] -ne '--json') { throw 'SDK invocation argv or JSON boundary broke.' }
    foreach ($script in Get-ChildItem $PSScriptRoot -Filter '*.ps1') {
        $tokens = $null; $errors = $null
        [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        if ($errors.Count) { throw ($errors | Out-String) }
    }
    $files = @()
    foreach ($release in 'previous', 'candidate') {
        $role = $release + 'Msi'
        $path = Join-Path $scratch ($role + '.msi')
        $role | Set-Content $path
        $hash = (Get-FileHash $path).Hash
        $files += @{ role = $role; name = $role + '.msi'; path = $path; sha256 = $hash }
        $role = $release + 'Receipt'
        $path = Join-Path $scratch ($role + '.json')
        @{ releaseVersion = $(if ($release -eq 'previous') { '1' } else { '2' }); productKind = 'Msi'; sourceRevision = ('a' * 40); sha256 = $hash } | ConvertTo-Json | Set-Content $path
        $files += @{ role = $role; name = $role + '.json'; path = $path; sha256 = (Get-FileHash $path).Hash }
    }
    foreach ($release in 'previous', 'candidate') {
        $path = Join-Path $scratch ($release + '.zip'); 'archive fixture' | Set-Content $path
        $hash = (Get-FileHash $path).Hash; $files += @{ role = $release + 'Zip'; name = $release + '.zip'; path = $path; sha256 = $hash }
        $path = Join-Path $scratch ($release + '-archive-receipt.json')
        @{ releaseVersion = $(if ($release -eq 'previous') { '1' } else { '2' }); productKind = 'InstallZip'; sourceRevision = ('a' * 40); sha256 = $hash } | ConvertTo-Json | Set-Content $path
        $files += @{ role = $release + 'ZipReceipt'; name = $release + '-archive-receipt.json'; path = $path; sha256 = (Get-FileHash $path).Hash }
    }
    $path = Join-Path $scratch 'sdk.nupkg'; 'exact package fixture' | Set-Content $path
    $files += @{ role = 'sdkPackage'; name = 'sdk.nupkg'; path = $path; sha256 = (Get-FileHash $path).Hash }
    $spec = Join-Path $scratch 'spec.json'
    @{ previousVersion = '1'; candidateVersion = '2'; expectedSdkVersion = '0.1.0-beta.196'; files = $files } | ConvertTo-Json -Depth 10 | Set-Content $spec
    $wsb = & "$PSScriptRoot\Prepare.ps1" -Spec $spec -RunDirectory "$scratch\run"
    $mcpStaged = "$scratch\run\input\ReadInstalledMcp.ps1"
    if (!(Test-Path $mcpStaged) -or (Get-FileHash $mcpStaged).Hash -ne (Get-FileHash "$PSScriptRoot\ReadInstalledMcp.ps1").Hash) { throw 'Installed MCP helper was not staged byte-identically.' }
    $stagedHashes = Get-Content "$scratch\run\input-hashes.json" -Raw | ConvertFrom-Json
    if (!@($stagedHashes | Where-Object { $_.Path -eq $mcpStaged -and $_.Hash -eq (Get-FileHash $mcpStaged).Hash }).Count) { throw 'MCP staged helper hash missing.' }
    foreach ($mode in 'ok', 'tool-failed', 'close-failed', 'malformed-map') {
        $fixtureOutput = Join-Path $scratch ('mcp-' + $mode)
        New-Item -ItemType Directory $fixtureOutput | Out-Null
        $job = Start-Job -ArgumentList $fixtureOutput, $mode -ScriptBlock {
            param($directory, $mode)
            $ErrorActionPreference = 'Stop'
            $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
            try {
                $listener.Start(); $listener.LocalEndpoint.Port | Set-Content "$directory\port.txt"
                for ($index = 0; $index -lt 4; $index++) {
                    $client = $listener.AcceptTcpClient(); $stream = $client.GetStream()
                    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $false, 1024, $true)
                    $line = $reader.ReadLine(); $method = $line.Split(' ')[0]; $headers = @{}
                    while (($line = $reader.ReadLine()) -ne '') { $colon = $line.IndexOf(':'); $headers[$line.Substring(0, $colon).ToLowerInvariant()] = $line.Substring($colon + 1).Trim() }
                    $body = ''
                    if ($headers['content-length']) { $buffer = New-Object char[] ([int]$headers['content-length']); $offset = 0; while ($offset -lt $buffer.Length) { $read = $reader.Read($buffer, $offset, $buffer.Length - $offset); if (!$read) { throw 'Fixture request body ended early.' }; $offset += $read }; $body = -join $buffer }
                    @{ method = $method; headers = $headers; body = $body } | ConvertTo-Json -Depth 8 -Compress | Add-Content "$directory\calls.jsonl"
                    $status = 200; $sessionHeader = ''; $value = @{}
                    if ($headers['x-pe-runtime-service'] -ne 'host') { throw 'Fixture request lost owner header.' }
                    if ($index -eq 0) { $value = @{ jsonrpc = '2.0'; id = 1; result = @{ protocolVersion = '2025-11-25' } }; $sessionHeader = "mcp-session-id: fixture-session`r`n" }
                    else {
                        if ($headers['mcp-session-id'] -ne 'fixture-session' -or $headers['mcp-protocol-version'] -ne '2025-11-25') { throw 'Fixture request lost protocol/session identity.' }
                        if ($index -eq 1) { if (($body | ConvertFrom-Json).method -ne 'notifications/initialized') { throw 'Wrong MCP notification.' }; $status = 202 }
                        elseif ($index -eq 2) {
                            $call = $body | ConvertFrom-Json
                            if ($call.method -ne 'tools/call' -or $call.params.name -ne 'pe_find' -or @($call.params.arguments.PSObject.Properties).Count -ne 0) { throw 'Expected read-only pe_find with empty arguments.' }
                            $map = @{ map = @(@{ id = 'fixture-read' }); sources = @(@{ kind = 'fixture' }); sessions = @() } | ConvertTo-Json -Depth 8 -Compress
                            if ($mode -eq 'malformed-map') { $map = '{}' }
                            $value = @{ jsonrpc = '2.0'; id = 2; result = @{ isError = ($mode -eq 'tool-failed'); content = @(@{ type = 'text'; text = $map }) } }
                        } else { if ($method -ne 'DELETE') { throw 'MCP session was not closed.' }; if ($mode -eq 'close-failed') { $status = 500 } }
                    }
                    $json = $value | ConvertTo-Json -Depth 15 -Compress; $bytes = [Text.Encoding]::UTF8.GetBytes($json)
                    $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status Fixture`r`nContent-Type: application/json`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n$sessionHeader`r`n")
                    $stream.Write($head, 0, $head.Length); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush(); $reader.Dispose(); $client.Dispose()
                }
            } finally { $listener.Stop() }
        }
        try {
            $deadline = [datetime]::UtcNow.AddSeconds(15)
            while (!(Test-Path "$fixtureOutput\port.txt") -and [datetime]::UtcNow -lt $deadline -and $job.State -eq 'Running') { Start-Sleep -Milliseconds 100 }
            if (!(Test-Path "$fixtureOutput\port.txt")) { throw 'Owned MCP fixture did not start.' }
            $port = (Get-Content "$fixtureOutput\port.txt" -Raw).Trim()
            $failed = $false
            try { Invoke-GateMcpRead ('http://127.0.0.1:' + $port) $fixtureOutput } catch { $failed = $true }
            $proof = Get-Content "$fixtureOutput\protocol-result.json" -Raw | ConvertFrom-Json
            if ($failed -ne ($mode -ne 'ok') -or ($proof.state -eq 'PROVEN') -ne ($mode -eq 'ok') -or $proof.cleanupFailed -ne ($mode -eq 'close-failed')) { throw "MCP protocol/cleanup result wrong for $mode." }
            $calls = @(Get-Content "$fixtureOutput\calls.jsonl" | ForEach-Object { $_ | ConvertFrom-Json })
            if ($calls.Count -ne 4 -or $calls[3].method -ne 'DELETE') { throw 'MCP fixture was not closed after tool/error response.' }
            $job | Wait-Job -Timeout 5 | Out-Null
            $job | Receive-Job -ErrorAction Stop | Out-Null
            if ($job.State -ne 'Completed') { throw 'MCP fixture did not terminate.' }
        } finally { if ($job.State -eq 'Running') { $job | Stop-Job }; $job | Remove-Job -Force }
    }
    $config = Get-Content $spec -Raw | ConvertFrom-Json
    $plan = [pscustomobject]@{ available = $true; current = '1'; latest = '2'; msi = @{ digest = 'sha256:' + $files[2].sha256.ToLowerInvariant(); size = 20 }; revits = @(); effects = @{ restartYears = @(); reopen = @() }; blockers = @() }
    AssertCandidate $plan $config 20
    $plan.latest = '3'
    $refused = $false
    try { AssertCandidate $plan $config 20 } catch { $refused = $true }
    if (!$refused) { throw 'Wrong published candidate accepted.' }
    $receipt = [pscustomobject]@{ state = 'ok'; legs = @(@{ name = 'install'; status = 'ok'; exitCode = 0 }, @{ name = 'done'; status = 'ok' }) }
    AssertTerminal $receipt
    $receipt.legs = @(@{ name = 'handoff'; status = 'ok' })
    $refused = $false
    try { AssertTerminal $receipt } catch { $refused = $true }
    if (!$refused) { throw 'Handoff accepted as terminal update.' }
    Assert-GateConsoleEvents @(@{ Window = @{ Displayed = $true }; Ancestry = @(@{ Executable = 'C:\Foreign\console.exe' }) }) 'C:\FixtureProduct'
    $refused = $false
    try { Assert-GateConsoleEvents @(@{ Window = @{ Displayed = $true }; Ancestry = @(@{ Executable = 'C:\FixtureProduct\bin\host\Pe.Host.exe' }) }) 'C:\FixtureProduct' } catch { $refused = $true }
    if (!$refused) { throw 'Final drain allowed a product-owned visible console.' }
    $request = '11111111-2222-3333-4444-555555555555'; $planId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    $rawDirectory = Join-Path $scratch 'raw-receipts'; New-Item -ItemType Directory $rawDirectory | Out-Null
    $startedPath = Join-Path $rawDirectory ($request + '.123-456.started.json')
    @{ requestId = $request; key = 'update.apply'; body = @{ requestId = $request; planId = $planId; receiptPath = $startedPath; legs = @(); state = 'running' } } | ConvertTo-Json -Depth 6 | Set-Content $startedPath
    '{"name":"install","status":"started"}' | Set-Content ($startedPath + '.legs.jsonl')
    $raw = Read-GateUpdateReceipt $rawDirectory $request $planId "$scratch\raw-observation"
    if ($raw.state -ne 'running' -or (Test-Path "$scratch\absent-installed-cli.exe")) { throw 'Missing CLI observation fixture broke.' }
    '{"name":"install","status":"ok","exitCode":0}' | Add-Content ($startedPath + '.legs.jsonl')
    '{"name":"done","status":"ok"}' | Add-Content ($startedPath + '.legs.jsonl')
    $raw = Read-GateUpdateReceipt $rawDirectory $request $planId "$scratch\raw-terminal"; AssertTerminal $raw
    $refused = $false
    try { Read-GateUpdateReceipt $rawDirectory $request 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' "$scratch\wrong-plan" | Out-Null } catch { $refused = $true }
    if (!$refused) { throw 'Wrong plan accepted by raw receipt observer.' }
    $xml = [xml](Get-Content $wsb -Raw)
    $maps = @($xml.Configuration.MappedFolders.MappedFolder)
    if ($maps.Count -ne 2 -or $maps[0].ReadOnly -ne 'true' -or $maps[1].ReadOnly -ne 'false' -or $maps[0].SandboxFolder -ne 'C:\GateInput' -or $maps[1].SandboxFolder -ne 'C:\GateEvidence' -or $xml.Configuration.ClipboardRedirection -ne 'Disable') { throw 'Unsafe Sandbox mappings.' }
    'corrupt' | Set-Content $files[0].path
    $refused = $false
    try { & "$PSScriptRoot\Prepare.ps1" -Spec $spec -RunDirectory "$scratch\bad" | Out-Null } catch { $refused = $_.Exception.Message -like 'Input hash mismatch:*' }
    if (!$refused -or (Test-Path "$scratch\bad")) { throw 'Corrupt release must refuse before staging.' }
    'PASS: syntax, safe mappings, input hashes, refusal boundaries; real HTTP MCP init/pe_find/DELETE with owner/session headers, malformed tool/map and cleanup failure handling. No Sandbox or installer executed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped temporary directory.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
