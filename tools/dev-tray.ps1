param([switch]$CreateShortcut, [switch]$Window, [switch]$Stop, [switch]$Restart, [switch]$Force)
$ErrorActionPreference = 'Stop'
function Assert-DevTrayIdle {
    param([string]$CheckoutRoot, [string]$StateDirectory, [switch]$Force)
    if ($Force) {
        Write-Warning 'Forcing dev tray retirement without an active-turn check. Announce this interruption before proceeding.'
        return
    }
    try {
        $pair = Get-Content -LiteralPath (Join-Path $StateDirectory 'session.json') -Raw | ConvertFrom-Json
        $record = Get-Content -LiteralPath $pair.serviceFile -Raw | ConvertFrom-Json
        $process = Get-Process -Id $record.pid -ErrorAction Stop
        if ($pair.schemaVersion -ne 1 -or $pair.sourceRoot -ne $CheckoutRoot -or
            $record.schemaVersion -ne 3 -or $record.lane -ne 'dev' -or $record.sourceRoot -ne $CheckoutRoot -or
            $pair.hostInstanceId -ne $record.instanceId -or
            [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($record.processStartUtc).ToUniversalTime()).TotalMilliseconds) -gt 2000 -or
            $record.port -lt 1 -or $record.port -gt 65535) {
            throw 'The original dev host identity is not verified.'
        }
        $threads = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $record.port + '/pe/threads') -TimeoutSec 5
        if ($threads -isnot [Array]) { throw 'The host did not return a thread list.' }
        foreach ($thread in $threads) {
            if (-not $thread.id -or $thread.activity.state -notin @('idle', 'running', 'waiting', 'failed')) {
                throw 'The host returned an unknown thread state.'
            }
        }
    } catch {
        throw ('Cannot establish that Pea is idle; dev tray retirement refused. Use -Force only for an announced interruption. ' + $_.Exception.Message)
    }
    $active = @($threads | Where-Object { $_.activity.state -in @('running', 'waiting') })
    if ($active.Count) {
        throw ('Dev tray retirement refused: Pea has active turns in ' + (($active | ForEach-Object { $_.id }) -join ', ') + '. Wait for them to finish or announce the interruption and use -Force.')
    }
}
if ($Stop -and $Restart) { throw 'Choose either -Stop or -Restart.' }
if ($Window -and $Stop) { throw 'Choose either -Window or -Stop.' }
$checkoutRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$state = Join-Path $checkoutRoot '.artifacts/dev-tray'
New-Item -ItemType Directory -Force $state | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source

if ($CreateShortcut) {
    $programs = [Environment]::GetFolderPath('Programs')
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $programs 'Pe.Tools Dev Tray.lnk'))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -File "' + $PSCommandPath + '"'
    $shortcut.WorkingDirectory = $checkoutRoot
    $shortcut.WindowStyle = 7
    $shortcut.IconLocation = (Join-Path $checkoutRoot 'ts/apps/web/public/favicon-dev.ico')
    $shortcut.Description = 'Show the compact Pe.Tools development tray'
    $shortcut.Save()
    return
}

