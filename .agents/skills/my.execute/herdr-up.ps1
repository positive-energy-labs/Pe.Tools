# herdr-up.ps1 SESSION CWD name:kind[:model] [name:kind[:model] ...]
# Idempotent Herdr bring-up: headless server + one workspace + one pane per agent.
# Re-running skips agents that already exist (never double-splits) and recovers agents
# stuck on a startup dialog. claude launches with --dangerously-skip-permissions; the
# optional :model suffix (e.g. ev:claude:opus) maps to claude --model. Other kinds ignore it.
# Prints: name<TAB>pane_id lines, then "READY".
param(
  [Parameter(Mandatory = $true)][string]$Session,
  [Parameter(Mandatory = $true)][string]$Cwd,
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Specs
)
$ErrorActionPreference = 'Stop'
$H = if ($env:HERDR_BIN) { $env:HERDR_BIN } else { 'herdr' }

function HdJson {
  # herdr call -> parsed JSON, $null on nonzero exit (probe-friendly).
  # herdr prints error JSON on stderr; under EAP=Stop a 2>$null redirect turns that
  # into a terminating NativeCommandError (PS 5.1), so relax EAP locally.
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $H --session $Session @Args 2>$null } finally { $ErrorActionPreference = $eap }
  if ($LASTEXITCODE -ne 0) { return $null }
  ($out -join "`n") | ConvertFrom-Json
}

function HdStart {
  # `agent start`, KEEPING stderr. A pending startup dialog and a hard refusal both exit
  # nonzero, so the error JSON is the only thing that tells them apart. Swallowing it made an
  # invalid agent name (uppercase is refused) surface only as "never settled after start".
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $H --session $Session @Args 2>&1 } finally { $ErrorActionPreference = $eap }
  ($out | ForEach-Object { $_.ToString() }) -join "`n"
}

# server: probe; if unreachable, start headless server and wait
if ($null -eq (HdJson workspace list)) {
  Start-Process -FilePath $H -ArgumentList @('--session', $Session, 'server') -WindowStyle Hidden
  $up = $false
  foreach ($i in 1..20) {
    Start-Sleep -Seconds 1
    if ($null -ne (HdJson workspace list)) { $up = $true; break }
  }
  if (-not $up) { Write-Warning "server for session $Session never came up"; exit 1 }
}

# workspace: reuse by label, else create
$ws = $null
$wsList = (HdJson workspace list).result.workspaces | Where-Object { $_.label -eq $Session }
if ($wsList) { $ws = @($wsList)[0].workspace_id }
if (-not $ws) {
  $ws = (HdJson workspace create --cwd $Cwd --label $Session --no-focus).result.workspace.workspace_id
}
$root = @((HdJson pane list --workspace $ws).result.panes)[0].pane_id

# Startup dialogs (claude's bypass-permissions consent, folder trust) block launch with the
# accept option highlighted; enter is the sanctioned answer. Poll to settled, never guess numbers.
function Settle([string]$Name) {
  $st = 'missing'
  foreach ($i in 1..20) {
    $a = HdJson agent get $Name
    if ($a) { $st = $a.result.agent.agent_status }
    if ($st -eq 'idle' -or $st -eq 'done') { return $true }
    if ($st -eq 'blocked') { HdJson agent send-keys $Name enter | Out-Null }
    Start-Sleep -Seconds 2
  }
  Write-Warning "$Name never settled after start (status: $st)"
  if ($st -eq 'missing' -and $script:lastStart) {
    Write-Warning "start refused it: $script:lastStart"
  }
  & $H --session $Session agent read $Name --lines 10
  exit 1
}

foreach ($spec in $Specs) {
  $parts = $spec -split ':'
  $name = $parts[0]; $kind = $parts[1]
  $model = if ($parts.Count -ge 3) { $parts[2] } else { $null }
  if (-not $kind) { Write-Warning "bad spec '$spec' (want name:kind[:model])"; exit 2 }

  $existing = HdJson agent get $name
  if ($existing) {
    Settle $name | Out-Null   # recover a half-started agent stuck on a startup dialog
    "{0}`t{1}`t(existing)" -f $name, $existing.result.agent.pane_id
    continue
  }

  # first agent takes the root pane if it's agent-free; otherwise split, alternating
  # right/down by population so panes stay wide enough to read. Pane width is not
  # cosmetic: `agent read` only sees visible alt-screen rows, and a strip of narrow
  # right-splits reduces every transcript read to a ~10-line tail.
  # ponytail: alternation, not geometry - split the widest pane if this ever matters.
  $pane = $root
  $agents = @((HdJson agent list).result.agents)
  $occupied = @($agents | Where-Object { $_.pane_id -eq $root })
  if ($occupied.Count -gt 0) {
    $dir = if ($agents.Count % 2 -eq 1) { 'right' } else { 'down' }
    $pane = (HdJson pane split $root --direction $dir --cwd $Cwd --no-focus).result.pane.pane_id
  }

  # start exits nonzero while a startup dialog is pending, but the agent IS registered - Settle owns the verdict
  if ($kind -eq 'claude') {
    $cargs = @('agent', 'start', $name, '--kind', 'claude', '--pane', $pane, '--')
    if ($model) { $cargs += @('--model', $model) }
    $cargs += '--dangerously-skip-permissions'
    $script:lastStart = HdStart @cargs
  }
  else {
    $script:lastStart = HdStart agent start $name --kind $kind --pane $pane
  }
  Settle $name | Out-Null
  "{0}`t{1}" -f $name, $pane
}
"READY - attach: herdr session attach $Session"
