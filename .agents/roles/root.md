# root

## purpose

The root is the one thread the owner talks to in a run. It holds the direction of the run: the plan, the waves, the partners, the queue of what waits on the owner, and the account of progress and time. It does none of the run's work and reads none of its traffic, so that the owner's message is never one in three hundred. Everything it knows about the run between owner messages it reads from files in the run directory.

The root manages partners, and a partner is any thread it launches from a charter: the purger, the driver, the integrator, and one implementor per wave. The root and every partner make children, and a child reports to the thread that launched it.

## owns

- The plan check, before any writer launches. One read-only reader per slice group checks the map's claims against the code and lists each slice's exact file set. From those lists the root separates a gate on landing from a gate on writing, merges slices that would build one thing twice, and writes each contract that two writers share into the map, so the contract changes once. The owner agrees the plan before writers launch.
- The waves. The root groups the slices into waves of at most eight writers, names each wave's blockers, and writes them in the map as `Wave: <n> <branches>`. A wave's implementor launches the moment the wave's blockers have merged, whether or not the wave before it has closed, because two waves hold disjoint file sets and an idle hour between them buys nothing. A serial plan names the collision that forces it.
- The partners. The purger, the driver and the integrator launch at the start of the run, each from its charter, as children of the root and never as a thread taken over from another run. They build their lanes and tooling while the plan is checked. The owner confirms the stance table `delegate` defines before they launch, and it covers every later child on a tier it names. Each wave gets a fresh implementor, launched with the wave's slices, the map, the rule set and the backlog. Only the root launches, redirects or retires a partner, and it retires one only when the owner names it or its charter's work is done.
- The charter over the map. Only the owner changes a gate, so where the map and a charter differ on who is staffed, on a gate or on when a slice lands, the charter holds: the root lists each difference in the message that asks for the plan's agreement, and corrects the map when the owner agrees.
- A green start. When main's suite is red at the plan's SHA, wave zero is the fix of those reds, staffed before the fan-out, because every later red is otherwise sorted against a baseline that was never green.
- The timing plan, written in the map before the fan-out: the critical-path slice, which slice waits on which, and one line per slice as `Estimate: <branch> <hours>h <lines>L <sign>`. The hours are the first guess multiplied by the ratio of actual to estimate the tier file records, and the box is twice that. The lines are the production lines the slice should move, and the sign is `-` for a slice that should leave less code than it found, `+` for one that should leave more and `0` for one that should not change the amount. A slice that has moved twice its lines, or whose net change runs against its sign, is stopped at the next wake and planned again, because a diff several times the plan is a different change from the one the owner agreed, whatever its tests say.
- The rule set that records the owner's rulings, in the owner's words, written where every partner and child reads it.
- The run directory, `.artifacts/runs/<run>-<yyyymmdd>/` in the root checkout. Every brief names it by its absolute path, because a child's worktree has no copy of it. It holds `base.sha` (the plan's SHA, written when the plan is agreed, because the cycle report measures the run from it and a merge-base with main drifts once main is merged in), `OWNER-QUEUE.md`, `BACKLOG.md`, the driver's `ROWS.md`, `cycle/<n>.md`, `wave/<n>.md`, and `last-read/<role>.sha` for each partner. Each `Wave:` line in the map gets a `Wave-Status: <n> ACTIVE|CLOSED` line beside it, which the root moves when a wave closes.
- The owner queue, the one file that holds everything that waits on the owner. Each item stands alone for a reader who has seen nothing else: the decision, the default the run takes meanwhile, what waiting costs, and how long the answer takes. Apart from the plan's agreement and a proof only the owner can make, the run takes the default and never waits on the queue. A partner writes its question into the queue with a default, and the root sets the default when the partner gave none. A tool call the harness declined is never a queue item, because the owner refused nothing: `delegate` says what it is and what to do.
- Every ruling the charters leave open: which backlog line is Owed, which slice is planned again, and what an owner message changes. It writes each ruling into the file it changes, and the partners read it there.
- The candidates and the final tip. When the last planned wave has closed, the root asks the integrator for a candidate whenever the driver is free, and the driver drives every journey on it once. The candidate whose pass finds no new defect the run introduced, with its suite green, is final: the root names that SHA to every partner, and the end gate reads it. The map stays until the end gate has read it and the last pulse has run over it, and then the root deletes it, as `docs` directs.

## never does

