$ErrorActionPreference = 'Stop'
# Exercise the actual guard without executing the launch/retirement body or touching runtime files.
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../dev-tray.ps1'))
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
$guard = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-DevTrayIdle' }, $true)
Invoke-Expression $guard.Extent.Text
$script:fixtureRoot = 'C:\guard-fixture'
$script:start = [DateTime]::UtcNow
$script:pair = @{ schemaVersion = 1; sourceRoot = $fixtureRoot; serviceFile = 'service.json'; hostInstanceId = 'original' }
$script:record = @{ schemaVersion = 3; sourceRoot = $fixtureRoot; lane = 'dev'; instanceId = 'original'; pid = 123; port = 64242; processStartUtc = $start.ToString('o') }
$script:requests = 0
$script:unavailable = $false
function Get-Content {
    param($LiteralPath, [switch]$Raw)
    if ($LiteralPath -eq 'service.json') { return ($script:record | ConvertTo-Json) }
    return ($script:pair | ConvertTo-Json)
}
function Get-Process { param($Id, $ErrorAction) return [pscustomobject]@{ StartTime = $script:start } }
function Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    $script:requests++
    if ($script:unavailable) { throw 'offline' }
    if ($Uri -ne 'http://127.0.0.1:64242/pe/threads' -or $TimeoutSec -ne 5) { throw 'Unexpected host query' }
    return ,$script:threads
}
function Assert-Outcome {
    param([string]$Name, [bool]$Refused, [switch]$Force)
    $caught = $false
    try { Assert-DevTrayIdle -CheckoutRoot $fixtureRoot -StateDirectory $fixtureRoot -Force:$Force } catch { $caught = $true }
    if ($caught -ne $Refused) { throw ('Unexpected outcome: ' + $Name) }
    Write-Output ('PASS ' + $Name)
}
$script:threads = @()
Assert-Outcome 'empty host is idle' $false
$script:threads = @([pscustomobject]@{ id = 'idle'; activity = @{ state = 'idle' } })
Assert-Outcome 'idle host permits retirement' $false
$script:threads += [pscustomobject]@{ id = 'running'; activity = @{ state = 'running' } }
Assert-Outcome 'any running turn refuses retirement' $true
$script:threads = @([pscustomobject]@{ id = 'waiting'; activity = @{ state = 'waiting' } })
Assert-Outcome 'approval or question wait refuses retirement' $true
$before = $script:requests
Assert-Outcome 'Force bypasses active-turn query' $false -Force
if ($script:requests -ne $before) { throw 'Force queried the host' }
$script:threads = @([pscustomobject]@{ id = 'unknown'; activity = @{ state = 'future' } })
Assert-Outcome 'unknown state fails closed' $true
$script:unavailable = $true
Assert-Outcome 'unavailable host fails closed' $true
$script:unavailable = $false
$script:record.instanceId = 'replacement'
$before = $script:requests
Assert-Outcome 'replacement host fails closed before query' $true
if ($script:requests -ne $before) { throw 'Replacement host was queried' }
