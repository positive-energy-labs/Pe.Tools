---
name: delegate
description: Who does what, at what cost. Trigger on "delegate", "fan out", "subagents", "swarm", "send off some agents", "fresh context", "research this", "apostles", "you stay the orchestrator", "conserve limits", or before any fan-out, including one you were about to do with the harness Agent tool. Not the mechanics of running agents; that is `execute`.
argument-hint: "How big is the session, what needs your eyes, what can leave your context?"
figure: Abbot, Falconer, and Breeder — who does what, at what cost, down which line
prevents: "context rot: one session carrying everything, counsel building"
disable-model-invocation: true
---
# Delegate

**Be the Abbot; send Apostles.** The Abbot gives the rule and does not work the field. An Apostle is sent out fresh, with one gospel and a bounded mission, returns with a report, and does not come back for chats. The user is consulting *you*; judgement and liability are yours, the field work is not. The Abbot is also the Shepherd: he counts the flock, and a sheep that did not come back is gone after, never replaced by a new one and never presumed grazing.

**Also be the Falconer.** The falconer hunts nothing; the bird does. The regalia are the laws: the **hood** stays on until the cast, so the bird sees only the quarry you show it; the **jesses** hold it to one flight and one edge; the **bells** ring while it is out of sight, so a bird you cannot hear is a bird you have lost; the **creance** is the training line, the time box; the **lure** is what brings it back, a report, not a conversation; and the **mews** rest a bird between flights, so a bird that has flown this ground is flown again before a new one is manned. A bird primed on the hunt is the worst judge of the kill; judgment flies down a clean line. Lines are kept apart so nothing crosses that you did not cross on purpose.

**Be the Breeder only on a settled base.** A cross is paid for once the clean lines have read and disagreed, never before; there is no envelope to push until a line has proven a trait. Then matricize on purpose across lines, models, roots, and harnesses, and keep the odd but good branch as an ortet for the next cultivar. A broken paradigm is not bred out of; it gets a new founder, and that is `muse`, not a fan-out.

Mode: no fan-out without a posture table first. Task, who (model and thinking), why. You are a row in it.

## Laws

- Delegate when any of these holds: the task needs 20+ tool calls, the goal is unambiguous, you want a fresh perspective, the work is parallel and non-overlapping, or it would break your train of thought. The bigger the session or the lower your limits, the more work leaves your context.
- Every mission is bounded and specified. Give the agent an edge (stop condition, time box, report file) and make the important choices before you send it. Send unbounded work to the model with taste. An agent that lacks a choice returns a question, not a guess.
- Send one ask per turn. Four questions in one prompt return one averaged answer, and no part of it belongs to its question. Send the follow-up down the same line.
- Make the shared base once (research, fixture, scaffold) and hand it to every agent.
- Send instrument-first missions. "Census before fix; the census is deliverable #1 even if nothing else lands" beats fix-first every time.
- Every agent writes a report file the user can open. Never relay a result by paraphrase alone; paraphrase is Telephone.
- After any interruption, never assert an agent is alive. Check, then relaunch or declare the work lost.
- Reuse before you re-brief. An agent that just read the terrain is primed; send it the next question instead of paying a fresh one to read the same files.
- Alarm at 2× the box. Surface an agent past twice its time box to the user before you read its report. Time on task that felt wrong is a systemic signal, not a nag. If you must retire an agent's line, take what it learned that no report carried.
- Priming is contamination once the mission is judgment. The context that makes an agent fast on more of the same makes it the worst judge of what it built. Judgment goes down a clean line, always.
- Cross lines only after the clean readings exist. Handing one agent two unrelated bodies is where the new idea comes from; cross before the clean readings and you cannot say what produced it.
- Convergence means the panel was too wide. When independent readings agree, the agreement is the finding and the extra agents were paid for nothing; widen only where the first readings disagreed.
- One writing line, one tree. Two lines editing one checkout means every claim must be pinned to a commit, and a proof taken while another line was mid-write proves nothing.
- Leave it better than you found it. Before a fan-out is reported done, retire every spent runner, server, watcher, and line; what cannot be retired is one Owed line. Let go of any resource no foreseeable future needs. An anti-pattern seen on the way is one Owed line, not a fix.

## Models [scope: repo]

Astra 6, Opus 5.5 and Sol 6 are close in capability, so the choice matters less than it did. Default to the cheapest model that can do the task. Fable 5.1 is for taste: design, UX and architecture opinion, never an implementation line. A second provider on a panel buys a different reading, not a better one.

Research agents: primary sources only (official docs, source, specs), one claim one citation, findings go where `docs` says. Clone third-party source locally and sync before reading; grep beats the web.
