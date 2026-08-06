# Single-regularizer results

Date: 2026-08-06

Proof lanes: `Source compile` (`NoRrdContact`) and offline snapshot replay in
`FreshRevitProcess`.

## Outcome

**STOPPED: the binding straightness gate failed.**

`BoundarySnap` is deleted and `SpaceBoundaryNetwork` now runs once over the full ranked room set
at detector emit. A failed room keeps its raw polygon and gains `unregularized`; unsupported ruled
seams add `ruled-seam`. Materialization only welds/emits those detector-owned polygons.

The invariants forced almost every real room back to raw geometry: only **9/285 project-a rooms** and
**1/20 project-b rooms** regularized. project-a' weighted mean outer-ring vertex count changed from
**292.5 to 293.2** (a 0.2% increase), missing the required >=50% reduction. Per the mission's stop
rule, no generated TSV was promoted into the committed fixture directories. The complete replay
candidate and logs remain under `.artifacts/tmp/single-regularizer-replay/`.

## Gate summary

| Gate | Before | Candidate | Result |
| --- | ---: | ---: | --- |
| project-a rooms | 69 / 4 / 82 / 79 / 51 | 69 / 4 / 82 / 79 / 51 | PASS |
| project-b rooms | 20 / 0 | 20 / 0 | PASS |
| project-a total score | 54.1 | 54.1 | PASS |
| project-b total score | 23.3 | 23.3 | PASS |
| project-a `missing` | 0 | 0 | PASS |
| project-b `missing` | 8 | 8 | PASS |
| project-a precision junk | 185 | 184 | PASS |
| project-b precision junk | 9 | 9 | PASS |
| project-a wall recall @1.5 ft | 53.7% | 54.1% | PASS |
| project-a weighted mean vertices | 292.5 | 293.2 | **FAIL** (required <=146.3) |
| Net LOC, `source/Pe.Revit.Takeoff` | — | -910 | PASS (required <=-700) |

project-a taxonomy stayed byte-for-byte equivalent as counts: `ok:27`, `shape-poor:33`,
`fragmented:35`, `merged:23`, `missing:0`. project-b kept `missing:8`; one former `merged` room became
`shape-poor`, with no score change. Candidate regularized-room area drift stayed inside
`max(0.5 sf, 1%)` by construction; the largest accepted absolute drift was **4.181569 sf** on Lower
Level and the largest accepted fractional drift was **1.314924%** on a room where the 0.5 sf floor
governed. The replay log prints each level's accepted maximum.

## Fallback census

| Level | Rooms | Regularized | Raw + flagged | Area guard | Dirty path | Loop trace | Topology | Label |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 69 | 4 | 65 | 38 | 17 | 5 | 5 | 0 |
| Level 0/Theatre | 4 | 0 | 4 | 1 | 1 | 2 | 0 | 0 |
| Level 1/Main Level | 82 | 3 | 79 | 28 | 42 | 8 | 1 | 0 |
| Level 2/Upper Level | 79 | 1 | 78 | 38 | 33 | 5 | 2 | 0 |
| Level 3/Attic | 51 | 1 | 50 | 14 | 33 | 1 | 2 | 0 |
| **project-a total** | **285** | **9** | **276** | **119** | **126** | **21** | **10** | **0** |
| project-b MAIN LEVEL | 20 | 1 | 19 | 8 | 8 | 1 | 1 | 1 |
| project-b ROOF PLAN | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

`dirty-path` means the existing network could not rule or preserve at least one owned path.
`loop-trace` means emitted path curves did not form degree-two room loops. `topology` covers
self-intersection or intersecting loops. These are network failures; the room remains present with
its original polygon.

## Straightness and fixture diff scope

| Level | Regularized / raw | Mean vertices before -> after | Median before -> after | Rooms <=12 before -> after | Unregularized before -> after | Max accepted drift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 4 / 65 | 348.9 -> 341.8 | 307 -> 304 | 0.0% -> 4.3% | 0.0% -> 94.2% | 4.181569 sf |
| Level 0/Theatre | 0 / 4 | 158.5 -> 158.5 | 98 -> 98 | 0.0% -> 0.0% | 0.0% -> 100.0% | 0 sf |
| Level 1/Main Level | 3 / 79 | 302.4 -> 300.9 | 186 -> 202 | 0.0% -> 3.7% | 0.0% -> 96.3% | 0.441321 sf |
| Level 2/Upper Level | 1 / 78 | 265.8 -> 271.5 | 205 -> 220 | 0.0% -> 0.0% | 0.0% -> 98.7% | 0.846117 sf |
| Level 3/Attic | 1 / 50 | 252.2 -> 259.1 | 206 -> 210 | 2.0% -> 3.9% | 0.0% -> 98.0% | 0.355816 sf |
| project-b MAIN LEVEL | 1 / 19 | 88.0 -> 85.7 | 71 -> 64 | 0.0% -> 5.0% | 0.0% -> 95.0% | 2.525728 sf |

The candidate fixture diff would change every populated TSV because fallback/ruled-seam flags are
new; geometry changes are limited to the regularized counts above. Those candidates were generated
for measurement only and deliberately not copied into `eval/rhvac/*/takeoff` after the gate failed.

## Verification

- `Source compile`: `Pe.Revit.Tests.csproj` passed; this includes
  `TakeoffSpaceMaterializationTests` compilation.
- `FreshRevitProcess`: `TakeoffReplayTests` passed 15/15, including explicit raw-room preservation,
  `unregularized`, `ruled-seam`, and area-guard-revert checks.
- Combined `TakeoffReplayTests`, `RhvacCandidateBuilderTests`, and `RhvacEvalTests`: passed 34/34
  in `FreshRevitProcess` (0 failed, 0 skipped).
- Live Space materialization parity: **PENDING**; the user-owned RRD was not contacted.
