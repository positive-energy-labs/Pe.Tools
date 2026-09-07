# herdr.ps1 VERB SESSION [ARGS]
# Verbs:
#   up S CWD POSTURE name:kind[:model][:effort] ... -> 0 ready; 1 runtime refusal; 2 usage
#   cast S CWD POSTURE spec PROMPT_FILE -> up, send, then agent/pane/tab/session identity
#   send S AGENT PROMPT_FILE        -> 0 turn observed; 1 delivery failed; 2 usage; 3 busy/blocked
#   status S [AGENT]                -> 0 JSON status; 1 unavailable; 2 usage
#   wait S AGENT [TIMEOUT_MS]       -> 0 idle/done/blocked; 1 timeout; 2 missing/usage
#   read S AGENT [LINES]            -> 0 text; 1 unavailable; 2 usage
#   retire S AGENT                  -> 0 pane closed or absent; 1 failure; 2 usage; 3 working
#   stop S                           -> 0 stopped+deleted or absent; 1 failure; 2 usage
#   retire-worktree PATH             -> 0 unlinked/removed/pruned; 1 failure; 2 refusal
#   sweep [DAYS]                     -> 0 stopped sessions deleted; 1 failure; 2 usage
#   goal S GOAL_FILE                 -> 0 target; 1 gates/runtime; 2 usage; 3 dry
# Goal uses the invocation CWD; WIDTH supplies its generated posture table.
# Spec fields are positional; leave one empty to skip it (name:claude::high).
# claude takes --model/--effort; codex takes -m/-c model_reasoning_effort.
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Verb,
  [Parameter(Position = 1)][AllowEmptyString()][string]$Session,
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
  $selector = if ($Verb -eq 'sweep') { @() } else { @('--session', $Session) }
  try { $out = & $H @selector @Args 2>$null; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $eap }
  if ($code -ne 0) { return $null }
  try { return (($out -join "`n") | ConvertFrom-Json) }
  catch { return $null }
}

function HdText {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $selector = if ($Verb -eq 'sweep') { @() } else { @('--session', $Session) }
  try { $out = & $H @selector @Args 2>&1; $script:HdExit = $LASTEXITCODE }
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
        if ($info.launch_pending -or $StartDetail -match '\bagent_not_ready\b') { HdJson agent send-keys $Name enter | Out-Null }
        else { Warn "$Name is blocked after startup; refusing to approve a non-startup dialog" 3 }
      }
    }
    Start-Sleep -Seconds 2
  }
  if ($StartDetail) { Write-Warning "start detail: $StartDetail" }
  Warn "$Name never settled after start (status: $last)"
}

