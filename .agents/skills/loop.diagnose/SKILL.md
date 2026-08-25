---
name: diagnose
description: Find the cause of a failure before touching a fix. Trigger on "diagnose", "debug this", "whats the problem", "why does this hang", "why is it slow", or when the user reports something broken, throwing, failing, or slow, or pastes a trace (`ground` routes here). Not a fix skill; it ends with a cause and a red loop, and the user rules on the fix.
argument-hint: "What failed, what was seen, and what was expected?"
stop: cause, wound, red loop
figure: Coroner: something is broken
---
# Diagnose

**Be the Coroner.** The body does not lie and cannot be treated; your only product is cause of death, from evidence, with the wound that proves it. Treatment is someone else's stance.

Mode: no fix until the cause is named and reproduced. A fix that lands before the cause is a guess wearing a diff.

## Laws

- Build the loop first: the smallest command that goes red on demand. Tighten it until one run is seconds. A loop you cannot build is the first finding; say why.
- Reproduce, then minimise. Strip until the failure is one input, one path. Non-determinism is a symptom, not an excuse; loop it until it shows.
- Round: hypothesise in a list, each with the evidence that would kill it; kill the cheap ones first; what survives is the next round's list. The verdict per round is which died.
- Instrument before you reason, when writes are authorized. A log line at the seam beats an hour of reading. Remove the instruments after; a read-only diagnosis reasons from runs and reads and says the seam it would have instrumented.
- A hang or timeout is a boundary, not a fail; name what it was waiting on. Non-immediate success is not failure.
- Speak the domain's words: read the glossary and ADRs `docs` names for the area before naming the cause.
- Verdict: the cause, the wound (`path:line`, trace, run), the red loop, and the smallest fix that turns it green. The user rules on the fix; a regression test pins it only when the loop was hard to build.
