param([Parameter(Mandatory)][string]$InstallRoot, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
if ($env:USERNAME -ne 'WDAGUtilityAccount' -or $Output -notlike 'C:\GateEvidence\*' -or $InstallRoot -ne (Join-Path $env:LOCALAPPDATA 'Positive Energy\Pe.Tools')) { throw 'Canonical owned Sandbox install and evidence only.' }
if (Test-Path -LiteralPath $Output) { throw 'Fresh output required.' }
New-Item -ItemType Directory -Path $Output | Out-Null
. "$PSScriptRoot\Boundary.ps1"
try {
    if (Get-Process Revit -ErrorAction SilentlyContinue) { throw 'Revit is forbidden in this guest.' }
    if (!('PeConsoleObserver' -as [type])) { Add-Type -Path "$PSScriptRoot\Windows.cs" }
    & "$PSScriptRoot\Observe.ps1" -InstallRoot $InstallRoot -Output "$Output\before.json"
    $before = Get-Content "$Output\before.json" -Raw | ConvertFrom-Json
    $claim = Get-Content "$InstallRoot\state\service\host.json" -Raw | ConvertFrom-Json
    $status = $before.health
    if ($status.lane -ne 'installed' -or $status.processId -ne $before.pid -or $status.installedRoot -ne $InstallRoot -or $status.serviceName -ne 'host' -or $null -ne $status.sourceRoot -or $status.runtimeMatch -ne 'disconnected') { throw 'Canonical installed no-Revit host required.' }
    Invoke-GateMcpRead ('http://127.0.0.1:' + $claim.port) $Output
    & "$PSScriptRoot\Observe.ps1" -InstallRoot $InstallRoot -Output "$Output\after.json"
    $after = Get-Content "$Output\after.json" -Raw | ConvertFrom-Json
    if ($after.pid -ne $before.pid -or $after.processStartUtc -ne $before.processStartUtc -or $after.instanceId -ne $before.instanceId -or (Get-Process Revit -ErrorAction SilentlyContinue)) { throw 'Installed host incarnation changed during MCP read.' }
    @{ state = 'PROVEN'; lane = 'installed-sandbox-mcp-read'; pid = $after.pid; instanceId = $after.instanceId; version = $after.version; tool = 'pe_find'; inference = 'not invoked'; cleanupFailed = $false } | ConvertTo-Json | Set-Content "$Output\result.json"
} catch {
    $_.Exception.ToString() | Set-Content "$Output\failure.txt"
    $cleanupFailed = $false
    if (Test-Path "$Output\protocol-result.json") { $cleanupFailed = (Get-Content "$Output\protocol-result.json" -Raw | ConvertFrom-Json).cleanupFailed }
    @{ state = 'UNPROVEN'; lane = 'installed-sandbox-mcp-read'; reason = $_.Exception.Message; cleanupFailed = $cleanupFailed } | ConvertTo-Json | Set-Content "$Output\result.json"
    throw
}
