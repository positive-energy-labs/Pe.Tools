# ducts ledger

The `/ducts` route shows a Revit duct network and its metadata on a real project. It is read-only. It teaches the physics and prepares a pressure-loss judgment.

## Decided
- 2026-09-26, the unit of truth is the connector graph, not `MEPSystem`. On Chadds, 45 connected groups carry more than one system name and 31 mix supply, return and exhaust (census H).
- 2026-09-26, residential correctness has no single unit: room loads (Manual J), equipment capacity (Manual S), the critical path against available static pressure (Manual D), and the outlet (Manual T). Every check is a sum of demand from the terminals to the root, then a sum of loss from the root to the terminals.
- 2026-09-26, kaitpw: build `/ducts` as two work streams with two variants each, all on one shared backend. The verbs stay minimal: one op `ducts.snapshot` and one fetch verb `refresh`. Targeting a document or a group revalidates it with no press.
- 2026-09-26, the route uses the shared situation head and is a chat plugin, so counsel and Pea can drive it. The stability bar is `/rooms` and `/schedules`.
- 2026-09-26, the state model has one Reading `ducts` (the whole-document snapshot) and one Work segment `assumptions`: user answers per issue and per-type overrides, with no Revit writes. The readiness of a group (walkable, then budgetable) is derived in TS and never stored.
- 2026-09-26, kaitpw: at least one variant draws the network as SVG so health is visible on the geometry. Each segment is one path styled by one encoding function, so the same drawing later shows flow, velocity and pressure drop.
- 2026-09-26, kaitpw: views draw the selected group, and the rest of the document is faint context.
- 2026-09-26, kaitpw: one `ISSUE_KINDS` module owns every issue kind's label, one-sentence meaning, the readiness level it blocks (walkable, budgetable or none) and its color token. Every view, table and Chat use it, and one hue family maps to each blocked level.
- 2026-09-26, each layer names the one Revit query that produced it and shows its coverage and provenance (geometry, Revit-reported, designer-stated, derived, `revit-default`).
- 2026-09-26, `ducts.snapshot` has no scope argument. On Chadds it reads in 1.6 to 4.0 s and 7.79 MB, which is under the 5 s and 10 MB rule, so a group pick re-reads the whole document. The margin is thin; a scope argument is the one allowed growth.
- 2026-09-26, the segments and issues tables list the selected group only. Unscoped, about 6,500 rows froze `master-table`.
- 2026-09-26, counsel ruling, re-openable: `ignore` resolves an open end and the advisory kinds only. A loop, no-root or multi-root issue needs a structural answer and always blocks.

## Tried & rejected
- 2026-09-26, trusting Revit's calculated duct values: 0 of 4571 fittings on Chadds have a pressure drop, because the loss method is "ASHRAE Table" with no table chosen. Revit gives a critical path on 9 of 335 systems, with friction only. Use it as a test oracle, not as a result.

## Owed
- Promote the cited research (`.artifacts/research/mep-networks/A-D`, `H`) into `docs/features/ducts/RESEARCH.md` before the artifacts are swept.
- Pass-2 pressure-loss solver: Darcy-Weisbach on straight segments, a fitting C table keyed on PartType, angle, r/D and area ratio, and the Manual D budget.
- A root assumption (equipment pass-through, or naming the root port) for the 73 multi-root groups. The `assumptions` Work schema has no key for it yet.
- A route render test on the level of `rooms.test.tsx`, and the `r24` Pe.App net48 compile of `ducts-backend`.
- Stop session `ductsdev` (`pe-revit session stop --id ductsdev`) when the streams finish.
- kaitpw verdict: which of the four variants (S1 plan, S2 isometric, T1 schematic tree, T2 table ledger) survive as views.
