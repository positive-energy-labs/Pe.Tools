---
name: pe-tests
description: Shape Pe.Tools tests as sparse, high-signal product behavior proof; use when the user says tests, test suite, regression safety, product behavior, e2e-like, red green refactor, TDD, test first, add a regression test, prove this behavior, remove bad tests, prune tests, clean tests, cleanroom tests, flaky tests, brittle tests, over-tested, or when core logic is unstable and needs durable proof. Includes three modes 1) product behavior-regression test strategy, 2) iterative red/green TDD for new or uncertain work, and 3) test purging/cleanrooming.
metadata:
  goal: true
---

# pe-tests

Use when the user wants regression safety, behavior proof, red/green implementation, or test cleanup.

Testing posture for Pe.Tools: tests are trust primitives, not coverage inventory. Prefer a few broad tests that make the relevant world smaller and more reliable for future agents. The durable suite should assert product behavior expectations at the highest stable seam available, with the smallest number of tests that catch meaningful regressions.

Broad unit coverage is allowed as temporary scaffolding during uncertain implementation, but it should be pruned once the behavior stabilizes. Small unit-like tests are admissible only when that seam is itself the product contract, such as a kernel state machine, event projection reducer, parser, host contract wrapper, thread lock rule, or deterministic failure boundary.

## Dispatch

- If the user asks where/what to test, wants a suite plan, says regression safety, core behavior, e2e-like, product behavior, or "I hate tests", use **Mode 1: Behavior Regression Strategy**.
- If the user asks for tests first, TDD, red green refactor, prove a new behavior, or is implementing novel/uncertain behavior, use **Mode 2: Red/Green Implementation**.
- If the user asks to remove, prune, clean, cleanroom, simplify, deflake, or reduce tests, use **Mode 3: Test Purge And Cleanroom**.
- If an active bug or failure is not understood yet, use pe-diagnose first; return here after the externally visible failure and proof seam are known.
- If proof depends on Rider, RRD, hot reload, active Revit state, installed-lane behavior, auth/login, or visual confirmation, coordinate through pe-live-loop before claiming product proof.
- If no meaningful test seam exists, say so and identify the missing seam instead of adding low-signal tests.

## Context Resolution

1. Read the nearest AGENTS.md and any feature \_GOALS.md/\_DEV.md before choosing a proof lane.
2. Identify the user-visible behavior, runtime boundary, or product contract being protected.
3. Inspect current tests and recent failures before adding or deleting anything.
4. Prefer public seams: CLI/product surface, host operation contract, runtime/controller API, generated contract wrapper, reducer/projection boundary, or deterministic parser/helper.
5. Mock only true system boundaries: model providers, Revit/Host processes, local protocol transports, filesystem/process ownership, external services, and clocks when time is the behavior.

## Mode 1: Behavior Regression Strategy

Use this mode to decide where tests belong and what the smallest durable suite should assert.

1. Name the behavior spine in product terms: what a user, operator, protocol client, or agent surface must be able to rely on.
2. Pick the highest stable seam that observes the behavior without forcing fragile setup.
3. Prefer one broad test over many layer tests when it can fail with useful signal.
4. Add lower-level tests only for small deterministic contracts that would be hard to observe through the product seam.
5. Explicitly reject tests that only assert implementation shape, duplicate another seam, freeze churn, or require brittle fixture maintenance.
6. Define the stop condition: the few behaviors that must be protected, the proof command, and what remains intentionally untested.

Good durable tests usually assert:

- identity and ownership: session/thread/resource ids, locks, active state, close/cancel/abort/takeover boundaries;
- product policy: Pea/Host/surface differences that should not drift.
- Revit API behavior: view/document/family resolve/open/close, element/schedule/etc. create/update/delete, undo/redo/transaction behavior, parameter metadata resolution on a variety of elements in different contexts.
- end to end user-facing product behavior

Bad durable tests usually assert:

- exact intermediate objects when the public behavior is enough;
- every adapter branch after one shared contract test exists;
- mocks of internal collaborators that make refactoring harder than regressions.

## Mode 2: Red/Green Implementation

Use this mode for new, uncertain, or regression-prone behavior where a tight feedback loop will improve design.

1. Define the externally visible behavior and the smallest vertical slice.
2. Pick the narrowest meaningful public seam. Prefer dependency-in/result-out interfaces.
3. Write or update the failing test first when practical.
4. Run the focused test and confirm the failure is meaningful.
5. Implement the minimum production change.
6. Run the focused test to green.
7. Refactor only when it improves locality, depth, naming, duplication, primitive choice, or public interface clarity.
8. Run the nearest compile/typecheck and affected smoke checks.
9. Decide whether the test is durable or temporary scaffolding. Mark or remove temporary tests before broadening the suite.

Temporary red/green tests are allowed to be more granular than the final suite. Do not let them become permanent by accident.

## Mode 3: Test Purge And Cleanroom

Use this mode when tests have become noisy, brittle, redundant, too granular, slow, fixture-heavy, or misleading.

1. Inventory the behavior each test claims to protect. If the behavior is unclear, treat the test as suspect.
2. Group tests by protected product contract, not by file.
3. Keep the highest-signal test for each contract; remove or merge duplicate lower-value assertions.
4. Delete tests that only pin private structure, copy implementation details, or block intended refactors.
5. Replace brittle fixtures with smaller product-shaped fixtures, builders, or public-seam harnesses only when that reduces long-term cost.
6. Preserve or add a cleanroom test only when deletion would leave a real regression class uncovered.
7. After pruning, run the smallest affected proof and one broader suite command when practical.

Cleanrooming means rebuilding the test shape from the intended behavior, not mechanically rewriting old assertions. Start from "what must not regress?" and only then decide which old tests deserve to survive.

## Durability Checkpoint

Before finishing, decide whether the work established reusable testing truth.

Capture when the session resolves a test philosophy rule, proof-lane rule, public seam rule, repeated missing-seam finding, or durable behavior spine.

If no doc update is needed, say: No durable capture needed: <reason>.
