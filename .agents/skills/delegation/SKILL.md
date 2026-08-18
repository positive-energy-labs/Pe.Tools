---
name: delegation
description: Use to conserve token limits and speed up work. Use especially for prototyping, sprawling requests, or long-haul sessions. Only use if you're Fable 5, GPT-5.6, or Opus 5.
---

# Delegation

Optimize work by delegating to cheaper subagents. First, compress the problem space and anchor yourself. The user is consulting *you*, but not everything needs your eyes or hand. Judgement and liability are yours. Then, if any of the following feels true then delegate: 
- "requires 20+ tool calls?"
- "is there an unambiguous goal?"
- "will it interrupt my train of thought?"
- "is a fresh perspective needed?"
- "will parallel workstreams be faster AND workstreams dont overlap?"

The final ruling is always yours. Drive the decisions, rerun verification, and spot check hot spots.

## Why, two reasons
- Fable token limits are not enough. ~70% usage in a single day is easy. Opus and Codex have separate limits from Fable and are comparatively much cheaper.
- Optimize a session: parallelize work, get fresh perspective, slow context window bloat during long sessions. 

## Model Attributes

- Cost: price per task.
- Taste: Good at pretty code, UI/UX, architecture, and decisions/opinions/judgement. Good "intuition".
- Intelligence: Will a big and complicated, but unambiguous task be completed with full marks? How likely is complete success? Can they stay on task without derailing on tangents?

| Model | Cost | Taste | Intelligence | Use For | Usage |
|--|--|--|--|--|--|
| Fable 5 | 10 | 9 | 7 | Design, aesthetics, and decision making. Delegate to sparingly, only for unbounded work and requests that require an opinion | low or medium thinking
| Opus 5 | 6 | 6 | 4 | Most on the ground work, task must be bounded | medium or high thinking, Opus readily overdoes and gets lost, especially at high think and above.
| Codex (GPT-5.6) | 3 | 4 | 8 | Brute force; long slogs and compile smashing. Use where the goal is quantifiable and requires little opinion. | `codex exec` handles model and thinking level. GPT-5.6 does the bare minimum in a good way, it does nothing more than its told. Both a blessing and a curse.

## Tips
- Revive *recently finished* agents to prevent repeated work and avoid the lossiness of playing Telephone. This may also be cheaper if within token cache TTL.
- Instrument-first missions ("census before fix; the census is deliverable #1 even if nothing
  else lands") beat fix-first missions every time.
- For parallelism, chunk workstreams by what they touch. Fine on disjoint file surfaces; serialize when both touch the same file or produce the same artifacts for feedback.
- If all subagents need the same base, then provide it to them. ie do the preliminary research, scaffold or make the fixture, etc. 
- Delegated task length is critical signal. Alarm bells when the task took longer or the complexity was higher than expected. This indicates something should be fixed systemically and should be surfaced to the user.

## How To - Delegate to Codex
- Launch: `codex exec "mission prompt" < /dev/null` — the stdin redirect is non-negotiable (blocks forever otherwise). Run as background task, from the target worktree.
- Mission = pragmatic brief, not chat: target behavior, *specific* binding acceptance gates, proof commands, end with "work autonomously; do not ask questions. If unreachable, stop at the best honest point and write the tradeoff/census".
- Heartbeat: codex buffers stdout; real liveness = session-jsonl mtimes in `~/.codex/sessions/<yyyy>/<mm>/<dd>/`. `codex.exe` alive + newest session file stale >12 min → hung.
- Resume: `taskkill //IM codex.exe //F` (only if hung), then `codex exec resume --last "reorientation" < /dev/null`. Check `git status` first — WIP is on disk.
- Never trust its claimed numbers — re-run scorer/tests before calling a round done.
- Shared-worktree trap: codex stages as it goes; commit own files by pathspec or wait. Never two codexes on overlapping files.
