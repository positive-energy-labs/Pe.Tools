# herdr-send.ps1 SESSION AGENT PROMPT_FILE
# One-hop mission delivery: prompt from file -> verify submission -> verify execution.
# Blank lines are collapsed (a blank line can swallow the prompt unsubmitted).
# Codex may leave large prompts as unsubmitted "[Pasted Content]"; if the agent is
# still idle after the prompt, one nudge-enter is sent, then re-verified.
# Embedded double quotes are escaped for the PS 5.1 native-arg pass (same crash
# class as the documented talk_to_pea quote failure).
# Exit 0 = agent is working. 3 = refused (agent busy). Other nonzero = not working;
# pane tail is dumped for diagnosis.
param(
  [Parameter(Mandatory = $true)][string]$Session,
  [Parameter(Mandatory = $true)][string]$Agent,
  [Parameter(Mandatory = $true)][string]$PromptFile
)
$ErrorActionPreference = 'Stop'
$H = if ($env:HERDR_BIN) { $env:HERDR_BIN } else { 'herdr' }

function Hd {
  # tolerant herdr call: stderr discarded without tripping EAP=Stop (PS 5.1 NativeCommandError)
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $H --session $Session @Args 2>$null } finally { $ErrorActionPreference = $eap }
}

function AgentInfo {
  $out = Hd agent get $Agent
  if ($LASTEXITCODE -ne 0) { return $null }
  (($out -join "`n") | ConvertFrom-Json).result.agent
}

function AgentStatus {
  $a = AgentInfo
  if ($null -eq $a) { return 'missing' } else { return $a.agent_status }
}

$lines = Get-Content -LiteralPath $PromptFile | Where-Object { $_.Trim() -ne '' }
if (-not $lines) { Write-Warning 'empty prompt file'; exit 2 }
$prompt = ($lines -join "`n") -replace '"', '\"'   # single-block doctrine + 5.1 native-arg quoting

$st = AgentStatus
if ($st -eq 'working' -or $st -eq 'blocked') {
  Write-Warning "refusing: $Agent is $st - one prompt owner per agent; wait for it to settle"
  exit 3
}

# two full attempts: a first-launch notice (claude) can eat prompt #1; codex can
# leave a large prompt as unsubmitted pasted content (the nudge-enter submits it).
# Sampling `working` misses turns that finish inside a poll gap (a status question can
# complete in <2s), so the turn-happened verdict is state_change_seq movement, not
# instantaneous status. Retry only ever happens while seq never moved, so double-send
# is impossible.
$seq0 = (AgentInfo).state_change_seq
foreach ($attempt in 1..2) {
  Hd agent prompt $Agent $prompt | Out-Null
  foreach ($i in 1..8) {
    Start-Sleep -Seconds 2
    $a = AgentInfo
    if ($a.agent_status -eq 'working') { "$Agent working"; exit 0 }
    if ($a.state_change_seq -gt $seq0) { "$Agent turn observed (seq $seq0 -> $($a.state_change_seq), now $($a.agent_status))"; exit 0 }
  }
  Hd agent send-keys $Agent enter | Out-Null
  foreach ($i in 1..5) {
    Start-Sleep -Seconds 2
    $a = AgentInfo
    if ($a.agent_status -eq 'working') { "$Agent working (after nudge)"; exit 0 }
    if ($a.state_change_seq -gt $seq0) { "$Agent turn observed after nudge (seq $seq0 -> $($a.state_change_seq))"; exit 0 }
  }
}

Write-Warning "$Agent not working after prompt+nudge (status: $(AgentStatus)); pane tail:"
Hd agent read $Agent --lines 15
exit 1