$supervisorFile = Join-Path $state 'supervisor.json'
$existingSupervisor = $false
if (Test-Path -LiteralPath $supervisorFile) {
    try {
        $supervisor = Get-Content -LiteralPath $supervisorFile -Raw | ConvertFrom-Json
        $supervisorProcess = Get-Process -Id $supervisor.pid -ErrorAction Stop
        if ($supervisor.sourceRoot -eq $checkoutRoot -and [Math]::Abs(($supervisorProcess.StartTime.ToUniversalTime() - [DateTime]::Parse($supervisor.processStartUtc).ToUniversalTime()).TotalMilliseconds) -le 2000) {
            if ($Stop -or $Restart) {
                $nativeChildren = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $supervisor.pid) | Where-Object {
                    $_.ExecutablePath -eq [IO.Path]::GetFullPath((Join-Path $checkoutRoot '.artifacts/build/Pe.Host.Tray/Debug.R25/Pe.Host.Tray.exe'))
                } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction Stop })
                Assert-DevTrayIdle -CheckoutRoot $checkoutRoot -StateDirectory $state -Force:$Force
                @{ instanceId = $supervisor.instanceId; nonce = [Guid]::NewGuid().ToString() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'stop.tmp') -Encoding UTF8
                Move-Item -LiteralPath (Join-Path $state 'stop.tmp') -Destination (Join-Path $state 'stop.json') -Force
                $until = [DateTime]::UtcNow.AddSeconds(10)
                while (Test-Path -LiteralPath $supervisorFile) {
                    $current = Get-Content -LiteralPath $supervisorFile -Raw | ConvertFrom-Json
                    if ($current.instanceId -ne $supervisor.instanceId) { throw 'Dev tray supervisor changed while stopping.' }
                    if ([DateTime]::UtcNow -ge $until) {
                        throw 'Dev tray stop timed out; refusing to replace its active generation.'
                    }
                    Start-Sleep -Milliseconds 100
                }
                foreach ($nativeChild in $nativeChildren) {
                    if (-not $nativeChild.WaitForExit(5000)) { throw 'Owned dev tray has not exited; refusing to rebuild its active generation.' }
                }
                if ($Stop) { return }
            } else {
            if (-not $Window) {
                @{ instanceId = $supervisor.instanceId; nonce = [Guid]::NewGuid().ToString() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'show.tmp') -Encoding UTF8
                Move-Item -LiteralPath (Join-Path $state 'show.tmp') -Destination (Join-Path $state 'show.json') -Force
            }
            $existingSupervisor = $true
            }
        }
    } catch { if ($Stop -or $Restart) { throw } }
}
if ($Stop) { return }

$services = Join-Path $env:LOCALAPPDATA 'Positive Energy/Pe.Tools/state/service'
$matches = @(Get-ChildItem -LiteralPath $services -Filter '*.json' | ForEach-Object {
    try {
        $record = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
        if ($record.schemaVersion -ne 3 -or $record.lane -ne 'dev' -or $record.sourceRoot -ne $checkoutRoot) { return }
        $hostProcess = Get-Process -Id $record.pid -ErrorAction Stop
        if ([Math]::Abs(($hostProcess.StartTime.ToUniversalTime() - [DateTime]::Parse($record.processStartUtc).ToUniversalTime()).TotalMilliseconds) -gt 2000) { return }
        [pscustomobject]@{ File = $_.FullName; Record = $record }
    } catch { }
})
if ($matches.Count -gt 1) { throw 'More than one verified dev host belongs to this checkout.' }
if ($matches.Count -eq 1) {
    $match = $matches[0]
    $frontendScript = [IO.Path]::GetFullPath((Join-Path $checkoutRoot 'ts/apps/host/scripts/dev-web.ts'))
    $frontendProcesses = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $match.Record.pid) | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($frontendScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if ($frontendProcesses.Count -ne 1) { throw 'The verified dev host has no unique checkout frontend child.' }
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.DefaultRequestHeaders.Accept.ParseAdd('text/html')
    try {
        $response = $client.GetAsync(('http://127.0.0.1:' + $match.Record.port + '/')).GetAwaiter().GetResult()
        $destination = $response.Headers.Location
        if (-not $destination -or $destination.GetLeftPart([UriPartial]::Authority) -ne 'http://127.0.0.1:5175') {
            throw 'The verified host did not disclose its actual Vite frontend.'
        }
        $frontendOrigin = $destination.GetLeftPart([UriPartial]::Authority)
        $frontendProcess = Get-Process -Id $frontendProcesses[0].ProcessId -ErrorAction Stop
        $session = @{ schemaVersion = 1; sourceRoot = $checkoutRoot; serviceFile = $match.File;
            hostInstanceId = $match.Record.instanceId; frontendOrigin = $frontendOrigin;
            frontendPid = $frontendProcess.Id; frontendStartUtc = $frontendProcess.StartTime.ToUniversalTime().ToString('o') }
        $session | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'session.attach.tmp') -Encoding UTF8
        Move-Item -LiteralPath (Join-Path $state 'session.attach.tmp') -Destination (Join-Path $state 'session.json') -Force
    } finally { $client.Dispose(); $handler.Dispose() }
    if (-not $existingSupervisor) {
        $trayArguments = @('scripts/dev-tray.ts')
        if (-not $Window) { $trayArguments += '--show' }
        Start-Process -FilePath $node -ArgumentList $trayArguments -WorkingDirectory (Join-Path $checkoutRoot 'ts/apps/host') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $state 'supervisor.log') -RedirectStandardError (Join-Path $state 'supervisor-error.log')
    }
} else {
    if ($existingSupervisor) {
        Start-Process -FilePath $node -ArgumentList @('--import', 'jiti/register', 'src/dev.ts') -WorkingDirectory (Join-Path $checkoutRoot 'ts/apps/host') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $state 'dev-host.log') -RedirectStandardError (Join-Path $state 'dev-host-error.log')
    } else {
        $watchArguments = @('scripts/dev-watch.ts')
        if (-not $Window) { $watchArguments += '--show' }
        Start-Process -FilePath $node -ArgumentList $watchArguments -WorkingDirectory (Join-Path $checkoutRoot 'ts/apps/host') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $state 'dev-watch.log') -RedirectStandardError (Join-Path $state 'dev-watch-error.log')
    }
}

