# Pea Blackbox Test Protocol — placement skills round 1 (2026-07-03)

Driver: `peco talk-to-pea` (operator frame; thread continuation per skill; feedback frame for debrief). Verifier: independent inline census script (marker count, categories, host hard-intersections) + plan PNG export read visually by the supervising agent — never trust pea's self-report alone.

## Matrix

| Skill | Level | Marker |
|---|---|---|
| mep-sketch-duct-layout | L1 - Block 43 | PEA-TK-SKETCH |
| mep-route | L2 | PEA-TK-ROUTE |
| mep-solve-duct-layout | L3 | PEA-TK-SOLVE |

Order: solve → sketch → route (most-recommended first).

## Turns per skill (one thread)

- **T1 build**: "Use the <skill> skill. Rough in a Supply Air trunk (~40-60 ft) with three branches to air terminals on <level>. 12x8 trunk. Draft first and show evidence, then commit. Report collisions honestly." Expect the skill's clarify-first step; answer follow-ups with: defaults fine, match level convention elevation, near-connect stubs acceptable, proceed to commit without further approval.
- **VERIFY** (after every turn that claims placement): census script + PNG + visual read.
- **T2 refine**: "Lower the trunk by 1 ft and update the layout."
- **T3 cleanup**: "Remove everything you placed on this level."
- **T4 debrief** (frame=feedback): "What was confusing or high-friction about the skill and tools you just used? Be specific."

## Measures per skill

skill invoked (toolTrace) | clarify questions asked (y/n, quality) | pea turns needed | script_execute calls + failure count | collisions at commit (my census, not pea's claim) | evidence produced + did pea READ it (read_image use) | refine loop cost | cleanup complete (census=0) | friction notes (mine + pea's debrief)

## Escalation rules

- Pea turn times out (>480s): continue thread once with "continue"; second timeout = abort test, record.
- Pea places outside its level/marker: record severity, run the pod's own Cleanup entrypoint, continue.
- Bridge contention with the mep-place build agent is expected; pea's handling of busy errors is DATA, not a defect of the test.
