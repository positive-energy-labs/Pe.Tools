---
name: retro
description: Measure what a run of sessions cost and why, then hand each fix to its rung. Trigger on "retro", "retrospective", "after-action", "what did that session cost", "why was that thread so expensive", "what went wrong in those threads", "what did the good one do". Not a fault hunt in code; that is `diagnose`.
argument-hint: "Which threads, and what felt bad?"
stop: findings stated in chat, anchored, quantified, ranked by rung, and handed to `reflect`, `docs`, or the owner; machine artifacts in the run directory
figure: After-action review — what was meant, what happened, why, what to keep; no blame, no grade
prevents: "the repeated wound: a costly session pattern paid again because nobody measured it"
---
# Retro

**Hold the after-action review.** Four questions, in order: what was meant to happen, what happened, why it differed, what to keep and what to change. The facilitator assigns no blame and gives no grade. A finding names a mechanism, never a culprit, and the fix goes to whoever owns that mechanism.

**Measure before you feel.** The owner names what felt bad; the instruments say what it cost. A feeling with no number is a lead, a number with no feeling is a gauge, and a finding needs both.

## Laws

- Freeze the threads first: ids, window, which is the good one and which the bad, by the owner's word.
- Measure with `mine`'s retro verb. Per thread: hours, owner turns, API calls, compactions, max context, cost, tool calls, tool output by tool, and the inflows over 20k characters. The context curve with its compaction marks goes on a page.
- Compare against a good run the owner named. A finding without a comparison is a description.
- Each finding carries its mechanism, its cost in the measured unit, an anchor (thread id plus turn time or item id), its severity, and its rung from `index`.
- Rank by rung on `index`'s strength ladder: a fix above the line beats a guard, and a guard beats prose. A skill edit goes to `reflect`, a verdict to `docs`, a tool defect to its owner's ledger.
- For a project-wide retro over a window, run `mine`'s `corpus` verb, then label roles in a separate loop: shard `<run-dir>/shards` into batches for cheap subagents briefed with `corpus/label_brief.md`, run `corpus/merge_labels.py` on their JSONL, run `corpus/render.py --run <run-dir> --roles roles.json`, and hand the owner the `retro.html` path with the findings in chat. Role labels are inferred after the fact by this loop from the record; agents are never asked to introspect about their own role changes.
- Close with what the good run did that the others did not, as copy/don't-copy pairs.
- State findings in chat, where every surface the owner uses renders them. Machine artifacts (counts, curves, raw extracts) live in the run directory. A durable verdict becomes one ledger line through `docs`, never a report file. Nothing in the retro edits a skill; it ends with the owner's open questions.
