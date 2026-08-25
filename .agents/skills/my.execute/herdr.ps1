# herdr.ps1 VERB SESSION [ARGS]
# Verbs:
#   up S CWD name:kind[:model] ...  -> 0 ready; 1 runtime refusal; 2 usage
#   send S AGENT PROMPT_FILE        -> 0 turn observed; 1 delivery failed; 2 usage; 3 busy/blocked
#   status S [AGENT]                -> 0 JSON status; 1 unavailable; 2 usage
#   wait S AGENT [TIMEOUT_MS]       -> 0 idle/done/blocked; 1 timeout; 2 missing/usage
#   read S AGENT [LINES]            -> 0 text; 1 unavailable; 2 usage
#   stop S                           -> 0 stopped+deleted or absent; 1 failure; 2 usage
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Verb,
  [Parameter(Mandatory = $true, Position = 1)][string]$Session,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
$H = if ($env:HERDR_BIN) { $env:HERDR_BIN } else { 'herdr' }

function Warn([string]$Message, [int]$Code = 1) {
  Write-Warning $Message
  exit $Code
}

function HdJson {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $H --session $Session @Args 2>$null; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $eap }
  if ($code -ne 0) { return $null }
  try { return (($out -join "`n") | ConvertFrom-Json) }
  catch { return $null }
}

function HdText {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $H --session $Session @Args 2>&1; $script:HdExit = $LASTEXITCODE }
  finally { $ErrorActionPreference = $eap }
  return (($out | ForEach-Object { $_.ToString() }) -join "`n")
}

function Agent([string]$Name) {
  $json = HdJson agent get $Name
  if ($null -eq $json) { return $null }
  return $json.result.agent
}

function Status([string]$Name) {
  $info = Agent $Name
  if ($null -eq $info) { return 'missing' }
  return $info.agent_status
}

function AssertCwd($Info, [string]$Expected) {
  $actual = [IO.Path]::GetFullPath($Info.cwd).TrimEnd('\')
  if (-not $actual.Equals($Expected, [StringComparison]::OrdinalIgnoreCase)) {
    Warn "$($Info.name) cwd mismatch: expected $Expected; got $actual"
  }
}

function Settle([string]$Name, [string]$ExpectedCwd, [string]$StartDetail) {
  $last = 'missing'
  foreach ($i in 1..30) {
    $info = Agent $Name
    if ($info) {
      $last = $info.agent_status
      if ($last -in @('idle', 'done')) {
        AssertCwd $info $ExpectedCwd
        return $info
      }
      if ($last -eq 'blocked') {
        if ($info.launch_pending) { HdJson agent send-keys $Name enter | Out-Null }
        else { Warn "$Name is blocked after startup; refusing to approve a non-startup dialog" 3 }
      }
    }
    Start-Sleep -Seconds 2
  }
  if ($StartDetail) { Write-Warning "start detail: $StartDetail" }
  Warn "$Name never settled after start (status: $last)"
}

function Up {
  if ($Rest.Count -lt 2) { Warn 'up wants CWD and one or more name:kind[:model] specs' 2 }
  if (-not (Test-Path -LiteralPath $Rest[0] -PathType Container)) { Warn "cwd not found: $($Rest[0])" 2 }
  $cwd = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Rest[0]).Path).TrimEnd('\')
  $specs = @($Rest[1..($Rest.Count - 1)])

  if ($null -eq (HdJson workspace list)) {
    Start-Process -FilePath $H -ArgumentList @('--session', $Session, 'server') -WindowStyle Hidden
    $ready = $false
    foreach ($i in 1..20) {
      Start-Sleep -Seconds 1
      if ($null -ne (HdJson workspace list)) { $ready = $true; break }
    }
    if (-not $ready) { Warn "server for session $Session never came up" }
  }

  $workspaces = @((HdJson workspace list).result.workspaces)
  $workspace = @($workspaces | Where-Object { $_.label -eq $Session })[0]
  if (-not $workspace) {
    $workspace = (HdJson workspace create --cwd $cwd --label $Session --no-focus).result.workspace
  }
  if (-not $workspace) { Warn "workspace for $Session could not be resolved" }
  $ws = $workspace.workspace_id
  $panes = @((HdJson pane list --workspace $ws).result.panes)
  if ($panes.Count -eq 0) { Warn "workspace $ws has no pane" }
  $root = $panes[0].pane_id

  foreach ($spec in $specs) {
    $parts = $spec -split ':'
    if ($parts.Count -lt 2 -or $parts.Count -gt 3) { Warn "bad spec '$spec'" 2 }
    $name, $kind = $parts[0], $parts[1]
    $model = if ($parts.Count -eq 3) { $parts[2] } else { $null }
    if ($name -cnotmatch '^[a-z][a-z0-9_-]{0,31}$') { Warn "invalid agent name '$name'" 2 }

    $existing = Agent $name
    if ($existing) {
      if ($existing.agent_status -eq 'blocked' -and -not $existing.launch_pending) {
        Warn "$name is blocked; refusing to treat it as a startup dialog" 3
      }
      if ($existing.agent_status -eq 'working') {
        "{0}`t{1}`t(existing, still working)`t{2}" -f $name, $existing.pane_id, $existing.agent_status
        continue
      }
      $info = Settle $name $cwd ''
      "{0}`t{1}`t(existing)`t{2}" -f $name, $info.pane_id, $info.agent_status
      continue
    }

    $agents = @((HdJson agent list).result.agents)
    $pane = $root
    if (@($agents | Where-Object { $_.pane_id -eq $root }).Count -gt 0) {
      $direction = if ($agents.Count % 2 -eq 1) { 'right' } else { 'down' }
      $pane = (HdJson pane split $root --direction $direction --cwd $cwd --no-focus).result.pane.pane_id
    }
    if (-not $pane) { Warn "no available pane for $name" }

    $args = @('agent', 'start', $name, '--kind', $kind, '--pane', $pane)
    if ($kind -eq 'claude') {
      $args += '--'
      if ($model) { $args += @('--model', $model) }
      $args += '--dangerously-skip-permissions'
    }
    $detail = HdText @args
    $info = Settle $name $cwd $detail
    "{0}`t{1}`t{2}`t{3}" -f $name, $info.pane_id, $info.agent_status, $info.cwd
  }
  "READY - attach: herdr session attach $Session"
}