if ($Window) {
    $binary = Join-Path $checkoutRoot '.artifacts/build/Pe.Host.Tray/Debug.R25/Pe.Host.Tray.exe'
    $until = [DateTime]::UtcNow.AddSeconds(60)
    do {
        try {
            $pair = Get-Content -LiteralPath (Join-Path $state 'session.json') -Raw | ConvertFrom-Json
            $hostRecord = Get-Content -LiteralPath $pair.serviceFile -Raw | ConvertFrom-Json
            $frontendProcess = Get-Process -Id $pair.frontendPid -ErrorAction Stop
            $hostProcess = Get-Process -Id $hostRecord.pid -ErrorAction Stop
            $ready = $pair.schemaVersion -eq 1 -and $pair.sourceRoot -eq $checkoutRoot -and $pair.frontendOrigin -eq 'http://127.0.0.1:5175' -and
                $hostRecord.schemaVersion -eq 3 -and $hostRecord.sourceRoot -eq $checkoutRoot -and $hostRecord.lane -eq 'dev' -and $hostRecord.instanceId -eq $pair.hostInstanceId -and
                [Math]::Abs(($frontendProcess.StartTime.ToUniversalTime() - [DateTime]::Parse($pair.frontendStartUtc).ToUniversalTime()).TotalMilliseconds) -le 2000 -and
                [Math]::Abs(($hostProcess.StartTime.ToUniversalTime() - [DateTime]::Parse($hostRecord.processStartUtc).ToUniversalTime()).TotalMilliseconds) -le 2000 -and
                (Test-Path -LiteralPath $binary)
        } catch { $ready = $false }
        if ($ready) { break }
        if ([DateTime]::UtcNow -ge $until) { throw 'Dev frontend startup timed out. Read .artifacts/dev-tray logs before retrying.' }
        Start-Sleep -Milliseconds 200
    } while ($true)
    $launcher = Start-Process -FilePath $binary -ArgumentList @('--launch-window', 'http://127.0.0.1:5175/open') -WindowStyle Hidden -PassThru
    if (-not $launcher.WaitForExit(10000)) { throw 'Dev PWA launcher timed out.' }
    if ($launcher.ExitCode -ne 0) { throw 'Dev PWA launcher refused the frontend or PWA registration.' }
}