function Up {
  if ($Session -cnotmatch '^[a-z][a-z0-9_-]{0,31}$' -or $Session.EndsWith('-')) { Warn "invalid session name '$Session'" 2 }
  if ($Rest.Count -lt 3) { Warn 'up wants CWD POSTURE and one or more name:kind[:model][:effort] specs' 2 }
  if (-not (Test-Path -LiteralPath $Rest[0] -PathType Container)) { Warn "cwd not found: $($Rest[0])" 2 }
  $cwd = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Rest[0]).Path).TrimEnd('\')
  $posture = $Rest[1]
  if ([IO.Path]::GetExtension($posture) -notin @('.md', '.markdown') -or -not (Test-Path -LiteralPath $posture -PathType Leaf)) { Warn 'POSTURE must be an existing markdown file' 2 }
  $rows = [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $posture))
  $table = $false
  for ($i = 0; $i -lt $rows.Count - 1; $i++) {
    $header = @($rows[$i].Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
    $separator = @($rows[$i + 1].Trim().Trim('|').Split('|'))
    if ($header -ccontains 'Model' -and $separator.Count -eq $header.Count -and @($separator | Where-Object { $_ -notmatch '^\s*:?-{3,}:?\s*$' }).Count -eq 0) { $table = $true; break }
  }
  if (-not $table) { Warn 'POSTURE must contain a markdown table with a Model column' 2 }
  $specs = @($Rest[2..($Rest.Count - 1)])

  if ($null -eq (HdJson workspace list)) {
    Start-Process -FilePath $H -ArgumentList @('--session', $Session, 'server') -WindowStyle Hidden
    $ready = $false
    foreach ($i in 1..20) {
      Start-Sleep -Seconds 1
      if ($null -ne (HdJson workspace list)) { $ready = $true; break }
    }
    if (-not $ready) { Warn "server for session $Session never came up" }
  }
  $row = @((HdJson session list --json).sessions | Where-Object { $_.name -eq $Session })[0]
  if (-not $row -or -not (Test-Path -LiteralPath $row.session_dir -PathType Container)) { Warn "session directory unavailable for $Session" }
  $destination = Join-Path $row.session_dir 'posture.md'
  if ([IO.Path]::GetFullPath((Resolve-Path -LiteralPath $posture).Path) -ne [IO.Path]::GetFullPath($destination)) { Copy-Item -LiteralPath $posture -Destination $destination -Force }

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
    if ($parts.Count -lt 2 -or $parts.Count -gt 4) { Warn "bad spec '$spec'" 2 }
    $name, $kind = $parts[0], $parts[1]
    $model = if ($parts.Count -ge 3 -and $parts[2]) { $parts[2] } else { $null }
    $effort = if ($parts.Count -ge 4 -and $parts[3]) { $parts[3] } else { $null }
    if ($name -cnotmatch '^[a-z][a-z0-9_-]{0,31}$') { Warn "invalid agent name '$name'" 2 }
    if ($effort -and $effort -cnotmatch '^(low|medium|high|xhigh|max|ultra)$') { Warn "invalid effort '$effort' for $name" 2 }

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

    # ponytail: one tab per agent, labeled by agent name; splits made a fibonacci of panes
    $agents = @((HdJson agent list).result.agents)
    $pane = $root
    if (@($agents | Where-Object { $_.pane_id -eq $root }).Count -gt 0) {
      $tab = (HdJson tab create --workspace $ws --cwd $cwd --label $name --no-focus).result.tab
      if (-not $tab) { Warn "tab for $name could not be created" }
      $pane = @((HdJson pane list --workspace $ws).result.panes | Where-Object { $_.tab_id -eq $tab.tab_id })[0].pane_id
    }
    else { HdJson tab rename $panes[0].tab_id $name | Out-Null }
    if (-not $pane) { Warn "no available pane for $name" }

    $args = @('agent', 'start', $name, '--kind', $kind, '--pane', $pane)
    if ($kind -eq 'claude') {
      $args += '--'
      if ($model) { $args += @('--model', $model) }
      if ($effort) { $args += @('--effort', $effort) }
      $args += '--dangerously-skip-permissions'
    }
    elseif ($kind -eq 'codex' -and ($model -or $effort)) {
      $args += '--'
      if ($model) { $args += @('-m', $model) }
      if ($effort) { $args += @('-c', "model_reasoning_effort=$effort") }
    }
    elseif ($model -or $effort) { Warn "kind '$kind' takes no model or effort; drop them from '$spec'" 2 }
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
  $prompt = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $file))
  if ([string]::IsNullOrWhiteSpace($prompt)) { Warn 'empty prompt file' 2 }
  # Windows PowerShell's native argv path strips quotes; keep quoted payloads in the file.
  if ($prompt.Contains('"')) {
    $prompt = "Read the prompt file at $((Resolve-Path -LiteralPath $file).Path) and follow its instructions."
    "$name delivery: file path (quoted payload)"
  }
  else { "$name delivery: unchanged text" }
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
  HdText agent read $name --source visible --lines 40 --format text
  Warn "$name still $(Status $name) after ${timeout}ms"
}

function Cast {
  if ($Rest.Count -ne 4) { Warn 'cast wants CWD POSTURE spec PROMPT_FILE' 2 }
  $file = $Rest[3]
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Warn "prompt file not found: $file" 2 }
  $name = ($Rest[2] -split ':')[0]
  $Rest = @($Rest[0], $Rest[1], $Rest[2])
  Up
  $Rest = @($name, $file)
  Send
  $info = Agent $name
  if (-not $info.name -or -not $info.pane_id -or -not $info.tab_id -or -not $info.agent_session.value) { Warn "agent get lacks identity for $name" }
  [ordered]@{ name = $info.name; pane_id = $info.pane_id; tab_id = $info.tab_id; session_id = $info.agent_session.value } | ConvertTo-Json -Compress
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

