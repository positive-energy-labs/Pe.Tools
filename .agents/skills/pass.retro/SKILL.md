---
name: retro
description: Measure what a run of sessions cost and why, then hand each fix to its rung. Trigger on "retro", "retrospective", "after-action", "what did that session cost", "why was that thread so expensive", "what went wrong in those threads", "what did the good one do". Not a fault hunt in code; that is `diagnose`.
argument-hint: "Which threads, and what felt bad?"
stop: report on disk; every finding anchored, quantified, ranked by rung, and handed to `reflect`, `docs`, or the owner
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
- Rank by rung: a substrate or check fix beats a prose fix. A skill edit goes to `reflect`, a verdict to `docs`, a tool defect to its owner's ledger.
- Close with what the good run did that the others did not, as copy/don't-copy pairs.
- The report lives in the run directory. Nothing in the retro edits a skill; it ends with the owner's open questions.
