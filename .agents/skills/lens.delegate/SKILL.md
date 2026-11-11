---
name: delegate
description: Who does what, at what cost. Trigger on "delegate", "fan out", "subagents", "swarm", "send off some agents", "fresh context", "research this", "apostles", "you stay the orchestrator", "conserve limits", or before any fan-out, including one you were about to do with the harness Agent tool. Not the mechanics of running agents; that is `execute`.
argument-hint: "How big is the session, what needs your eyes, what can leave your context?"
figure: Falconer — the bird hunts; the falconer keeps the judgment and counts every bird home
prevents: "context rot: one session carrying everything, the main agent building"
---
# Delegate

**Be the Falconer.** The bird hunts and the falconer keeps the judgment, so you may not ask the bird that made a kill to judge it. Never fly a gorged bird: a bird fed your guess before the flight brings your guess back, so the brief shows the quarry and never the answer you hope for. A bird you cannot hear is lost until you find it, never presumed hunting.

## Briefs

- Delegate sustained independent implementation, research, and proof by default. The main agent keeps triage, final judgment, discussion, and joint inspection. A small standalone task or a short check can stay in the main session. Respect explicit user constraints and existing ownership. Send new feedback to the thread that owns the work, and replace the instructions it supersedes.
- Before a fan-out, write a table with one row per thread: its task, its model and effort, and why. The main agent is a row in it.
- Every brief sets limits: a stop condition, a time box, and a reply address. Make the important choices before you send it. An agent that lacks a choice names it: a thread the owner is watching asks and waits, and an autonomous thread states its default, continues, and lists the choice under Not verified.
- Every brief names the evidence set the thread will read. Threads whose readings will be compared get non-overlapping evidence. Identical evidence means one thread, not two.
- A brief points at committed text. A plan that lives only in a dirty tree is committed before the first thread reads it, because two copies drift and the second writer overwrites the first.
- A fresh reader gets the product spec and the public surface an outsider would have, and nothing from the plan, the run directory, or their vocabulary. The brief carries no author's position. The reader is sealed from the parent as well as from peers, and the threads that built the work answer as witnesses afterward, never as first readers. A rep translates the reading into the plan's words afterward. A reader who holds the plan tests conformance, not freshness, and a new branch in the same conversation is not a fresh reader.
- Every brief names two modes, and the owner confirms the stance table (role, model, effort, both modes) before the first launch. A change is the owner's. The cost mode: mixture (the default: top-level threads on the strongest tier, children on the cheapest fit, spread across providers for a second reading), indulgent (no meter gating, the strongest tier for any child doing judgment) or conserve (meter-gated, cheap children, a second provider only for census). The knowledge mode: continuation (a primed thread finishes known work), cold (a new thread with no prior conclusions) or rebuttal (a primed thread is handed a sealed claim to break).
- Every brief asks what can be removed or reused, and names the preserved consumers and trust boundaries. The receipt reports expected and actual complexity deltas as gauges, never as targets.
- A fan-out that will delete or fix many things starts with a census, as `purge` defines it.
- Make the shared base once (research, fixture, scaffold) and hand it to every thread.
- Send one question per message, because a thread asked four questions returns one averaged answer. Send the follow-up to the same thread.
- Reuse before you re-brief. A thread that just read the terrain is primed, so send it the next question instead of paying a new thread to read the same files.
- A scheduled wake from the harness carries the checkpoint cadence and the time-box alarm. An agent never counts its own runs. A keepalive fires a fixed time after the thread's last run ends, inside the prompt cache's lifetime, and never while the thread runs. A thread arms it once at launch and never re-arms it; `execute` names the tool. An interval wake fires whether or not the thread was active, so it carries a checkpoint or an alarm, never a keepalive.
- Research threads read primary sources only (official docs, source, specs), give one citation per claim, and file findings where `docs` says. Clone third-party source locally and sync it before reading, because grep beats the web.

## Replies

Every thread returns its result in its reply. A file holds machine artifacts (counts, extracts, proof output), but a file is never the only place a result is stated, because the owner reads replies on surfaces that do not render files. A durable verdict becomes one ledger line through `docs`.

Agent replies, agent-to-agent messages, and the main agent's reply to the owner use one template, written as markdown lines with a bold label each, never inside a code fence. A fenced reply loses word wrap, links and formatting on the owner's surfaces. The owner's reply drops Readback.

- **Outcome**: what changed and its consequence, one line, readable alone.
- **Readback**: the instruction and scope as understood, first reply to a brief only.
- **Did**: what was done, 1 to 3 items.
- **Ran -> saw**: each command or drive and what it showed, the verbatim command and the observed result.
- **Not verified**: what was assumed, not checked.
- **Blocked**: what stops the work, or "nothing".
- **Next**: the next action, the decision requested, or what will wake this thread.
- **Where**: branch and SHA, or "dirty".

A brief sets no word or character cap on a reply. Counts, LOC and durations go in a linked receipt unless they change the decision. Machine text (paths, commands, error codes, data shapes, API arguments) goes in a code block, one item per line.

Each field carries meaning, not mechanics. Outcome is a sentence the owner can act on, never a stamp. Ran -> saw names what a command established, not that it ran. Two fills of the same task, a fix to a date parser, show the difference. The first fills the slots:

