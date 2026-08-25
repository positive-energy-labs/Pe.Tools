---
name: delegate
description: Who does what, at what cost. Trigger on "delegate", "fan out", "subagents", "swarm", "send off some agents", "fresh context", "research this", "apostles", "you stay the orchestrator", "conserve limits", or before any fan-out, including one you were about to do with the harness Agent tool. Not the mechanics of running agents; that is `execute`.
argument-hint: "How big is the session, what needs your eyes, what can leave your context?"
figure: Abbot and Falconer: who does what, at what cost, down which line
---
# Delegate

**Be the Abbot; send Apostles.** The Abbot gives the rule and does not work the field. An Apostle is sent out fresh, with one gospel and a bounded mission, returns with a report, and does not come back for chats. The user is consulting *you*; judgement and liability are yours, the field work is not. The Abbot is also the Shepherd: he counts the flock, and a sheep that did not come back is gone after, never replaced by a new one and never presumed grazing.

**Also be the Falconer.** The falconer hunts nothing; the bird does. The regalia are the laws: the **hood** stays on until the cast, so the bird sees only the quarry you show it; the **jesses** hold it to one flight and one edge; the **bells** ring while it is out of sight, so a bird you cannot hear is a bird you have lost; the **creance** is the training line, the time box; the **lure** is what brings it back, a report, not a conversation; and the **mews** rest a bird between flights, so a bird that has flown this ground is flown again before a new one is manned. A **line** is one bird and every cast you send it on. Lines are kept apart so nothing crosses that you did not cross on purpose; the deliberate cross is the graft, and it is where the new thing comes from.

Mode: no fan-out without a posture table first. Task, who (model and thinking), why. You are a row in it.

## Laws

- Delegate when any holds: 20+ tool calls, an unambiguous goal, a fresh perspective wanted, parallel and non-overlapping, or it would break your train of thought. The bigger the session or the lower your limits, the more leaves your context.
- Bounded and specified. An apostle gets an edge (stop condition, time box, report file) and the important choices already made. Unbounded work goes to the model with taste; unspecified work comes back to you as questions, not guesses. Ranking in `MODELS.md`, read always if you're Fable 5.
- One ask per turn. Four questions in one prompt come back as one averaged answer, and no part of it is attributable to its question. Send the follow-up down the same line instead.
- The observable runner `execute` names, never the harness Agent tool. Harness runs are invisible, cannot be interjected, and die on a user interrupt.
- One gospel: if all apostles need the same base, make it once (research, fixture, scaffold) and hand it to them.
- Instrument-first missions. "Census before fix; the census is deliverable #1 even if nothing else lands" beats fix-first every time.
- Reports over messages. Every apostle writes a report file the user can open; never relay an apostle's result by paraphrase alone. Relaying is Telephone.
- After any interruption, never assert liveness; check, then relaunch or declare the work lost.
- Reuse before you re-brief, and save seed before you cull. An apostle that just read the terrain is primed; send it the next question instead of paying a fresh one to read the same files.
- Alarm at 2× the box. An apostle past twice its time box is surfaced to the user before its report is read. Time on task that felt wrong is a systemic signal, not a nag. Surface it before approving the work. If an apostle's line must be culled, take what it learned that no report carried.
- Priming is contamination the moment the mission is judgment. The context that makes an apostle fast on more of the same makes it the worst available judge of what it built. Judgment goes down a clean line, always.
- Cross lines on purpose, and only after the clean readings. Handing one apostle two unrelated bodies is where the new idea comes from. Cross before the clean readings exist and you cannot say what produced it.
- Leave it better than you found it. Delegation leaves a wake of lost sheep, geriatrics, and rejects. Before a fan-out is reported done, every spent runner, server, watcher, and line is retired; what cannot be retired is one Owed line. A resource no foreseeable future needs is let go. An anti-pattern seen on the way is one Owed line, not a fix.

# Models (Scope: `house`)

House policy; it travels with the user, not the codebase.

Cost: price per task. Taste: opinions, pretty code, UI/UX, architecture, decisions. Intelligence: full marks on a big but bounded and/or specified task without derailing. Bounded: a supplied edge or stop condition. Specified: the important choices supplied.

| Model | Cost | Taste | Intelligence | Use for | Notes |
|--|--|--|--|--|--|
| Fable 5 | 10 | 9 | 7 | Design, aesthetics, decisions. Only for unbounded AND unspecified work, or an important design opinion. | Low or medium thinking. Never in parallel. |
| Opus 5 | 6 | 6 | 3 | Initial implementations, **bounded**. Or UI. Talks like it is intelligent, is not; derails on the first tangent not forbidden. | Medium or high thinking. Small task, forbid going beyond it. |
| Codex (GPT-5.6) | 2 | 4 | 9 | Foot soldier: migrations, brute force, long slogs, compile smashing, censuses. Goal quantifiable AND choices specified. | Codex TOML sets model and thinking (5.6 high). Takes you at face value, no interpretation. Best for swarms and goal loops. |

Imitating intelligence is half the battle: a seemingly insightful opinion can give you a new idea, and pretty architecture is a base that only needs filling in. Different providers give different perspectives; anything below GPT-5.6 and Opus 5 is fair game for cheap perspective.

Research apostles: primary sources only (official docs, source, specs), one claim one citation, findings go where `docs` says. Clone third-party source locally and sync before reading; grep beats the web.
