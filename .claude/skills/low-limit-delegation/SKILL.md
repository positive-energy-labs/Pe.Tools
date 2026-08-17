---
name: delegation-protocol
description: Budgetting rules + delegation rules + proven codex-exec-as-subagent protocol for long-haul slogs.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5a7f7c21-3fb9-4b5c-a0ac-da85681ad708
  modified: 2026-08-07T15:41:42.190Z
---

**Rule:** Stretch Fable limits by delegating to cheaper models on long sessions or sprawling requests. Never delegate to Fable.

**Why:** kaitpw feels budget-constrained on the latest Fable limits. ~70% usage in a single day is easy. Opus and Codex have separate limits from Fable and are comparatively much cheaper.

*Compress the problem space yourself first,* the user is asking *your* opinion, but not everything needs your eyes or hand. Delegating is not free but its powerful. A good rule of thumb: "does this task require 20+ tool calls" and "Is enough known to produce unambiguous completion targets". Balance delegation with DIY to ensure your opinions don't simply parrot other subagents. 

Model attributes: 
- Fable excels at design, aesthetics, and decision making. **Extremely expensive**, extremely tasteful
- Opus 4.8 is intelligent, dependable, and somewhat tasteful. Kinda Cheap, good for most on the ground work. Use when the problem or request is clear. 
- Codex is does every long slog, compile smash, and deep research. **Very Cheap**. Use where the work is mindless or brute force matters, the ask must be bounded. Never use for ui.

**How to apply — codex exec protocol (proven):**
- Launch: `codex exec "mission prompt" < /dev/null` — the stdin redirect is non-negotiable (blocks forever otherwise). Run as background task, from the target worktree.
- Mission = pragmatic brief, not chat: target behavior, *specific* binding acceptance gates, proof commands, end with "work autonomously; do not ask questions. If unreachable, stop at the best honest point and write the tradeoff/census".
- Heartbeat: codex buffers stdout; real liveness = session-jsonl mtimes in `~/.codex/sessions/<yyyy>/<mm>/<dd>/`. `codex.exe` alive + newest session file stale >12 min → hung.
- Resume: `taskkill //IM codex.exe //F` (only if hung), then `codex exec resume --last "reorientation" < /dev/null`. Check `git status` first — WIP is on disk.
- Never trust its claimed numbers — re-run scorer/tests before calling a round done.
- Shared-worktree trap: codex stages as it goes; commit own files by pathspec or wait. Never two codexes on overlapping files.

**Tips proven over ~12 missions:**
- Instrument-first missions ("census before fix; the census is deliverable #1 even if nothing
  else lands") beat fix-first missions every time.
- Parallel implementation: fine on disjoint file surfaces; serialize when both touch the same file or produce the same artifacts for feedback.
- Verification catches real misses: Always rerun verification yourself and spot check all hot spots.