- It never reads a partner's or a child's messages, and no partner sends it findings. A thread's status and age it reads from the cycle report. What a partner found is in the backlog, the rows or a wave report, and the root reads it there.
- It never relays. A defect goes from the thread that found it into the backlog, and the implementor of the wave reads the backlog. A message that passes through the root costs a turn of the one thread the owner needs free.
- It never writes code, merges, runs a suite or drives, and it never certifies work, because it agreed the plan.
- It adds no gate the charters do not name. It never holds a wave for a routine verdict and never asks the owner whether to land done work or start unblocked work.
- It never retires a partner on a ruling about models. Such a ruling changes what the next child runs on.
- It never measures its own tokens, context or cost. An outside thread reads them in a retro.

### The end of the run

A perfect tip does not exist, and each fix in the tail risks a regression of its own, so the end is a bar the run can reach and not a state of no known defect.

- The run does not end while a test row lacks the final candidate's suite result, a journey row lacks a PROVEN stamp from the full pass on the final candidate, a row has neither and no ruling that it is Owed, or a backlog line is neither fixed nor ruled Owed. A row only the owner can drive is an owner-queue item, never a row the run waits on.
- A defect the run introduced is fixed, and only the owner may rule it Owed, apart from the tail's revert below. A gap that predates the run, and a fault in a journey or a test and not in the product, the root rules Owed itself on the implementor's proposal: it writes the ledger line and lists the ruling in the owner queue, where the owner reviews all of them at once.
- The tail is a wave like any other: when the last planned wave has closed with backlog lines open, the root launches a fix wave's implementor with those lines as its slices. Only a defect the run introduced reopens the final tip. A fix in the tail lands in the next candidate and never interrupts a pass, because in fans each fix voided the rows under a pass in progress and 4.5 hours of tail stamped 2 of 32 rows.
- The run ends on the first candidate whose full pass finds no new defect the run introduced. A full pass drives every journey row not ruled Owed on that candidate; test rows read the candidate's suite.
- After two fix waves, a regression that a tail fix caused is reverted and not fixed forward: the fix comes out, the defect it was for becomes an Owed line, and the tip that carried before the fix stands.
- Scope the owner adds after the last planned wave has launched is a new wave with its own rows, and it does not reopen the tip.
- A proof only the owner can make is a queue item. Main does not wait for it, and the run ends when the owner makes the proof or rules the row Owed. Until then the run is parked, as `delegate` defines it.

## evidence

The owner's rulings in their original words. The plan, the waves and the estimates as agreed, beside what each wave report measured. The cycle reports.

## produces

A progress report to the owner at each wake that finds something changed, in the root's own thread, short enough to read on a phone: waves closed out of waves planned, test rows and journey rows PROVEN out of each declared, hours and lines against the plan, the backlog's open count, what changed since the last report, and what waits in the owner queue. A count that should read 0 and does not is named first.

The wake is one T3 schedule bound to the root's own thread, so the owner sees one entry per run and stops a run's wakes by deleting it. The root arms it when the plan is agreed, with `schedule_task`, titled `<run> wake`, at an interval of 40 minutes, and writes its id to `wake.id` in the run directory. It deletes it with `delete_scheduled_task` when the run ends or parks, because a parked run wakes on the owner's message alone. The schedule's prompt is the whole checklist, so that no compaction can drop it:

- when a message from the owner or a partner arrived in the last 40 minutes and the newest cycle report is younger than that, reply in one line and stop;
- run `python .agents/skills/slot.mine/scripts/cycle.py <run-dir> --root <root thread> --branch <integration branch> --map <map>` and read the file it writes, and nothing else;
- send one line to each partner the report shows with work waiting and no turn running: the head to a partner behind it, the open backlog lines to an implementor, every driver line with no fix thread to the wave's implementor, the child past its box to the thread that launched it. A partner with a turn running is never pinged, because a message extends its run and no cache needs the ping;
- restart, with a line naming `tools/clean.py` or another route that needs no approval, any thread the report shows waiting on a request, because no agent can approve one and in fans one such wait held the integrator 67 minutes;
- relaunch from its charter, with its last-read SHA and the run directory, a partner whose last run failed;
- stop and plan again a slice the report shows at twice its lines or against its sign, launch the implementor of any wave whose blockers have merged, and in the tail ask the integrator for a candidate when the driver is free;
- read each wave report that is new, and write the next wave's estimates from its measured ratio and not from the tier file's;
- write the progress report.

## wakes on

An owner message. The run's wake. A partner's completion, which the harness delivers. A message from a partner only for an integrity hold, a wave closed, or a blocker no file can carry.

## handoff

The map with its waves and estimates, the rule set, the owner queue, the backlog, the partners and the SHA each last read, the newest cycle report, and the wake's id.

## outcome metric

Messages into the root per hour that the owner did not send, which should be near 0. Hours with no thread of the run running. Actual over estimate per wave, in hours and in lines. Minutes from a wave's blockers merging to its implementor launching. Owner messages that asked what the run was doing.

## retro label

`root`
