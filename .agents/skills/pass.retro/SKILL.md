---
name: retro
description: Measure what a run of sessions cost and why, then hand each fix to its rung. Trigger on "retro", "retrospective", "after-action", "analyze progress", "how did the run go", "how did the crusade go", "what did that session cost", "why was that thread so expensive", "what went wrong in those threads", "what did the good one do". Not a fault hunt in code; that is `diagnose`.
argument-hint: "Which threads, and what felt bad?"
stop: findings stated in chat, anchored, quantified, ranked by level, and handed to `reflect`, `docs`, or the owner; machine artifacts in the run directory
figure: After-action review — what was meant, what happened, why, what to keep; no blame, no grade
prevents: "the repeated cost: a costly session pattern paid again because nobody measured it"
---
# Retro

**Hold the after-action review.** Ask four questions in order: what was meant to happen, what happened, why it differed, and what to keep and change. You may not name a culprit or give a grade, even when one soldier, or the one who holds the review, plainly cost the day: the finding names the mechanism that let it happen, and its fix goes to whoever owns that mechanism.

## Laws

- Freeze the threads first: ids, window, the commit the run started from and its tip. When the owner names a run and no threads, find its root thread from the thread trailers on the run's commits, and add each partner thread that is not a child of that root.
- Report the code beside the sessions: lines added, deleted and moved, the health counts, and the cost of merge conflicts, from `mine`'s `pulse` verb over the run's base and tip. A deleted line is progress as much as an added one. Lines moved measure pace, and only a receipt measures completion.
- The owner names what felt bad, and the instruments say what it cost. A finding needs both. Treat a feeling with no measurement as a lead, and a measurement with no feeling as a gauge.
- Measure the sessions with `mine`'s retro verb and report what it prints. A run with child threads is measured as a tree and drawn as swimlanes, because the critical path lives in the waits between threads. Put the context curve with its compaction marks on a page.
- Compare against a good run, because a finding without a comparison only describes. When the owner names none, take the last finished run of the same shape, measure it with the same commands, and say that the choice was yours. `mine` says how to find a run's base, tip and threads. When no such run can be measured, say so and compare nothing.
- The findings are one table, a row each, with five columns: the mechanism, its cost in the measured unit, an anchor (thread id plus turn time or item id), its severity, and its level on `index`'s strength ladder. A finding with an empty cell is a lead and is listed apart.
- Rank findings by that level: a fix above the line beats a guard, and a guard beats prose. Send a skill edit to `reflect`, a verdict to `docs`, and a tool defect to its owner's ledger.
- Labels are inferred after the fact from the record. Never ask an agent to introspect about its own role changes.
- Close with what the good run did that the others did not, as copy and don't-copy pairs.
- State the answer in this order: the outcome in two sentences, the frozen scope, the timeline in phases, the pace and health of the code, where the hours and the cost went by role, the ranked findings, the answer to each question the owner asked, and the open questions. Every figure names the command it came from.
- State findings in chat, where every surface the owner uses renders them. Machine artifacts (counts, curves, raw extracts) live in the run directory. A durable verdict becomes one ledger line through `docs`, never a report file. Nothing in the retro edits a skill, and it ends with the owner's open questions.

## This repo [scope: repo]

- One run with a root thread is measured with `retro.py --tree`, with `--branch` and `--base`, and its code with `pulse.py`. Each reader writes to a new run directory of its own.
- For a project-wide retro over a window, run `mine`'s `corpus` verb, then label roles in a separate loop. Shard `<run-dir>/shards` into batches for cheap subagents briefed with `scripts/corpus/label_brief.md`, run `scripts/corpus/merge_labels.py` on their JSONL, run `corpus/render.py --run <run-dir> --roles roles.json`, and hand the owner the `retro.html` path with the findings in chat.
- `roles.json` labels for standing roles use the charter names in `.agents/roles/`: implementor, purger, driver, integrator, and archivist for runs that began before 2026-11-11. A child thread that fits no charter is counted under the thread that launched it.
- Group a retro's role findings by charter version, which is the commit the charter was at when the thread launched. Compare a role's outcome metric, as its charter defines it, across versions.
- Compare time to the first runnable behavior, the first useful feedback and accepted behavior at named SHAs, with regressions and scope additions recorded. Churn curves and commit-gap estimates describe pace, not percent complete or measured agent activity. An acknowledgment is not a work result; a milestone with no receipt remains unknown.
