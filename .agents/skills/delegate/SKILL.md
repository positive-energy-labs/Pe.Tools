---
name: delegate
description: Use to conserve token limits, work faster, or perform unrelated background tasks. Use especially for prototyping, sprawling requests, or long-haul sessions.
---

# Delegation

Optimize work by delegating to cheaper subagents. First, compress the problem space and anchor yourself. The user is consulting *you*, but not everything needs your eyes or hand. Judgement and liability are yours. Then, if any of the following feels true then delegate: 
- "requires 20+ tool calls?"
- "is there an unambiguous goal?"
- "will it interrupt my train of thought?"
- "is a fresh perspective needed?"
- "will parallel workstreams be faster AND workstreams dont overlap?"

**Declare posture periodically before fan-outs.** State in-chat the posture you are assuming. Optimize for the problem size and remember that limits change by hour and week.

**Run subagents in Herdr**, the `execute` skill owns the mechanics (session, panes, prompts, waits, wake-on-done). This skill owns who/when/what: model choice, mission shape, and work partitioning. A user interrupt kills harness subagents but not Herdr agents, one more reason the harness Agent tool is the exception, not the default. After any interruption, never assert liveness, check, then relaunch (or explicitly declare the work lost) before continuing.

## Why, two reasons
- Fable token limits are not enough. ~70% usage in a single day is easy. Opus and Codex have separate limits from Fable and are comparatively much cheaper.
- Optimize a session: parallelize work, handle a one-off, get fresh perspective, slow context window bloat during long sessions. 

## Model Attributes

> Cost: Price per task.
>
> Taste: Good "intuition", opinions, pretty code, UI/UX, architecture, and decisions.
>
> Intelligence: How likely is full marks on a big and complicated, but unambiguous task? On long-hauls, can they resist derailments and stay on task?

| Model | Cost | Taste | Intelligence | Use For | Usage Notes |
|--|--|--|--|--|--|
| Fable 5 | 10 | 9 | 7 | Design, aesthetics, and decision making. Delegate to sparingly, only for unbounded work and requests that require an opinion | low or medium thinking only. Rarely in parallel.
| Opus 5 | 6 | 6 | 4 | Most on the ground work, task must be bounded | medium or high thinking, Opus readily overdoes and derails, especially at high think and above.
| Codex (GPT-5.6) | 2 | 4 | 8 | Foot soldier, brute force, long slogs, and compile smashing. Use when the goal is quantifiable AND all implicit is explicable. | `codex exec` handles model and thinking level (5.6 high). 5.6 does only what you ask, both a blessing and a curse. It has no "intuition" but the job will always get done.

## Tips
- Revive *recently finished* agents to prevent repeated work and avoid the lossiness of playing Telephone. May also be cheaper if within token cache TTL. In Herdr this is just another prompt to the same settled agent.
- Worktrees for parallel/experimental work: creation rules live in the `execute` skill (CLI-created siblings, never nested).
- For parallelism, chunk workstreams by what they touch. Fine on disjoint file surfaces; consider serializing when both touch the same files, read the same base, or produce the same artifacts for feedback.
- If all subagents need the same base, then provide it to them. ie do the preliminary research, scaffold or make the fixture, etc. 
- Delegation surfaces systemic signals digestable, dont let them go. Alarm bells should ring when the tasks complexity or length exceeded expectations. Something should be fixed. Systemic concerns surface to user before approval.
- Instrument-first missions ("census before fix; the census is deliverable #1 even if nothing else lands") beat fix-first missions every time.
