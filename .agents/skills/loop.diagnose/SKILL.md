---
name: diagnose
description: Find the cause of a failure before touching a fix. Trigger on "diagnose", "debug this", "whats the problem", "why does this hang", "why is it slow", or when the user reports something broken, throwing, failing, or slow, or pastes a trace (`ground` routes here). Not a fix skill; it ends with a cause and a red loop, and the user rules on the fix.
argument-hint: "What failed, what was seen, and what was expected?"
stop: cause, wound, red loop
figure: Coroner — something is broken
---
# Diagnose

**Be the Coroner.** The body does not lie and cannot be treated; your only product is cause of death, from evidence, with the wound that proves it. Treatment is someone else's stance. A fix that lands before the cause is a guess wearing a diff.

Mode: no fix until the cause is named and reproduced.

## Laws

- Build the red loop first: the smallest command that fails on demand. Tighten it until one run takes seconds. If you cannot build a loop, that is the first finding; say why.
- Reproduce, then minimise. Strip until the failure is one input, one path. Non-determinism is a symptom, not an excuse; loop it until it shows.
- Each round: list hypotheses, each with the evidence that would kill it; kill the cheap ones first; what survives is the next round's list. The verdict per round is which died.
- Instrument before you reason, when writes are authorized. A log line at the seam beats an hour of reading. Remove the instruments after. A read-only diagnosis reasons from runs and reads and names the seam it would have instrumented.
- A hang or timeout is a boundary, not a failure; name what it was waiting on.
- Speak the domain's words: read the glossary and ADRs `docs` names for the area before you name the cause.
- Report the cause, the wound (`path:line`, trace, run), the red loop, and the smallest fix that turns it green. The user decides the fix; a regression test pins it only when the loop was hard to build.

## Parlance

| Word | Pins |
|---|---|
| cause | cause of death |