function Send {
  if ($Rest.Count -ne 2) { Warn 'send wants AGENT PROMPT_FILE' 2 }
  $name, $file = $Rest[0], $Rest[1]
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Warn "prompt file not found: $file" 2 }
  $info = Agent $name
  if (-not $info) { Warn "$name not found in session $Session" 2 }
  if ($info.agent_status -notin @('idle', 'done')) {
    Warn "refusing: $name is $($info.agent_status); wait for it to settle" 3
  }
  $lines = [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $file)) | Where-Object { $_.Trim() }
  if (-not $lines) { Warn 'empty prompt file' 2 }
  $prompt = (($lines -join "`n") -replace '"', '\"')
  $seq0 = [long]$info.state_change_seq
  foreach ($attempt in 1..2) {
    HdText agent prompt $name $prompt | Out-Null
    foreach ($i in 1..8) {
      Start-Sleep -Seconds 2
      $info = Agent $name
      if ($info.agent_status -eq 'working') { "$name working"; return }
      if ([long]$info.state_change_seq -gt $seq0) {
        "$name turn observed (seq $seq0 -> $($info.state_change_seq), now $($info.agent_status))"; return
      }
    }
    HdJson agent send-keys $name enter | Out-Null
    foreach ($i in 1..5) {
      Start-Sleep -Seconds 2
      $info = Agent $name
      if ($info.agent_status -eq 'working') { "$name working (after nudge)"; return }
      if ([long]$info.state_change_seq -gt $seq0) {
        "$name turn observed after nudge (seq $seq0 -> $($info.state_change_seq))"; return
      }
    }
  }
  Warn "$name did not start after prompt and one nudge (status: $(Status $name))"
}

function WaitAgent {
  if ($Rest.Count -lt 1 -or $Rest.Count -gt 2) { Warn 'wait wants AGENT [TIMEOUT_MS]' 2 }
  $name = $Rest[0]
  $timeout = if ($Rest.Count -eq 2) { [int]$Rest[1] } else { 2400000 }
  $st = Status $name
  if ($st -eq 'missing') { Warn "$name not found in session $Session" 2 }
  if ($st -in @('idle', 'done', 'blocked')) { "$name already settled: $st"; return }
  $deadline = (Get-Date).AddMilliseconds($timeout)
  while ((Get-Date) -lt $deadline) {
    $left = [int][Math]::Max(1000, ($deadline - (Get-Date)).TotalMilliseconds)
    HdText agent wait $name --until idle --until done --until blocked --timeout $left | Out-Null
    $settled = $true
    foreach ($i in 1..3) {
      $st = Status $name
      if ($st -notin @('idle', 'done', 'blocked')) { $settled = $false; break }
      if ($i -lt 3) { Start-Sleep -Seconds 5 }
    }
    if ($settled) { "$name settled: $st"; return }
  }
  Warn "$name still $(Status $name) after ${timeout}ms"
}

function ShowStatus {
  if ($Rest.Count -gt 1) { Warn 'status wants optional AGENT' 2 }
  $json = if ($Rest.Count -eq 1) { HdJson agent get $Rest[0] } else { HdJson agent list }
  if (-not $json) { Warn "status unavailable for session $Session" }
  $json | ConvertTo-Json -Depth 12 -Compress
}

function ReadAgent {
  if ($Rest.Count -lt 1 -or $Rest.Count -gt 2) { Warn 'read wants AGENT [LINES]' 2 }
  $name = $Rest[0]
  $lines = if ($Rest.Count -eq 2) { [int]$Rest[1] } else { 40 }
  $info = Agent $name
  if (-not $info) { Warn "$name not found in session $Session" 2 }
  $source = if ($info.agent_status -in @('working', 'unknown', 'blocked')) { 'visible' } else { 'recent-unwrapped' }
  $output = HdText agent read $name --source $source --lines $lines --format text
  if ($script:HdExit -ne 0) { Warn "read failed for $name ($($info.agent_status)): $output" }
  $output
}

function StopSession {
  if ($Rest.Count -ne 0) { Warn 'stop wants no extra arguments' 2 }
  $sessions = HdJson session list --json
  if (-not $sessions) { Warn 'session list unavailable' }
  $row = @($sessions.sessions | Where-Object { $_.name -eq $Session })[0]
  if (-not $row) { "$Session absent"; return }
  if ($row.running) {
    $out = HdText session stop $Session --json
    if ($script:HdExit -ne 0) { Warn "stop failed: $out" }
  }
  $out = HdText session delete $Session --json
  if ($script:HdExit -ne 0) { Warn "delete failed: $out" }
  "$Session stopped and deleted"
}

switch ($Verb.ToLowerInvariant()) {
  'up' { Up }
  'send' { Send }
  'wait' { WaitAgent }
  'status' { ShowStatus }
  'read' { ReadAgent }
  'stop' { StopSession }
  default { Warn "unknown verb '$Verb'" 2 }
}