function RetireAgent {
  if ($Rest.Count -ne 1) { Warn 'retire wants AGENT' 2 }
  $name = $Rest[0]
  $info = Agent $name
  if (-not $info) { "$name absent"; return }
  if ($info.agent_status -eq 'working') { Warn "$name is working; redirect with esc and wait, never close a working agent" 3 }
  $pane = $info.pane_id
  $out = HdText pane close $pane
  if ($script:HdExit -ne 0) { Warn "retire failed: $out" }
  "$name retired ($pane)"
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

function RetireWorktree {
  if (-not $Session -or $Rest.Count) { Warn 'retire-worktree wants PATH' 2 }
  $path = [IO.Path]::GetFullPath($Session).TrimEnd('\', '/')
  $registered = @(git worktree list --porcelain | Where-Object { $_.StartsWith('worktree ') } | ForEach-Object { [IO.Path]::GetFullPath($_.Substring(9)).TrimEnd('\', '/') })
  if ($LASTEXITCODE -ne 0) { Warn 'worktree list failed' }
  if ($path -eq $registered[0] -or $path -notin $registered) { Warn "refusing main or unregistered worktree: $path" 2 }
  $root = Get-Item -LiteralPath $path -Force
  if ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) { Warn 'worktree root is a reparse point' 2 }
  $pending = [Collections.Generic.Stack[string]]::new()
  $links = [Collections.Generic.List[IO.FileSystemInfo]]::new()
  $pending.Push($path)
  while ($pending.Count) {
    foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $links.Add($item) }
      elseif ($item.PSIsContainer) { $pending.Push($item.FullName) }
    }
  }
  $directories = 0; $files = 0
  foreach ($link in $links) {
    if ($link.Attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::Delete($link.FullName); $directories++ }
    else { [IO.File]::Delete($link.FullName); $files++ }
  }
  "$path : unlinked $($links.Count) reparse points ($directories directory, $files file)"
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { git -c core.longpaths=true worktree remove $path; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $eap }
  if ($code -ne 0) { Warn "worktree remove failed after unlinking: $path" }
  git worktree prune
  if ($LASTEXITCODE -ne 0) { Warn 'worktree prune failed' }
  'removed 1 worktree; prune completed'
}

function Sweep {
  $days = 3
  if ($Rest.Count -or ($Session -and (-not [int]::TryParse($Session, [ref]$days) -or $days -lt 0))) { Warn 'sweep wants nonnegative DAYS (default 3)' 2 }
  $cutoff = [DateTime]::UtcNow.AddDays(-$days)
  $sessions = HdJson session list --json
  if (-not $sessions) { Warn 'session list unavailable' }
  $deleted = 0
  foreach ($row in $sessions.sessions) {
    if ($row.default) { 'skipped default (Herdr does not support deleting it)'; continue }
    if ($row.running -ne $false -or -not (Test-Path -LiteralPath $row.session_dir -PathType Container)) { continue }
    if ((Get-Item -LiteralPath $row.session_dir -Force).LastWriteTimeUtc -ge $cutoff) { continue }
    # Already stopped: delete refuses a concurrent restart; stop would kill that new server.
    $out = HdText session delete $row.name --json
    if ($script:HdExit -ne 0) { Warn "sweep delete failed for $($row.name): $out" }
    "deleted $($row.name) ($($row.session_dir))"
    $deleted++
  }
  "deleted $deleted stopped sessions older than $days days"
}

function GoalCommand([string]$Command) {
  $body = "`$ErrorActionPreference = 'Stop'; & { $Command }; if (-not `$?) { exit 1 }; if (`$null -ne `$LASTEXITCODE) { exit `$LASTEXITCODE }"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($body))
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $output = & (Get-Process -Id $PID).Path -NoProfile -NonInteractive -EncodedCommand $encoded 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $eap }
  return @{ code = $code; output = @($output | ForEach-Object { $_.ToString() }) }
}

