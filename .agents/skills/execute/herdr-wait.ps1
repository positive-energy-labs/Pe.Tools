# herdr-wait.ps1 SESSION AGENT [TIMEOUT_MS]
# Wake-chain wait that treats "already settled" as success. Raw `herdr agent wait` exits
# nonzero both on timeout AND when done flipped to idle before the wait began (reads and
# focus consume `done`), so a nonzero wait is NOT evidence of agent failure - twice in one
# session a watcher exited 1 after its mission had already landed. This wrapper's verdict
# comes from final status, not the wait's exit code.
# Exit 0 = settled (idle/done/blocked; status printed, pane tail dumped when blocked).
# Exit 1 = still working at timeout. Background this as the wake signal, then read results.
param(
  [Parameter(Mandatory = $true)][string]$Session,
  [Parameter(Mandatory = $true)][string]$Agent,
  [int]$TimeoutMs = 2400000
)
$ErrorActionPreference = 'Stop'
$H = if ($env:HERDR_BIN) { $env:HERDR_BIN } else { 'herdr' }

function Hd {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $H --session $Session @Args 2>$null } finally { $ErrorActionPreference = $eap }
}

function AgentStatus {
  $out = Hd agent get $Agent
  if ($LASTEXITCODE -ne 0) { return 'missing' }
  (($out -join "`n") | ConvertFrom-Json).result.agent.agent_status
}

$st = AgentStatus
if ($st -in @('idle', 'done', 'blocked')) { "$Agent already settled: $st"; if ($st -eq 'blocked') { Hd agent read $Agent --lines 15 }; exit 0 }
if ($st -eq 'missing') { Write-Warning "$Agent not found in session $Session"; exit 2 }

# wait's own exit code is advisory; the re-read below owns the verdict. Codex flickers to idle
# for one tick while it waits on a background terminal (seen 2x on 2026-08-20), so a settled
# verdict needs 3 consecutive settled reads 5 s apart; any `working` read re-enters the wait.
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
while ((Get-Date) -lt $deadline) {
  $left = [int][math]::Max(1000, ($deadline - (Get-Date)).TotalMilliseconds)
  Hd agent wait $Agent --until idle --until done --until blocked --timeout $left | Out-Null
  $settled = $true
  foreach ($i in 1..3) {
    $st = AgentStatus
    if ($st -notin @('idle', 'done', 'blocked')) { $settled = $false; break }
    if ($i -lt 3) { Start-Sleep -Seconds 5 }
  }
  if ($settled) { "$Agent settled: $st"; if ($st -eq 'blocked') { Hd agent read $Agent --lines 15 }; exit 0 }
}
$st = AgentStatus
Write-Warning "$Agent still $st after ${TimeoutMs}ms"
exit 1
