#!/usr/bin/env bash
# herdr-up.sh SESSION CWD name:kind[:model] [name:kind[:model] ...]
# Idempotent Herdr bring-up: headless server + one workspace + one pane per agent.
# Re-running skips agents that already exist (never double-splits).
# kinds: claude|codex|... (herdr agent kinds). claude launches with --dangerously-skip-permissions;
# the optional :model suffix (e.g. ev:claude:opus) maps to claude --model. Other kinds ignore it.
# Prints: name<TAB>pane_id lines, then "READY".
set -euo pipefail
export MSYS_NO_PATHCONV=1
H="${HERDR_BIN:-C:/Users/kaitp/AppData/Local/Programs/Herdr/bin/herdr.exe}"
S="${1:?session}"; CWD="${2:?cwd}"; shift 2
[ $# -ge 1 ] || { echo "need at least one name:kind" >&2; exit 2; }

hd() { "$H" --session "$S" "$@"; }
jget() { python -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

# server: poll workspace list; if unreachable, start headless server and wait
if ! hd workspace list >/dev/null 2>&1; then
  nohup "$H" --session "$S" server >/dev/null 2>&1 &
  for i in $(seq 1 20); do hd workspace list >/dev/null 2>&1 && break; sleep 1; done
  hd workspace list >/dev/null 2>&1 || { echo "server for session $S never came up" >&2; exit 1; }
fi

# workspace: reuse by label, else create
WS=$(hd workspace list | jget "next((w['workspace_id'] for w in d['result']['workspaces'] if w.get('label')=='$S'),'')")
if [ -z "$WS" ]; then
  WS=$(hd workspace create --cwd "$CWD" --label "$S" --no-focus | jget "d['result']['workspace']['workspace_id']")
fi
ROOT=$(hd pane list --workspace "$WS" | jget "d['result']['panes'][0]['pane_id']")

# Startup dialogs (claude's bypass-permissions consent, folder trust) block launch with the
# accept option highlighted; enter is the sanctioned answer. Poll to settled, never guess numbers.
settle() { # settle NAME -> 0 when idle|done
  local st=""
  for i in $(seq 1 20); do
    st=$(hd agent get "$1" 2>/dev/null | jget "d['result']['agent']['agent_status']" 2>/dev/null || echo missing)
    case "$st" in
      idle|done) return 0 ;;
      blocked) hd agent send-keys "$1" enter >/dev/null ;;
    esac
    sleep 2
  done
  echo "$1 never settled after start (status: $st)" >&2
  hd agent read "$1" --lines 10 >&2 || true
  return 1
}

for spec in "$@"; do
  name="${spec%%:*}"; rest="${spec#*:}"; kind="${rest%%:*}"
  model=""; [ "$rest" != "$kind" ] && model="${rest#*:}"
  if hd agent get "$name" >/dev/null 2>&1; then
    pane=$(hd agent get "$name" | jget "d['result']['agent']['pane_id']")
    settle "$name"   # recover a half-started agent stuck on a startup dialog
    echo -e "$name\t$pane\t(existing)"
    continue
  fi
  # first agent takes the root pane if it's agent-free; otherwise split right off root
  pane="$ROOT"
  if ! hd pane get "$ROOT" | jget "d['result']['pane']['agent_status']" | grep -qx "unknown" \
     || hd agent list | jget "','.join(a['pane_id'] for a in d['result']['agents'])" | grep -q "$ROOT"; then
    pane=$(hd pane split "$ROOT" --direction right --cwd "$CWD" --no-focus | jget "d['result']['pane']['pane_id']")
  fi
  case "$kind" in
    # start exits nonzero while a startup dialog is pending, but the agent IS registered — settle owns the verdict
    claude) hd agent start "$name" --kind claude --pane "$pane" -- ${model:+--model "$model"} --dangerously-skip-permissions >/dev/null 2>&1 || true ;;
    *)      hd agent start "$name" --kind "$kind" --pane "$pane" >/dev/null 2>&1 || true ;;
  esac
  settle "$name"
  echo -e "$name\t$pane"
done
echo "READY — attach: herdr session attach $S"