function GoalNumber([string]$Text, [int]$Code = 2) {
  $number = 0.0
  if (-not [double]::TryParse($Text, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -or [double]::IsNaN($number) -or [double]::IsInfinity($number)) { Warn "expected one finite number, got: $Text" $Code }
  return $number
}

function Goal {
  if ($Session -cnotmatch '^[a-z][a-z0-9_-]{0,31}$' -or $Session.EndsWith('-')) { Warn "invalid session name '$Session'" 2 }
  if ($Rest.Count -ne 1 -or [IO.Path]::GetExtension($Rest[0]) -notin @('.md', '.markdown') -or -not (Test-Path -LiteralPath $Rest[0] -PathType Leaf)) { Warn 'goal wants an existing markdown GOAL_FILE' 2 }
  $text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Rest[0]))
  $sections = ([regex]'(?m)^## Brief[ \t]*\r?$').Split($text, 2)
  if ($sections.Count -ne 2 -or [string]::IsNullOrWhiteSpace($sections[1])) { Warn 'GOAL_FILE needs ## Brief and its body' 2 }
  $fields = @{}
  foreach ($match in [regex]::Matches($sections[0], '(?m)^([A-Z_]+):[ \t]*([^\r\n]*)')) { $fields[$match.Groups[1].Value] = $match.Groups[2].Value.Trim() }
  foreach ($key in @('MISSION', 'NUMBER', 'BASELINE', 'TARGET', 'GATES', 'WIDTH', 'DRY', 'WAVE_MS', 'CHECKPOINT')) {
    if (-not $fields[$key]) { Warn "GOAL_FILE missing $key" 2 }
  }
  if ($fields.TARGET -cnotmatch '^(below|above)\s+(\S+)$') { Warn 'TARGET wants below N or above N' 2 }
  $direction = $Matches[1]; $target = GoalNumber $Matches[2]
  $previous = GoalNumber $fields.BASELINE; $best = $previous
  if ($fields.WIDTH -cnotmatch '^([1-9][0-9]*):([a-z]+)(?::([^:]*))?(?::(low|medium|high|xhigh|max|ultra))?$') { Warn 'WIDTH wants count:kind[:model][:effort]' 2 }
  $width = 0; $dryLimit = 0; $waveMs = 0
  if (-not [int]::TryParse($Matches[1], [ref]$width)) { Warn 'WIDTH count is too large' 2 }
  $workerSpec = $fields.WIDTH.Substring($fields.WIDTH.IndexOf(':') + 1)
  if (-not [int]::TryParse($fields.DRY, [ref]$dryLimit) -or $dryLimit -lt 1 -or -not [int]::TryParse($fields.WAVE_MS, [ref]$waveMs) -or $waveMs -lt 1) { Warn 'DRY and WAVE_MS must be positive integers' 2 }
  $cwd = (Get-Location).Path
  $checkpoint = [IO.Path]::GetFullPath($fields.CHECKPOINT)
  $directory = Split-Path -Parent $checkpoint
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $posture = "$checkpoint.posture.md"; $promptFile = "$checkpoint.brief.md"
  $model = if ($Matches[3]) { $Matches[3] } else { 'CLI default' }
  [IO.File]::WriteAllText($posture, "| Task | Model | Spec |`n|---|---|---|`n| $($fields.MISSION.Replace('|', '\|')) | $model | $workerSpec |`n")
  $dry = 0; $wave = 0
  while ($true) {
    $wave++
    $last = if (Test-Path -LiteralPath $checkpoint -PathType Leaf) { Get-Content -LiteralPath $checkpoint -Tail 1 } else { '' }
    [IO.File]::WriteAllText($promptFile, $sections[1].Trim() + "`n`nLast checkpoint: $last`n")
    $deadline = [DateTime]::UtcNow.AddMilliseconds($waveMs)
    foreach ($i in 1..$width) {
      $output = & $PSCommandPath cast $Session $cwd $posture "w${i}:$workerSpec" $promptFile
      if ($LASTEXITCODE -ne 0) { $output; Warn "wave $wave cast failed for w$i" 1 }
    }
    foreach ($i in 1..$width) {
      $left = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
      $output = & $PSCommandPath wait $Session "w$i" $left
      if ($LASTEXITCODE -ne 0) { $output; Warn "wave $wave wait failed for w$i" 1 }
    }
    $gates = GoalCommand $fields.GATES
    $number = $null; $delta = $null
    if ($gates.code -eq 0) {
      $measurement = GoalCommand $fields.NUMBER
      if ($measurement.code -ne 0) { Warn "NUMBER failed: $($measurement.output -join '`n')" 1 }
      $number = GoalNumber ($measurement.output -join "`n") 1
      $delta = $number - $previous
    }
    $record = [ordered]@{ wave = $wave; number = $number; gates = $gates.code; delta = $delta; when = [DateTime]::UtcNow.ToString('o') }
    [IO.File]::AppendAllText($checkpoint, ($record | ConvertTo-Json -Compress) + "`n")
    "wave=$wave number=$number gates=$($gates.code) delta=$delta"
    if ($gates.code -ne 0) { Warn "GATES failed: $($gates.output -join '`n')" 1 }
    if (($direction -eq 'below' -and $number -lt $target) -or ($direction -eq 'above' -and $number -gt $target)) { return }
    if (($direction -eq 'below' -and $number -lt $best) -or ($direction -eq 'above' -and $number -gt $best)) { $best = $number; $dry = 0 }
    else { $dry++ }
    if ($dry -ge $dryLimit) { Warn "$dry consecutive waves without improvement" 3 }
    $previous = $number
  }
}

switch ($Verb.ToLowerInvariant()) {
  'up' { Up }
  'cast' { Cast }
  'send' { Send }
  'wait' { WaitAgent }
  'status' { ShowStatus }
  'read' { ReadAgent }
  'retire' { RetireAgent }
  'stop' { StopSession }
  'retire-worktree' { RetireWorktree }
  'sweep' { Sweep }
  'goal' { Goal }
  default { Warn "unknown verb '$Verb'" 2 }
}
exit 0
