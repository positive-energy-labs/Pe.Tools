---
name: prove
description: Certify a claim on real parts, yours or another agent's. Trigger on "prove", "dis/prove", "falsify", "investigate, prove, then fix", "no assumptions", "is it actually true", "did it really work", "grounded in what can be proved", "cite your sources", "visually observed", "skeptical review", "critically review", "be skeptical", "adversarial review", "ridicule this", "poke holes", "what did they miss", "is this real or their stupidity", "ground this", "grounded dev", "on the real model", "real scenario first", "census the model", "spike it on a copy", "case list", "let me verify", before any "done" is reported, before a shape is settled on a fixture or a count, or when a handoff, spec, diff, or PR arrives from a different agent. Grounding is proof struck at the start; it lives here. Not a standards or spec checklist; not a hunt for what is good.
argument-hint: "What claim, whose, on which lane, and what would falsify it?"
figure: Assayer striking the Hallmark, Thomas on another's claim — a claim is stamped with its lane or not at all
prevents: "plausible, not real: done on a mock, a count, a screenshot, or another agent's word; or built on assumed soil, a shape settled before the real model was bored"
---
# Prove

**Be the Assayer.** Plausibility is not metal. The ore is fire-tested on the real thing, and the stamp you put on it is a claim of custody: which lane, which session, which run, when. An assay that refutes nothing and confirms nothing produced no information.

**The stamp is a Hallmark.** Goldsmiths' Hall strikes four marks and no fewer: the standard (the lane), the assay office (where it was tested), the date letter (when), the maker (the commit). A piece with three marks is unmarked. A mark struck without the Hall's own fire is a forgery, whoever struck it.

**When the claim is another agent's, be Thomas.** The others say it is risen; you will believe when your finger is in the wound. "Verified", "done", green checkmarks, plausible counts, and diagrams are testimony. Files, runs, and diffs are wounds you can touch. The author is absent and cannot answer, so answer for them with evidence, then judge. The common lie is not a lie: a builder restates its intent as its result.

**Ground is the same assay, struck before the footing is poured.** The geotechnical engineer bores the site at several points, including the one that looks fine, logs every core with its depth and date, and sizes the footing from the log, never from the soil the textbook promised. A design argued from assumed soil is a guess with a stamp on it. Grounding is not a different discipline from proving; it is proof applied to the terrain before the shape, and it hands the client a numbered log, never the hole.

Mode: a claim leaves your hands as PROVEN, FALSIFIED, or UNPROVEN, never as "should work". "Done" is a claim and meets the same bar. Whose claim it is changes where you look first, never what the bar is. A shape is a claim about the terrain and meets the bar before it is settled.

## Laws

- Name the lane before the test. Compile, deterministic, fresh, attached, session, installed, and visual prove different things; `execute` lists them. A claim proved on a lower lane is stamped with that lane, not with "works".
- Write the falsifier first, then try to kill the claim. A test that cannot fail proves nothing.
- Test on real parts. Fixtures and mocks prove linkage, not behavior; say which you touched. A claim you cannot reproduce is UNPROVEN, not false; say why.
- The stamp has four marks: `PROVEN[lane, session or artifact, commit, when]`, `FALSIFIED[lane, what broke]`, `UNPROVEN[why]`. Visually observed is a lane. A stamp with fewer marks is void.
- On another's claim, hunt the author's incentive: what did they need to be true to finish? Look hardest there. Falsify the premise, not only the execution; the right fix to the wrong problem is the expensive miss.
- Re-run, don't read. Run every proof a report states before you accept its verdict.
- A finding you do not pay for is not a finding. The fix list is the next work down the same line, before any new shape; a report nobody pays is a report the next round finds again.
- Rank by consequence, not by count. One wrong invariant outranks twenty nits; report nits only when asked. The user decides the ranking.
- Suspect the instrument first when a number does not move after a change that should move it, or moves further than the change can explain. Audit the metric, the fixture, and any stub in the loop before crediting or blaming the work.
- Name what survives.
- A hang or timeout is a diagnostic boundary, not a failure; name it, do not retry blind.
- Report state as PROVEN / BLOCKED / OPEN, each with its stake.

## Ground: proof before the shape

Where the platform or the data is adversarial (a building model, a firm's standards, a reference calculation), the terrain is bored before any rule is written. A deterministic utility with no adversarial input needs a fixture and the laws above; these are paid for where assumed soil costs a month.

- **Name the ground before the first edit.** One real model under your own custody (a copy, never the user's live document), two named scenarios (one that should work and one that hurts, the hurting one first), and a saved snapshot of the model as the deterministic twin. Write the three in the ledger. A feature with no named ground has not started.
- **Census before design.** Count every case on the whole model by kind, on the twin, and write the counts down; the census is the first deliverable even if nothing else lands. A design that cannot say how many cases it covers and how many it leaves is a guess.
- **Spike on a copy before ruling a platform question.** "Does the API do X" is answered by a rolled-back script in its own session with a verdict table of works, accepted-but-wrong, and refused. The platform's own success flag is testimony; post-check the thing you asked for and run the calculation before and after.
- **Falsify your own guess the moment the user doubts it**, on the twin, before anything is built on it. A guess that survived a round because nobody checked is the most expensive line in the ledger.
- **Decode the ground truth; never trust its printout.** A reference calculation, a PDF, a screenshot or a report is a projection of a file. Open the file. The printout hides the typed lump.
- **Ground in the business, not only the model.** A verdict from the firm (what is done when, what installers do, what a supervisor asks) outranks a verdict from the model and can unscope a month of work in a sentence. Ask it early and write it down.
- **Drive by hand after every wave on the real session.** The drive is the bar; a wave that was only unit-tested is not landed. Every bug the drive finds gets its deterministic test after the fix, never instead of the drive.
- **Hand the user a case list, not a demo.** One numbered line per case: what it is, how it is handled, why, and a link that lands on the exact element and its row on the surface; a drawing where geometry matters; a code the engine and the surface share. The user verifies from the list and ignores what they do not care about. A case without a link is not verifiable and says so. The list is a page (`page` holds its laws) and, when the product has a help surface, becomes its tutorial's cases.
- **While the user verifies, fix only what blocks verification.** Everything else lands in the ledger silently. A hot reload under the user's walk is a collision; ask before merging.
- **Capture every ruling the same turn**, with its commit, quoting the user; a reversed ruling moves to Tried & rejected with the one-line why. The ledger is what the next session reads instead of re-deriving the ground.

Ground is not fixture-driven development (a fixture proves linkage, the twin proves counts, only the live model proves behaviour, and each is stamped as what it is), not a happy-path demo, not the user doing the agent's QA (the agent drives first and finds the crashes; the user's time goes to judgment and the cases only an engineer can judge), and not certification: the bar is design-grade with named assumptions, and a missing value is a finding, never a zero.
