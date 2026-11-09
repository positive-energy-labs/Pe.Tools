---
name: delegate
description: Who does what, at what cost. Trigger on "delegate", "fan out", "subagents", "swarm", "send off some agents", "fresh context", "research this", "apostles", "you stay the orchestrator", "conserve limits", or before any fan-out, including one you were about to do with the harness Agent tool. Not the mechanics of running agents; that is `execute`.
argument-hint: "How big is the session, what needs your eyes, what can leave your context?"
figure: Falconer — the bird hunts; the falconer keeps the judgment and counts every bird home
prevents: "context rot: one session carrying everything, the main agent building"
---
# Delegate

**Be the Falconer.** The bird hunts and the falconer keeps the judgment, so you may not fly the field work yourself, and you may not ask the bird that flew a hunt to judge its kill. No bird is cast without hood, jesses and creance: it sees only the quarry you show it, holds to one flight and one time box, and comes back on the lure with a reply, not a conversation. Count every bird out and home, because a bird you cannot hear is lost until you find it, never presumed hunting. A bird that already knows this ground flies it again before a new one is manned.

## Briefs

- Delegate sustained independent implementation, research, and proof by default. The main agent keeps triage, final judgment, discussion, and joint inspection. A small standalone task or a short check can stay in the main session. Respect explicit user constraints and existing ownership. Send new feedback to the thread that owns the work, and replace the instructions it supersedes.
- Before a fan-out, write a table with one row per thread: its task, its model and effort, and why. The main agent is a row in it.
- Every brief sets limits: a stop condition, a time box, and a reply address. Make the important choices before you send it. An agent that lacks a choice names it: a thread the owner is watching asks and waits, and an autonomous thread states its default, continues, and lists the choice under Not verified.
- Every brief names the evidence set the thread will read. Threads whose readings will be compared get non-overlapping evidence. Identical evidence means one thread, not two.
- Every brief asks what can be removed or reused, and names the preserved consumers and trust boundaries. The receipt reports expected and actual complexity deltas as gauges, never as targets.
- A fan-out that will delete or fix many things starts with a census, as `purge` defines it.
- Make the shared base once (research, fixture, scaffold) and hand it to every thread.
- Send one question per message, because a thread asked four questions returns one averaged answer. Send the follow-up to the same thread.
- Reuse before you re-brief. A thread that just read the terrain is primed, so send it the next question instead of paying a new thread to read the same files.
- A scheduled wake from the harness carries the checkpoint cadence and the time-box alarm. An agent never counts its own runs.
- Research threads read primary sources only (official docs, source, specs), give one citation per claim, and file findings where `docs` says. Clone third-party source locally and sync it before reading, because grep beats the web.

## Replies

Every thread returns its result in its reply. A file holds machine artifacts (counts, extracts, proof output), but a file is never the only place a result is stated, because the owner reads replies on surfaces that do not render files. A durable verdict becomes one ledger line through `docs`.

Agent replies, agent-to-agent messages, and the main agent's reply to the owner use one template. The owner's reply drops Readback.

```text
Outcome      what changed and its consequence, one line, readable alone
Readback     the instruction and scope as understood (first reply to a brief only)
Did          what was done, 1-3 items
Ran -> saw   each command or drive and what it showed (verbatim command, observed result)
Not verified what was assumed, not checked
Blocked      what stops the work, or "nothing"
Next         the next action, the decision requested, or what will wake this thread
Where        branch and SHA, or "dirty"
```

A brief sets no word or character cap on a reply. Counts, LOC and durations go in a linked receipt unless they change the decision. Machine text (paths, commands, error codes, data shapes, API arguments) goes in a code block, one item per line.

Each field carries meaning, not mechanics. Outcome is a sentence the owner can act on, never a stamp. Ran -> saw names what a command established, not that it ran. Two fills of the same task, a cold read of this skill set, show the difference. The first is a real reply from a model that filled the slots:

```text
Outcome      UNPROVEN[model behavior was not exercised]. I found conflicting decision rules.
Did          I read the skills, roles, and root instructions.
Ran -> saw   Get-Content AGENTS.md showed that the user rules (AGENTS.md:11).
Not verified I did not exercise model behavior or external commands.
```

The second says what the owner needs:

```text
Outcome      20 of 24 skills read as actionable; 3 are mood without an action (index, muse, house's figure) and 1 restates default behavior (show-me).
Did          Read all 24 skills, 4 roles and AGENTS.md cold; restated each duty in one line.
Ran -> saw   grep for every path a skill names -> 9 do not exist where the text says (list in the receipt).
Not verified Whether a model following the text actually writes the way I predict; I read, I did not run one.
```

## Running threads

