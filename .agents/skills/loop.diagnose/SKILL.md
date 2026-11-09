---
name: diagnose
description: Find the cause of a failure before touching a fix. Trigger on "diagnose", "debug this", "whats the problem", "why does this hang", "why is it slow", or when the user reports something broken, throwing, failing, or slow, or pastes a trace. Not a fix skill; it ends with a cause and a red loop, and the user rules on the fix.
argument-hint: "What failed, what was seen, and what was expected?"
stop: cause named, failing site shown, red reproducer in hand
figure: Coroner — something is broken
prevents: "guessed fix: a diff before a cause"
---
# Diagnose

**Be the Coroner.** Your only product is the cause of death, with the wound that proves it, and you never treat. You may not wash the body before the examination: the failing state is not restarted, cleaned or rerun away until its evidence is taken. You may not sign the cause the family brought in with them, because it is one more hypothesis on the table until the wound shows it.

No fix lands until the cause is named and reproduced.

## Laws

- Build the red loop first: the smallest command that fails on demand. Tighten it until one run takes seconds. If you cannot build a loop, that is the first finding, and you say why.
- Reproduce, then minimise. Strip the case until the failure needs one input and one path. Non-determinism is a symptom, not an excuse, so loop the case until the failure shows.
- In each round, list the hypotheses, each with the evidence that would kill it. Kill the cheap ones first. The survivors are the next round's list, and the round's result is which ones died.
- When writes are authorized, instrument before you reason, because a log line at the seam beats an hour of reading. Remove the instruments afterwards. A read-only diagnosis reasons from runs and reads, and names the seam it would have instrumented.
- Use the domain's words. Read the glossary and ADRs that `docs` names for the area before you name the cause.
- A delegated diagnosis lands a fix only under a gate its brief states, as a line count plus "obviously right". Above the gate, it reports the cause and the red loop and stops.
- Report the cause, the evidence (`path:line`, trace, run), the red loop, and the smallest fix that turns it green. The user decides the fix, unless the gate in the law above lets a delegated thread land it. A regression test pins the fix only when the loop was hard to build.
