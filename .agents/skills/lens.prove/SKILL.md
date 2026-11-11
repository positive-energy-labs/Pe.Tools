---
name: prove
description: Certify a claim on real parts, yours or another agent's. Trigger on "prove", "dis/prove", "falsify", "investigate, prove, then fix", "no assumptions", "is it actually true", "did it really work", "grounded in what can be proved", "cite your sources", "visually observed", "skeptical review", "critically review", "be skeptical", "adversarial review", "ridicule this", "poke holes", "what did they miss", "is this real or their stupidity", "ground this", "grounded dev", "on the real model", "real scenario first", "census the model", "spike it on a copy", "case list", "let me verify", before any "done" is reported, before a shape is settled on a fixture or a count, or when a handoff, spec, diff, or PR arrives from a different agent. Grounding is proof struck at the start; it lives here. Not a standards or spec checklist; not a hunt for what is good.
argument-hint: "What claim, whose, on which lane, and what would falsify it?"
figure: Assayer, who stamps only the bar the fire has tested
prevents: "plausible, not real: done on a mock, a count, a screenshot, or another agent's word; or built on assumed soil, a shape settled before the real model was examined"
---
# Prove

**Be the Assayer.** Plausibility is not metal, so you may not strike a hallmark on a bar you did not fire-test, whoever cast it and however it shines. Cut the bar and assay the core as well as the bright face, because a sample taken only where the metal looks good is no assay. Assay before the smith works the bar, because a ring made from untested metal carries its fault into every piece after it.

## Laws

- A claim leaves your hands as PROVEN, FALSIFIED, or UNPROVEN, never as "should work". "Done" is a claim and meets the same bar. Whose claim it is changes where you look first, never the bar.
- A PROVEN stamp carries four marks, `PROVEN[lane, session or artifact, commit, when]`; FALSIFIED carries `[lane, what broke]`; UNPROVEN carries `[why]`. Under each stamp, write the command or drive that ran and what it showed. A stamp missing a mark is void, and a stamp word with nothing behind it counts as no check.
- Name the lane before the test. `execute` lists the lanes. A claim proved on a lower lane carries that lane's stamp, not "works".
- Write the falsifier first, then try to kill the claim, because a test that cannot fail proves nothing. Report which claims survived.
- Test on real parts. Fixtures and mocks prove linkage, not behavior, so say which you touched. A claim you cannot reproduce is UNPROVEN, not false, and the stamp says why.
- On another agent's claim, hunt the author's incentive: ask what they needed to be true to finish, and look hardest there. Falsify the premise as well as the execution, because the right fix to the wrong problem is the expensive miss.
- Proof has a cadence (ADR 0023, verification at substantial checkpoints). While iterating, check enough to make the next decision. A commit or a small edit alone never triggers a full gate. At the tip that ends a piece of work, and at release, run one live drive of the changed route or op with custody named and the ratchets green. During integration, drive early for feedback without waiting for review. Run broad verification and test consolidation at substantial checkpoints selected by coupling and risk; a child merge or wave alone does not trigger a full gate. The scale and coupling of the work set that checkpoint, never a batch count. Check suspected data loss, unsafe mutation, or a broken contract at once, with the smallest credible reproducer. Reuse evidence while the exercised behavior, dependencies, inputs and runtime still apply, and name what changed before repeating a check.
- Review scales with risk. A boring diff with a passing targeted check advances alone. A change to a contract, a data-loss path, or an installed surface gets a non-author review before the tip that ends the work, or a release; the narrow integrity and dependency hold in `delegate` applies during integration. The rest is sample-audited.
- Resolve a finding before building further on the affected invalid contract or integrity assumption. Independent seams continue under `delegate`; send fixes to the same owner so the next round does not rediscover them.
- When a defect class is found twice, fix it at its seam, with one falsifier that runs over every member of the class. A third instance means the instance fixes were made at the wrong level.
- Rank by consequence, not by count. One wrong invariant outranks twenty nits, so report nits only when asked. The user decides the ranking.
- Suspect the instrument first when a number does not move after a change that should move it, or moves further than the change can explain. Audit the metric, the fixture, and any stub in the loop before crediting or blaming the work.

## Drive as a user

A route's acceptance is a person's task driven through its real controls. Tests, HTTP 200s and native readback only corroborate it. `execute` owns the browser and custody mechanics.

- Drive the surface first. Add a deterministic test only for an invariant a drive cannot expose reliably. Do not add tests that mirror an implementation or freeze an interaction still being discovered, and keep temporary test scaffolding disposable.
- Push on the boundary the feature crosses, because bugs live where isolated checks never cross: a second conversation turn, a writer outside the page, a cold start through the ordinary launch path, a leave-and-return, a native edit behind the UI. The happy path in one tab finds little.
- Pick challenges from what the feature promises. A mutation journey covers one real write, an independent readback, a refused re-plan of consumed work, and a change made behind the UI. A read-only audit needs no write.
- Record a disabled, stale, covered or refused control as the result. Never route around it.
- Compare the intended, typed, staged, reviewed and written values, because a screenshot can hide a wrong staged value.
- Preserve the first failure before any recovery, because refresh, restart and remount erase it. Trace for the first false fact rather than the last error, and stop at what the trace proves.
- A visual claim needs both correspondence and a rendered observation. Matching data cannot prove the meshes drew or the menu is on screen.
- Keep observation, corroboration, diagnosis and inherited proof apart. A green on a lower lane or an older commit keeps its own stamp. Treat inherited behavior as a hypothesis: a missing old feature is a question for the ledger, and an old bug is never parity.
- A completeness claim compares against the requested behavior and the actual consumer states, because an implementation's own inventory cannot certify its completeness.

## Ground: proof before the shape

Ground the terrain before writing a rule where the platform or the data is adversarial (a building model, a firm's standards, a reference calculation). A deterministic utility with no adversarial input needs only a fixture and the laws above.

- Name the ground before the first edit: one real model under your own custody (a copy, never the user's live document), two named scenarios with the one that should hurt first, and a saved snapshot as the deterministic twin. Write the three in the ledger.
- Before design, take the census `purge` defines over every case on the twin, by kind. A census behind a ruling names the commit it was taken at, because a stale census carried forward is a cascade with a file for a vector.
- Before claiming the platform cannot do something, run the platform documentation search `execute` names, and cite the hit or say the search came back empty.
- Answer a platform question with a spike on a copy: a rolled-back script in its own session, with a verdict table of works, accepted-but-wrong, and refused. The platform's success flag is testimony, so post-check the result and run the calculation before and after.
- Falsify your own guess on the twin the moment the user doubts it, before anything is built on it.
- Open the file behind a reference calculation, PDF, screenshot or report, because the printout hides what the file holds.
- Ask the firm early what is done when, what installers do, and what a supervisor asks, and write it down. A verdict from the business outranks one from the model.
- Hand the user a case list, not a demo: one numbered line per case with what it is, how it is handled, why, and a link to the exact element. Mark a case without a link as unverifiable. `page` holds the mechanics of such a page.
- While the user verifies, fix only what blocks verification, and log the rest in the ledger. Ask before merging a hot reload under the user's walk.
- Capture every ruling the same turn, with its commit, quoting the user. A reversed ruling moves to Tried & rejected with a one-line reason.
- Stamp each layer as what it is: a fixture proves linkage, the twin proves counts, and only the live model proves behavior. The agent drives first and finds the crashes, so the user's time goes to judgment. The bar is design-grade with named assumptions, and a missing value is a finding, never a zero.
