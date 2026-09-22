# Starts this checkout's own no-Revit dev host + web for J5/J6, with Work and Pea app-data
# isolated under <repo>/.artifacts/e2e-host/ (never the user's store). The web URL is printed as
# "Browser: http://127.0.0.1:<port>"; pass it to the journeys as E2E_WEB.
# J1-J4 run on the joint-hold host that owns the Revit session, not this one.
$ErrorActionPreference = 'Stop'
$root = (git rev-parse --show-toplevel)
$box = Join-Path $root '.artifacts\e2e-host'
New-Item -ItemType Directory -Force (Join-Path $box 'state'), (Join-Path $box 'appdata') | Out-Null
# Pea's credentials, copied once. A copy never refreshes the user's token in place.
foreach ($f in 'auth.json', 'settings.json') {
  $dst = Join-Path $box "appdata\$f"
  if (-not (Test-Path $dst)) { Copy-Item (Join-Path $env:APPDATA "mastracode\$f") $dst }
}
$env:PE_TOOLS_STATE_DIR = Join-Path $box 'state'
$env:MASTRA_APP_DATA_DIR = Join-Path $box 'appdata'
Set-Location (Join-Path $root 'ts')
vp run dev:no-revit
