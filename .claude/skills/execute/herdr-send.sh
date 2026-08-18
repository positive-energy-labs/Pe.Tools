#!/usr/bin/env bash
# herdr-send.sh SESSION AGENT PROMPT_FILE
# One-hop mission delivery: prompt from file -> verify submission -> verify execution.
# Blank lines are collapsed (a blank line can swallow the prompt unsubmitted).
# Codex may leave large prompts as unsubmitted "[Pasted Content]"; if the agent is
# still idle after the prompt, one nudge-enter is sent, then re-verified.
# Exit 0 = agent is working. Nonzero = not working; pane tail is dumped for diagnosis.
set -euo pipefail
export MSYS_NO_PATHCONV=1
H="${HERDR_BIN:-C:/Users/kaitp/AppData/Local/Programs/Herdr/bin/herdr.exe}"
S="${1:?session}"; A="${2:?agent}"; F="${3:?prompt file}"

hd() { "$H" --session "$S" "$@"; }
status() { hd agent get "$A" | python -c "import json,sys;print(json.load(sys.stdin)['result']['agent']['agent_status'])"; }

prompt=$(sed '/^[[:space:]]*$/d' "$F")   # single-block doctrine
[ -n "$prompt" ] || { echo "empty prompt file" >&2; exit 2; }

st=$(status)
if [ "$st" = "working" ] || [ "$st" = "blocked" ]; then
  echo "refusing: $A is $st — one prompt owner per agent; wait for it to settle" >&2; exit 3
fi

# two full attempts: a first-launch notice (claude) can eat prompt #1; codex can
# leave a large prompt as unsubmitted pasted content (the nudge-enter submits it).
# Retry only ever happens while status never left idle, so double-send is impossible.
for attempt in 1 2; do
  hd agent prompt "$A" "$prompt" >/dev/null
  for i in $(seq 1 8); do sleep 2; [ "$(status)" = "working" ] && { echo "$A working"; exit 0; }; done
  hd agent send-keys "$A" enter >/dev/null
  for i in $(seq 1 5); do sleep 2; [ "$(status)" = "working" ] && { echo "$A working (after nudge)"; exit 0; }; done
done

echo "$A not working after prompt+nudge (status: $(status)); pane tail:" >&2
hd agent read "$A" --lines 15 >&2
exit 1
