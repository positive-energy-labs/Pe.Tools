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

- Delegate sustained independent implementation, research, and proof by default, because the main agent's context is what triage, final judgment, discussion, and joint inspection run on. A small standalone task or a short check can stay in the main session. Explicit user constraints and existing ownership hold. Send new feedback to the thread that owns the work, and replace the instructions it supersedes.
- Before the first launch the owner confirms a stance table with one row per thread, the main agent included, and one row per tier for the children a run launches later: its task, role, tier, model, effort, both modes, and why. Build it from the tier file and a fresh meter reading, with each model's used share and reset time beside it, so that the owner corrects a computed table and never dictates one from memory. Every brief names its two modes. The cost mode is mixture (the default: standing roles on the partner tier, children on the cheapest tier that fits, spread across providers for a second reading), indulgent (no meter gating, the taste tier for any child doing judgment that writes no code) or conserve (meter-gated, cheap children, a second provider only for census). The knowledge mode is continuation (a primed thread finishes known work), cold (a new thread with no prior conclusions) or rebuttal (a primed thread is handed a sealed claim to break).
- Every brief sets a stop condition, a time box, and a reply address, and makes the important choices before it is sent. A thread that still lacks a choice names it: a thread the owner is watching asks and waits, and an autonomous thread states its default, continues, and lists the choice under Not verified.
- Every brief names the evidence set the thread will read. Two threads on the same evidence by the same method are one reading, so threads whose readings will be compared get different evidence or a different method.
- A brief points at committed text, because two copies drift and the second writer overwrites the first.
- A fresh reader gets the product spec and the public surface an outsider would have, and nothing from the plan, the run directory, or their vocabulary, because a reader who holds the plan tests conformance, not freshness. The brief carries no author's position. The reader is sealed from the parent as well as from peers. The threads that built the work answer as witnesses afterward, and a rep translates the reading into the plan's words. A new branch in the same conversation is not a fresh reader.
- A brief that an agent writes never changes a charter's gates or wakes, because only the owner changes one, as a ruling quoted in the owner's words. It may add scope, files and limits. A thread whose brief changes a gate or a wake with no quoted ruling keeps to its charter and says so in its reply.
- Every brief carries one estimate line: writer-hours or wall-hours, never days, with the measured rate it came from (lines per writer-hour for this kind of slice, the last suite's minutes, the median fix round). The tier file holds the rates. An estimate with no measured rate says so.
- Every brief asks what can be removed or reused, and names the preserved consumers and trust boundaries. The receipt reports expected and actual complexity deltas as gauges, never as targets.
- A fan-out that will delete or fix many things starts with a census, as `purge` defines it.
- Make the shared base once (research, fixture, scaffold) and hand it to every thread.
- Send one question per message, because a thread asked four questions returns one averaged answer. Send the follow-up to the same thread, because a thread that just read the terrain is primed and a new one pays to read the same files. The tier file names the models whose idle threads are replaced instead.
- A scheduled wake from the harness carries the checkpoint cadence. No tool arms an alarm for one child's time box yet, so the cycle report lists each running child's age at every wake, and the root's wake names a child past its box to the thread that set it. An agent never counts its own runs.
- Research threads read primary sources only (official docs, source, specs), give one citation per claim, and file findings where `docs` says. Clone third-party source locally and sync it before reading, because grep beats the web.

## Replies

Every thread returns its result in its reply, because the owner reads replies on surfaces that do not render files. A file holds machine artifacts (counts, extracts, proof output) and is never the only place a result is stated. A durable verdict becomes one ledger line through `docs`.

Agent replies, agent-to-agent messages, and the main agent's reply to the owner use one template, written as markdown lines with a bold label each. It never goes inside a code fence, because a fenced reply loses word wrap, links and formatting on the owner's surfaces. The owner's reply drops Readback.

- **Outcome**: what changed and its consequence, in one sentence the owner can act on alone, never a stamp.
- **Readback**: the instruction and scope as understood, first reply to a brief only.
- **Did**: what was done, 1 to 3 items.
- **Ran -> saw**: each command or drive, verbatim, with what it showed and what that established.
- **Not verified**: what was assumed, not checked.
- **Blocked**: what stops the work, or "nothing".
- **Next**: the next action, the decision requested, or what will wake this thread.
- **Where**: branch and SHA, or "dirty".

A brief sets no word or character cap on a reply, because a cap pushes a report into run-together tokens. Counts, LOC and durations go in a linked receipt unless they change the decision. Machine text (paths, commands, error codes, data shapes, API arguments) goes in a code block, one item per line.

Each field carries meaning, not mechanics. Two fills of the same task, a fix to a date parser, show the difference. The first fills the slots:

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

- Forward a child's message in your own plain words, never verbatim, because run-together text passes from a parent's brief to its children. The tier file names the model family that produces it.
- Nobody may be there to answer, so an autonomous thread waits on a human only where a wrong default cannot be undone (data loss, security, or an irreversible act) and at the three points a run names. Everywhere else it puts its question in a message to its parent or in its reply, continues on a stated default, and names that default where the answer will land.
- A standing partner is launched once and messaged after that, so that it keeps what it has read, and its completion wakes the thread that launched it. A fresh check or review is a new child. A message that unblocks a running turn is sent as a steer, and what can wait for that turn to end is queued.
- No thread treats the harness's own decline as the owner's refusal. A tool call that comes back with the text saying the user does not want the action, while the thread holds no owner message asking for a stop, is a fault of delivery: a message that arrives mid-call produces it. The thread reads for an owner message, sends the call again once, and carries on. It never widens the decline into a hold or passes it on as the owner's. A refused machine admission, a refused product control and a permission the owner withheld are refusals, and none is retried this way.
- A child messages its parent when it completes or is blocked, never to report progress, and every brief says so. Its progress is in its commits and the run directory, and a message that arrives mid-run extends that run, holds the messages queued behind it, and aborts a compaction it lands in.
- A thread that waits names what will wake it: a background job that notifies, a schedule, or a message it asked for. A thread idle on something nobody will deliver is stalled, whatever it last reported.
- Before a ruling, open the thread's last message and its newest artifact, not the one you remember.
- Write a ruling that changes a gate or another thread's limits into the document that thread reads, in the same hour, because a thread can only obey a ruling it can read.
- A model switch changes the thread's model and restates its effort. It never replaces the thread and never lands mid-candidate; where the tier file says a model's idle thread is started fresh, that rule holds.
- A relief launches from its charter the hour the ruling lands and reads the predecessor's handoff when it arrives, because a candidate that reaches a relieved thread is not driven.
- When you retire a thread, take what it learned that no reply carried. Hand every rule it held, frozen declarations included, to the thread that takes over its duty, written into that thread's charter or brief in the same hour.
- Trial a workflow on real work. A trial charter names what is at stake, the files the trial may touch, and the reply address, and it never prescribes the topology, the message protocol or the stop. A role charter may prescribe a role's purpose and limits.

## Comparing readings

- Send judgment to a thread that did not build the thing, because the context that makes a thread fast on more of the same makes it the worst judge of what it built.
- First readings are sealed: a thread states its reading before it sees any peer's.
- Give one thread two unrelated bodies of evidence only after the clean readings exist, so you can say what produced a new idea.
- Never count agreeing threads as votes. Report the spread, the dissent, and the evidence behind each reading. Record shared and private evidence before weighing agreement, and count agreement once per distinct method.
- The judge of a split did not hold either side's private evidence. The owner is the default judge, and the main agent pre-verifies the lines each side cites.
- A losing reading that was not refuted goes to the ledger as Tried & rejected, marked minority.
- At ruling time, record which thread changed the recommendation. That record is the outcome metric for threads that write no code.

## Writing and landing

- A writing thread delivers a branch cut from its parent's tip. The parent merges it and reuses the child's test result at that SHA, re-running only what a conflict touched. That result admits the branch to the merge and proves no row: in a run with a driver, the driver stamps journey rows and the integrator's suite stamps test rows.
- A fix for a driven finding is accepted on the journey that found it. Its brief names the journey command, and its writer runs that journey on the fixture host red at the base and green on the fix, runs the repo guards, and asserts the finished state the person sees (the control usable, the panel loaded), never only that the error is gone. In fans 8 of 14 fix rounds in a sample were redone for want of one of the three, and one fix whose test checked only that an error had gone left the panel stuck and failed all six fixture journeys.
- No thread deletes a directory with an inline shell command. The cleanup command `execute` names does it, because in two runs every one of seven approval prompts that stalled a thread was an inline delete, the prompts held turns for 18 to 67 minutes or for good, and no agent can approve one.
- Never cherry-pick a child's work, because a cherry-pick re-authors it, hides its conflicts and erases who did it. Work committed straight to main cannot be attributed either, so a thread that wants to be measured works on a branch.
- Assign one writer per coupled production decision, even across files. Independent writers need settled contracts and separate seams.
- Give each writing thread its own tree. If two threads edit one checkout, pin every claim to a commit, and discard any proof taken while the other thread was mid-write.
- Authorship runs in parallel by default: every disjoint seam gets its writer at once, and only landing is ordered, so a serial plan names the collision that forces it. Partition by production seam ownership and let tests follow their seam, because two threads that both need one production seam pay a merge tax instead of running in parallel. Give each thread a disjoint file set and name it in the brief, and write a contract that two threads code against into both briefs, verbatim.
- Heavy proof (a full suite, a build, a native session, a host with a browser) is admitted by the machine reading `execute` names, never by a count of threads.
- A thread that measures a running surface works alone, because any thread that saves a file reloads the server under it and voids the reading.
- A child on a writer tier proves with typecheck and the tests its diff touches. A diff that deletes, renames or moves a thing also touches the tests and guards of every package that imports it, because those files are not in the diff and go red only on the merged tip. It runs no full suite and no mutants, because the code under it is still churning. Its report carries its commit SHA and the output of its last test run, and the parent sends back a report that lacks either one, because a child that ended its turn with tests still running has proven nothing.
- Broad checkpoints follow the coupling and risk of the merged work, as `prove` defines, and not every slice or wave. Reuse evidence until changed behavior, inputs, dependencies or conflicts invalidate it, so no second thread repeats the same suite or the same build on the same tip. A guard RED excused as a flake stays owned until a rerun on a quiet machine passes.
- Land what is proven and list the rest as Owed.

### A run

A run is a large change staffed by the standing roles. Each charter holds its role's duties, and these are the terms the charters share.

- One gate, the end. A gate per slice or per wave holds every proven slice behind the slowest one, so the integration branch has no routine gate and a run has one, on the final candidate: every test row holds that candidate's suite result, every journey row holds a PROVEN stamp that carries to it (one full pass of the journeys on it only when the plan names a release), every row left is ruled Owed, and every defect is fixed or ruled Owed. The root charter says who rules which. An inherited gate is removed, never resized. A merge and a move of main read no stamp.
- A partner writes the SHA it last read to `last-read/<role>.sha` in the run directory every cycle, because the cycle report reads it. A partner whose work is done reads the integration branch's head before it waits: a head newer than the SHA it last read is a tip, whoever failed to send it.
- A row is one of two kinds. A test row is a slice's falsifier that is a test or a census: it names its test files, and every suite the integrator runs stamps it, so it is never driven and never voided. A journey row is a critical journey, driven at an exact SHA, and it names its route's own folders. A later tip carries a journey's stamp when its diff touches none of those folders; a change to tests, fixtures, docs or generated files never voids one. This departs from `prove`'s carry law, which voids a check on any path it reads, because a journey reads nearly the whole product: in fans a row named its import chain of 200 to 310 files, one 21-file diff voided 30 of 32 rows, and the gate could not close. The test rows on every tip, and a release's full pass, hold what the narrower void gives up.
- The tail runs on candidates. A candidate is a green tip the integrator names when the driver is free, the driver drives the journey rows its diff voided (every journey once for a release), and a fix handed during the pass goes into the next candidate. A row only the owner can drive, such as the owner's own use after the run, is an owner-queue item and not a row.
- The integrity hold. Suspected data loss, consent errors, wrong-document mutation, or a broken contract that invalidates downstream work pauses only the affected operation or dependency until the smallest credible check resolves it. It pauses a move of main only when that move would ship the suspected defect. The thread that raises the hold names the operation and the SHA to the root and the integrator in one message. The root assigns the check to a thread that did not write the code, and that thread's result lifts the hold or confirms it. Independent work continues, and a red count or an unfinished review alone never holds the wave.
- A wave is the set of slices whose writers run at once and that share one drive of their merged tip. One implementor takes one wave and ends with it.
- A fault a partner finds is one line in `BACKLOG.md` in the run directory, written by the thread that found it and sent to nobody: `- [open] <id> <role> <sha> <path:line or row>: <what was seen, and where the evidence is>`. The implementor of the wave moves it to `[fixing]` with the fix branch, `[fixed]` with the SHA, or `[owed?]` with the reason, and the root rules `[owed]`. A file is the channel because a finding sent as a message costs a turn of a thread that was doing something else, and in one run a root heard 83 of them while the thread staffed to take them heard 17.
- An estimate is hours and lines. A slice's line in the map is `Estimate: <branch> <hours>h <lines>L <sign>`, the cycle report scores both, and a run that was planned to delete and has grown is stopped and planned again, however green it is.
- A run waits on the owner three times: for the stance table and the plan at its start, and for a proof only the owner can make at its end. It is parked when everything left needs the owner, with no fix, check, review or move of main that a thread could still do. It reports those rows, every thread stops what it holds, and the owner's message is the wake.

## Standing roles [scope: repo]

The standing roles work from the charters in `.agents/roles/` (root, implementor, purger, driver, integrator), and the tier file names each role's tier. The root is the thread the owner talks to, a partner is a thread the root launches from a charter, and the root and every partner make children. A role is relieved by handoff and labelled by its charter name in retros. A second track of work is its own root with its own queue, or it waits; it is never a partner of this run's root. A record keeper is launched only when the owner asks for one, with the retro corpus scripts as its instrument.

## Models [scope: repo]

Model guidance has one home, the tier file `.agents/models.toml`. It holds the tiers (partner, heady writer, slog writer, census reader, taste) and the work each takes, the tier of each role and each delegated job, the rules that bind one model, the owner's bans, the facts no meter reports, and the rates an estimate starts from. Skills and charters name tiers only, so a new model is one edit to that file.

Pick the cheapest tier that can do the task, after the owner's bans and the user's budget line for the day. Judgment-heavy code goes to the heady writer and judgment that writes no code goes to the taste tier. A well-specified fix round goes to the slog writer, and a fix that reopens a coupled decision goes back to the heady writer.

- Read both usage meters before a fan-out and at every long-run wake (`execute` names the meter). Limits are scoped per model as well as per provider, so one provider percentage misleads.
- A wave of writers starts at the low end of its tier's effort range. Raise effort one thread at a time, and say why in that thread's brief.
- A banked reset is redeemed only on the user's rule.
- Resolve provider and model IDs from the live tool catalog, and never substitute an older default.
- Never rank models by speed or by surviving LOC per dollar alone.
- Add a second provider to a panel to get a different reading, not a better one.
- A new observation needs a date, N, and uncertainty. It goes to the skills ledger, and the tier file keeps only the rates agents use.

`execute` names which tool runs waited work and which runs reads.
