---
name: pe-tdd
description: Build Pe.Tools behavior with a red-green-refactor loop through the narrowest meaningful public seam. Use when the user asks for TDD, tests first, red green refactor, add behavior with tests, regression test, test seam, narrow public interface, or when a bug fix needs durable behavior proof.
metadata:
  goal: true
---

# pe-tdd

Use when adding or changing behavior with a useful test seam.

## Dispatch

- If the behavior and seam are clear, write or update the focused failing test first.
- If the seam is unclear, identify the externally visible behavior before editing production code.
- If proof requires live Revit/RRD state, coordinate through pe-live-loop before claiming green.
- If no meaningful test seam exists, say so and identify the missing seam.

## Loop

1. Define the externally visible behavior and the smallest vertical slice.
2. Pick the narrowest meaningful public seam. Prefer dependency-in/result-out interfaces.
3. Write or update a failing behavior test first when practical.
4. Run the focused test and confirm the failure is meaningful.
5. Implement the minimum production change.
6. Run the focused test to green.
7. Refactor only when it improves locality, depth, naming, duplication, or primitive obsession.
8. Run the nearest compile/typecheck and any affected smoke checks.

Mock only at system boundaries. Do not test implementation details when behavior can be tested through a stable interface.

## Durability Checkpoint

Capture only when the work establishes a reusable test-seam rule, proof pattern, or missing-seam finding. Otherwise say: No durable capture needed: <reason>.