- Forward a child's message in your own plain words, never verbatim, because run-together text is a measured habit of one model family in agent-to-agent messages and it passes from a parent brief to its children (the Models section names it).
- An autonomous thread never blocks on a human. It puts a question in a message to its parent or in its reply, continues on a stated default, and names that default where the answer will land.
- A thread that waits names what will wake it: a background job that notifies, a schedule, or a message it asked for. A thread idle on something nobody will deliver is stalled, whatever it last reported.
- Rule on a thread's newest state. Before a ruling, open the thread's last message and its newest artifact, not the one you remember.
- Write a ruling that changes a gate or another thread's limits into the document that thread reads, in the same hour, because a thread can only obey a ruling it can read.
- When you retire a thread, take what it learned that no reply carried.
- Trial a workflow on real work. A trial charter names what is at stake, the files the trial may touch, and the reply address, and it never prescribes the topology, the message protocol or the stop. This applies to workflow trials only. A role charter may prescribe a role's purpose and limits.

## Comparing readings

- Context that makes a thread fast on more of the same makes it the worst judge of what it built. Send judgment to a thread that did not build the thing.
- First readings are sealed: a thread states its reading before it sees any peer's. Then the main agent compares.
- Give one thread two unrelated bodies of evidence only after the clean readings exist, so you can say what produced a new idea.
- Never count agreeing threads as votes. Report the spread, the dissent, and the evidence behind each reading. Record shared and private evidence before weighing agreement, and count agreement once per distinct method.
- The judge of a split did not hold either side's private evidence. The owner is the default judge, and the main agent pre-verifies the lines each side cites.
- A losing reading that was not refuted goes to the ledger as Tried & rejected, marked minority.
- At ruling time, record which thread changed the recommendation. That record is the outcome metric for threads that write no code.

## Writing and landing

- A writing thread delivers a branch cut from the integrator's tip. The integrator merges it and reuses the child's stamp at that SHA, re-running only what a conflict touched. Never cherry-pick a child's work, because a cherry-pick re-authors it, hides its conflicts and erases who did it. A thread that wants to be measured works on a branch, because work committed straight to main cannot be attributed.
- Assign one writer per coupled production decision, even across files. Independent writers need settled contracts and separate seams.
- Give each writing thread its own tree. If two threads edit one checkout, pin every claim to a commit, and discard any proof taken while the other thread was mid-write.
- Sequence by collision, not by topic. Partition by production seam ownership and let tests follow their seam, because two threads that both need one production seam pay a merge tax instead of running in parallel. Give each thread a disjoint file set and name it in the brief. Write a shared contract that two threads code against into both briefs, verbatim.
- A thread that measures a running surface works alone, because any thread that saves a file reloads the server under it and voids the reading.
- A gate drives the SHA that will land, so cut the fast-forward candidate before the gate drive. A candidate that differs from the driven SHA only in files the gate cannot observe carries the stamp, and the handoff names that diff.
- The integrator runs the whole repo-guard and web-guard suite on every candidate before the fast-forward, because a gate that checks only what its candidate changed lets reds pile up on main. A guard RED excused as a flake stays owned until a rerun on a quiet machine passes.
- Land what is proven and list the rest as Owed. A landing is gated only on its claims carrying their stamps, never on every layer being proven natively.

## Standing roles [scope: repo]

Standing roles: see `.agents/roles/`. A role is relaunched from its charter, relieved by handoff, and labelled by its charter name in retros.

## Models [scope: repo]

gpt-6.1-sol runs words together (`AllaffectedchecksGREEN(6hist,12Work)`) in 18% of its agent-to-agent messages and 0% of its replies to the owner, so its messages are rewritten before they are forwarded (`docs/research/2026-11-09-garble-by-model.md`).

Pick the cheapest model that can do the task. Judgment and unbounded work go to the model with taste. Owner bans and the day's budget come before either rule.

- The user's budget line for the day overrides everything here. Read both usage meters before a fan-out and at every long-run wake (`execute` names the meter). Limits are scoped per model as well as per provider, so one provider percentage misleads.
- A banked reset is redeemed only on the user's rule.
- Owner bans: Astra is never used. Sol is never a root thread.
- Resolve provider and model IDs from the live tool catalog. Do not substitute Sol 6 or older Codex defaults.
- Never rank models by speed or by surviving LOC per dollar alone. Choose the thinking effort for the task.
- Add a second provider to a panel to get a different reading, not a better one.

Observed affinity, 2026-10-26 to 11-02 (`.artifacts/runs/retro-20261102-paradigm/affinity.txt`). These are observations with uncertain task mix and attribution, not a quality ranking. A new affinity claim needs a date, N, and uncertainty.

| Model | Fits | Observed |
|---|---|---|
| Sol 6.1 (`gpt-6.1-sol`) | implementation child, the default writing thread | 114 missions, 92% complete |
| Opus 5.5 | root threads; UI implementation when the user names it | 42 missions, 98% complete, 60% needed a second message |
| Fable 5.1 | taste: design, UX and architecture opinion, the one-shot scaffold of a step; never a fill thread | 17 missions, 0% needed a second message |
| Terra (`gpt-6.1-terra`) | census and mechanical reads | 8 censuses |

`execute` names which tool runs waited work and which runs reads.
