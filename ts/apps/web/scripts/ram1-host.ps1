# RAM-1: dev host + web for this checkout with an isolated product home (never the installed state root).
# Usage: powershell -File ts/apps/web/scripts/ram1-host.ps1 [-FakeAgent | -StreamAgent]
# Prints the dev frontend URL (read "Browser:" from the output). Stop it by stopping this process tree.
param([switch]$FakeAgent, [switch]$StreamAgent)
$ErrorActionPreference = 'Stop'
$checkout = (Resolve-Path "$PSScriptRoot\..\..\..\..").Path
$isolated = Join-Path $checkout '.artifacts\ram1-home'
New-Item -ItemType Directory -Force (Join-Path $isolated 'localappdata') | Out-Null
$env:PE_TOOLS_PRODUCT_HOME = $isolated
$env:LOCALAPPDATA = Join-Path $isolated 'localappdata'
if ($FakeAgent -or $StreamAgent) {
  $agent = if ($StreamAgent) { 'ram1-stream-agent.mjs' } else { 'fake-acp-agent.mjs' }
  $env:PE_HARNESS_ADAPTER_CLAUDE = Join-Path $checkout "ts\apps\host\tests\$agent"
  $env:PE_HARNESS_ADAPTER_CODEX = $env:PE_HARNESS_ADAPTER_CLAUDE
}
"product home: $isolated"
Set-Location (Join-Path $checkout 'ts\apps\host')
vp exec node --import jiti/register src/dev.ts --no-tray --no-revit
