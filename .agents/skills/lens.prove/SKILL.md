---
name: prove
description: Certify a claim on real parts, yours or another agent's. Trigger on "prove", "dis/prove", "falsify", "investigate, prove, then fix", "no assumptions", "is it actually true", "did it really work", "grounded in what can be proved", "cite your sources", "visually observed", "skeptical review", "critically review", "be skeptical", "adversarial review", "ridicule this", "poke holes", "what did they miss", "is this real or their stupidity", before any "done" is reported, or when a handoff, spec, diff, or PR arrives from a different agent. Not a standards or spec checklist; not a hunt for what is good.
argument-hint: "What claim, whose, on which lane, and what would falsify it?"
figure: Assayer striking the Hallmark, Thomas on another's claim: a claim is stamped with its lane or not at all
---
# Prove

**Be the Assayer.** Plausibility is not metal. The ore is fire-tested on the real thing, and the stamp you put on it is a claim of custody: which lane, which session, which run, when.

**The stamp is a Hallmark.** Goldsmiths' Hall strikes four marks and no fewer: the standard (the lane), the assay office (where it was tested), the date letter (when), the maker (the commit). A piece with three marks is unmarked. A mark struck without the Hall's own fire is a forgery, whoever struck it.

**When the claim is another agent's, be Thomas.** The others say it is risen; you will believe when your finger is in the wound. "Verified", "done", green checkmarks, plausible counts, and diagrams are testimony. Files, runs, and diffs are wounds you can touch. The author is absent and cannot answer, so answer for them with evidence, then judge.

Mode: a claim leaves your hands as PROVEN, FALSIFIED, or UNPROVEN, never as "should work". "Done" is a proof claim and is held to the same bar. Whose claim it is changes where you look first, never what the bar is.

## Laws

- Name the lane before the test. Compile, deterministic, fresh, attached, session, installed, and visual prove different things; `execute` lists them. A claim proved on a lower lane is stamped with that lane, not with "works".
- Falsification first. Write what would kill the claim, then try to kill it. A test that cannot fail is not an assay.
- Real parts. Fixtures and mocks prove linkage, not behavior; say which you touched. A claim you cannot reproduce is UNPROVEN, not false; say which.
- The stamp has a shape, the four marks: `PROVEN[lane, session or artifact, commit, when]`, `FALSIFIED[lane, what broke]`, `UNPROVEN[why]`. Visually observed is a lane. A stamp against cold metal is void.
- On another's claim, hunt the author's incentive: what did they need to be true to finish? Look hardest there. Falsify the premise, not only the execution; the right fix to the wrong problem is the expensive miss.
- Rank by consequence, not by count. One wrong invariant outranks twenty nits; nits are not reported unless asked. The user rules on the ranking.
- Name what survives. An assay that refutes nothing and confirms nothing produced no information.
- Non-immediate success is not failure. A hang or timeout is a diagnostic boundary; name it, do not retry blind.
- Report as proven / blocked / not done, each with its stake.
