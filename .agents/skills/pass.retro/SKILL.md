---
name: retro
description: Measure what a run of sessions cost and why, then hand each fix to its rung. Trigger on "retro", "retrospective", "after-action", "what did that session cost", "why was that thread so expensive", "what went wrong in those threads", "what did the good one do". Not a fault hunt in code; that is `diagnose`.
argument-hint: "Which threads, and what felt bad?"
stop: findings stated in chat, anchored, quantified, ranked by level, and handed to `reflect`, `docs`, or the owner; machine artifacts in the run directory
figure: After-action review — what was meant, what happened, why, what to keep; no blame, no grade
prevents: "the repeated cost: a costly session pattern paid again because nobody measured it"
---
# Retro

**Hold the after-action review.** Ask four questions in order: what was meant to happen, what happened, why it differed, and what to keep and change. You may not assign blame or give a grade. A finding names a mechanism, never a culprit, and its fix goes to whoever owns that mechanism.

## Laws

- Freeze the threads first: ids, window, and which run is good and which bad, by the owner's word.
- The owner names what felt bad, and the instruments say what it cost. A finding needs both. Treat a feeling with no measurement as a lead, and a measurement with no feeling as a gauge.
- Measure with `mine`'s retro verb. Per thread, report hours, owner turns, API calls, compactions, max context, cost, tool calls, tool output by tool, and inflows over 20k characters. Put the context curve with its compaction marks on a page.
- Compare against a good run the owner named, because a finding without a comparison only describes.
- Each finding carries its mechanism, its cost in the measured unit, an anchor (thread id plus turn time or item id), its severity, and its level on `index`'s strength ladder.
- Rank findings by that level: a fix above the line beats a guard, and a guard beats prose. Send a skill edit to `reflect`, a verdict to `docs`, and a tool defect to its owner's ledger.
- Labels are inferred after the fact from the record. Never ask an agent to introspect about its own role changes.
- Close with what the good run did that the others did not, as copy and don't-copy pairs.
- State findings in chat, where every surface the owner uses renders them. Machine artifacts (counts, curves, raw extracts) live in the run directory. A durable verdict becomes one ledger line through `docs`, never a report file. Nothing in the retro edits a skill, and it ends with the owner's open questions.

## This repo [scope: repo]

- For a project-wide retro over a window, run `mine`'s `corpus` verb, then label roles in a separate loop. Shard `<run-dir>/shards` into batches for cheap subagents briefed with `corpus/label_brief.md`, run `corpus/merge_labels.py` on their JSONL, run `corpus/render.py --run <run-dir> --roles roles.json`, and hand the owner the `retro.html` path with the findings in chat.
- `roles.json` labels for standing roles use the charter names in `.agents/roles/`: implementor, purger, driver, archivist.
- Group a retro's role findings by charter version, which is the commit the charter was at when the thread ran. Compare a role's outcome metric, as its charter defines it, across versions.