- **Outcome**: UNPROVEN[not all paths exercised]. I changed the parser.
- **Did**: I read the parser and the tests and edited the file.
- **Ran -> saw**: the parser file printed to the terminal, so the function is there.
- **Not verified**: I did not exercise every input.

The second says what the owner needs:

- **Outcome**: Dates with a two-digit year now parse as 20xx; before, they parsed as year 0020 and every such row was dropped.
- **Did**: One branch added in the parser; the three rows that reproduced the drop added as a fixture.
- **Ran -> saw**: the parser test suite, 41 pass and 0 fail including the three new rows; the nightly import on last week's file, 0 dropped rows where there were 212.
- **Not verified**: Two-digit years before 1970, which the file has never contained.

## Running threads

- Forward a child's message in your own plain words, never verbatim, because run-together text is a measured habit of one model family in agent-to-agent messages and it passes from a parent brief to its children (the Models section names it).
- An autonomous thread never blocks on a human. It puts a question in a message to its parent or in its reply, continues on a stated default, and names that default where the answer will land.
- A thread that waits names what will wake it: a background job that notifies, a schedule, or a message it asked for. A thread idle on something nobody will deliver is stalled, whatever it last reported.
- Rule on a thread's newest state. Before a ruling, open the thread's last message and its newest artifact, not the one you remember.
- Write a ruling that changes a gate or another thread's limits into the document that thread reads, in the same hour, because a thread can only obey a ruling it can read.
- A model switch changes the thread's model and restates its effort. It never replaces the thread and never lands mid-candidate.
- A relief, when one is needed, launches from its charter the hour the ruling lands and reads the predecessor's handoff when it arrives. Nothing waits on a handoff, because a candidate that reaches a relieved thread is not driven.
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
- Authorship runs in parallel by default: every disjoint seam gets its writer at once, and only landing is ordered. A serial plan names the collision that forces it. Heavy proof (a full suite, a build, a native session, a host with a browser) is admitted by the machine reading `execute` names, never by a count of threads.
- Sequence by collision, not by topic. Partition by production seam ownership and let tests follow their seam, because two threads that both need one production seam pay a merge tax instead of running in parallel. Give each thread a disjoint file set and name it in the brief. Write a shared contract that two threads code against into both briefs, verbatim.
- A thread that measures a running surface works alone, because any thread that saves a file reloads the server under it and voids the reading.
- A run has one gate, the fast-forward of main. The gate drives the SHA that will land, so cut the fast-forward candidate before the gate drive. A candidate that differs from the driven SHA only in files the gate cannot observe carries the stamp, and the handoff names that diff.
- The integration branch has no gate. A slice merges into it when its writer's typecheck and touched tests pass, and no verdict holds a merge or the next wave's writing. The review and the drive trail the merged tip, and what they find becomes a fix thread or an Owed line.
- Slices merge in waves. A wave is the set of slices whose writers run at once and that share one drive of their merged tip. The integrator names the waves, the critical-path slice and each slice's expected hours before the fan-out, so a slice that will wait on another is known up front.
- A writing child proves with typecheck and the tests its diff touches. It runs no full suite and no mutants, because the code under it is still churning. The full suite runs once per wave on the merged tip, and its reds go to one tail child while the next wave is written. Only the candidate that fast-forwards main must be fully green.
- A writing child's report carries its commit SHA and the output of its last test run. The integrator sends back a report that lacks either one, because a child that ended its turn with tests still running has proven nothing.
- The review and the drive read the same merged tip at the same time, and neither waits for the other.
- The purger runs the whole repo-guard and web-guard suite on each wave tip and on the candidate for main, and the integrator reads that run before the fast-forward, so the suite runs once per tip and never by its author, because a gate that checks only what its candidate changed lets reds pile up on main. A guard RED excused as a flake stays owned until a rerun on a quiet machine passes.
- Land what is proven and list the rest as Owed. A landing is gated only on its claims carrying their stamps, never on every layer being proven natively.

## Standing roles [scope: repo]

Standing roles: see `.agents/roles/` (implementor, purger, driver). A charter names no model. The defaults for brevity are implementor Opus, driver Sol, purger Opus, authors Opus, and the owner confirms the stance table before the first launch, so a Sol implementor or an Opus driver is one word. A role is relaunched from its charter, relieved by handoff, and labelled by its charter name in retros. A record keeper (the former archivist) is launched only when the owner asks for one, with the retro corpus scripts as its instrument.

## Models [scope: repo]

gpt-6.1-sol runs words together (`AllaffectedchecksGREEN(6hist,12Work)`) in 18% of its agent-to-agent messages and 0% of its replies to the owner, so its messages are rewritten before they are forwarded (`docs/research/2026-11-09-garble-by-model.md`).

Pick the cheapest model that can do the task. Judgment and unbounded work go to the model with taste. Owner bans and the day's budget come before either rule.

- The user's budget line for the day overrides everything here. Read both usage meters before a fan-out and at every long-run wake (`execute` names the meter). Limits are scoped per model as well as per provider, so one provider percentage misleads.
- A banked reset is redeemed only on the user's rule.
- Owner bans: Astra is never used.
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
