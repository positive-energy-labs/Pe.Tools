param([Parameter(Mandatory)][string]$InstallRoot, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
if ($env:USERNAME -ne 'WDAGUtilityAccount') { throw 'Observer runs only in Windows Sandbox.' }
$manifestPath = Join-Path $InstallRoot 'product.payloads.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$hostPayload = @($manifest.payloads | Where-Object name -eq 'host')
if ($hostPayload.Count -ne 1) { throw 'One host payload required.' }
$claim = Get-Content -LiteralPath (Join-Path $InstallRoot 'state\service\host.json') -Raw | ConvertFrom-Json
$exe = Join-Path $InstallRoot ('bin\host\' + $hostPayload[0].entry)
$process = Get-Process -Id $claim.pid -ErrorAction Stop
$drift = [math]::Abs(($process.StartTime.ToUniversalTime() - [datetime]::Parse($claim.processStartUtc).ToUniversalTime()).TotalMilliseconds)
if ($claim.lane -ne 'installed' -or $claim.executablePath -ne $exe -or $process.Path -ne $exe -or $drift -gt 2000 -or $claim.version -ne $manifest.version) { throw 'Service claim and executable identity disagree.' }
$uri = 'http://127.0.0.1:' + $claim.port + $hostPayload[0].service.health
$health = Invoke-RestMethod $uri -TimeoutSec 5
if ($health.processId -ne $process.Id) { throw 'Responsive host identity disagrees with service claim.' }
$trayPath = Join-Path (Split-Path $exe) 'tray\Pe.Host.Tray.exe'
$trays = @(Get-Process Pe.Host.Tray -ErrorAction SilentlyContinue | ForEach-Object { [PeConsoleObserver]::ProcessAt([uint32]$_.Id) } | Where-Object { $_.Executable -eq $trayPath -and $_.ParentPid -eq $process.Id })
if ($trays.Count -ne 1) { throw 'Exactly one installed tray child required.' }
# Process and window census are observations. Tray icon and interactive window behavior require UI evidence.
$windows = @(Get-Process | Where-Object MainWindowHandle -ne 0 | Select-Object Id, ProcessName, MainWindowTitle)
@{ observedAtUtc = [datetime]::UtcNow.ToString('o'); version = $manifest.version; instanceId = $claim.instanceId; pid = $process.Id; processStartUtc = $process.StartTime.ToUniversalTime().ToString('o'); executable = $process.Path; executableHash = (Get-FileHash $exe).Hash; health = $health; tray = $trays; windows = $windows; uiBehavior = 'UNPROVEN' } | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $Output
