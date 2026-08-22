---
name: delegate
description: Use when context hygiene and size is important. Subagent delegation keeps context clean, conserves token limits, and enables parallel work. Use for long sessions, sprawling requests, prototyping, etc. 
argument-hint: Session is huge|big|medium? What needs a second opinion? What work is best kept out of context (starting line research, one-offs, unimportant work, etc.)? 
---

# Delegation

Optimize work by delegating to cheaper subagents. First, compress the problem space and anchor yourself. The user is consulting *you*, but not everything needs your eyes or hand. Judgement and liability are yours. Then, if any of the following feels true, delegate: 
- "requires 20+ tool calls?"
- "is there an unambiguous goal?"
- "will it interrupt my train of thought?"
- "is a fresh perspective needed?"
- "will parallel workstreams be faster AND workstreams dont overlap?"

**Declare posture before fan-out.** Show sequencing, with you included, as a table of task, model+think, and why. Be adaptable to the work and concious of what needs you and what doesn't. Huge sessions need you as only an orchestrator. The smaller the session, or the lower the limits, the more work you should do.

**Run subagents in Herdr**, the `execute` skill owns the mechanics (session, panes, prompts, waits, wake-on-done). This skill owns who/when/what: model choice, mission shape, and work partitioning. A user interrupt kills harness subagents but not Herdr agents, one more reason the harness Agent tool is the exception, not the default. After any interruption, never assert liveness, check, then relaunch (or explicitly declare the work lost) before continuing.

## Why, two reasons
- Fable token limits are not enough. ~70% usage in a single day is easy. Opus and Codex have separate limits from Fable and are comparatively much cheaper.
- Optimize a session: parallelize work, handle a one-off, get fresh perspective, slow context window bloat during long sessions. 

## Model Attributes

> **Cost:** Price per task.
>
> **Taste:** Good "intuition", opinions, pretty code, UI/UX, architecture, and decisions.
>
> **Intelligence:** How likely is full marks on a big and complicated, but bounded and/or specified task? On long-hauls, can they resist derailments and stay on task?
> - **Bounded:** The job has a supplied edge or stop condition.
> - **Specified:** The job’s important choices are supplied.

| Model | Cost | Taste | Intelligence | Use For | Usage Notes |
|--|--|--|--|--|--|
| Fable 5 | 10 | 9 | 7 | Design, aesthetics, and decision making. Delegate to sparingly, only for unbounded AND unspecified work. Or requests for important design opinion. | Low or medium thinking only. Never in parallel. |
| Opus 5 | 6 | 6 | 4 | Most initial implementations. The task must be bounded and extra work or review forbidden. | Medium or high thinking. Opus readily overdoes and derails, especially at high thinking and above. |
| Codex (GPT-5.6) | 2 | 4 | 8 | Migration foot soldier, brute force, long slogs, compile smashing, etc. Use when the goal is quantifiable AND important choices can be specified. | Codex TOML handles model + thinking (5.6 high). 5.6 takes you at face value with no interpretation. A blessing and a curse. It’s short on "intuition," *but* the job will always get done. **Amazing for swarms** |

## Tips
- Reuse *recently* finished agents to avoid repeated work and the lossiness of playing Telephone. In Herdr this is just another prompt to the same settled agent.
- Worktrees for parallel/experimental work: creation rules live in the `execute` skill (CLI-created siblings, never nested).
- Use different models/providers for different perspectives. Anything below GPT-5.6 Sol and Opus 5 is fair game.
- If all subagents need the same base, then provide it to them. ie do the preliminary research, scaffold or make the fixture, etc. 
- Delegation surfaces systemic signals digestable, dont let them go. Alarm bells should ring when the tasks complexity or length exceeded expectations. Something should be fixed. Systemic concerns surface to user before approval.
- Instrument-first missions ("census before fix; the census is deliverable #1 even if nothing else lands") beat fix-first missions every time.
