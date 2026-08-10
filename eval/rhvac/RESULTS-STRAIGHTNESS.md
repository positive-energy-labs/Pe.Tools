# Straightness remedy results

Date: 2026-08-06

Proof lanes: `Source compile` (`NoRrdContact`), offline snapshot replay in
`FreshRevitProcess`, and the Python takeoff scoreboard for project-a and projectB.

## Outcome

**STOPPED: the binding straightness targets remain unreachable with the safe remedies.**

project-a improves from **9/285 to 67/285 regularized rooms** (23.5%), but the target is
at least 171/285 (60%). Its room-count-weighted mean outer-ring vertex count falls from
**293.2 to 231.8**, a **20.9% reduction** rather than the required 50%.

The retained mechanisms are small and evidence-backed:

- `TakeoffOptions.RegularizeAreaTolerancePct` defaults to 3.0. The area guard remains
  `max(0.5 sf, pct)` and rooms outside it keep their raw polygons plus `unregularized`.
- Closed free paths are already complete rectilinear loops, usually tiny holes whose edges are
  too short to vote for a consensus wall line. They now remain exact instead of making the whole
  room dirty.
- `RawSqft` remains the detector's exact cell-count conservation truth. Regularized polygon area
  is checked against it but does not overwrite it.

No project-specific threshold was added. The tested two-cell endpoint-chord fallback changed no
project-a room and was deleted. Separating closed and open path tracing regressed project-a to 45 rooms
and was also deleted.

## Tolerance evidence

`eval/rhvac/project-a/tolerances.json` defines these `roomAreaPct` gates:

| Profile | `roomAreaPct` |
| --- | ---: |
| bootstrap | 10% |
| standard | 5% |
| stamp | 3% |

The eval uses `bootstrap`, so the downstream room-area gate is 10%; the 3% regularizer cap leaves
3.33x downstream headroom. The stricter profiles are recorded here for completeness and were not
used to justify loosening beyond 3%.

## Mechanism 1 alone

Changing only the area tolerance from 1% to 3% raises project-a from 9 to **45 regularized rooms**.
Area-guard fallbacks fall from 119 to 83; every other fallback bucket remains unchanged.

| Level | Regularized | Area guard | Dirty path | Loop trace | Topology |
| --- | ---: | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 19 | 23 | 17 | 5 | 5 |
| Level 0/Theatre | 0 | 1 | 1 | 2 | 0 |
| Level 1/Main Level | 11 | 20 | 42 | 8 | 1 |
| Level 2/Upper Level | 10 | 29 | 33 | 5 | 2 |
| Level 3/Attic | 5 | 10 | 33 | 1 | 2 |
| **project-a total** | **45** | **83** | **126** | **21** | **10** |

## Dirty-path cause census and remedy

Instrumentation reports each dirty path's owners, raw-point count, fitted-segment count, and one
or more causes. Before the remedy, project-a has:

| Cause | Dirty paths |
| --- | ---: |
| closed free path | 522 |
| free-run deviation beyond connector allowance | 17 |
| supported off-axis run too short to establish a chain | 12 |
| unsupported off-axis run | 2 |

Cause counts are per path and can overlap; they are not room counts. The dominant 522 paths are
complete closed rectilinear loops, so preserving them is a mechanism rather than a relaxed
constant. It reduces dirty-path room fallbacks from **126 to 20**. The final remaining dirty-path
causes are the 17 free-run deviations, 12 short supported off-axis runs, and 2 unsupported runs.

## Final fallback census and honest ceiling

| Level | Rooms | Regularized | Raw + flagged | Area guard | Dirty path | Label | Loop trace | Topology |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 69 | 24 | 45 | 25 | 3 | 0 | 9 | 8 |
| Level 0/Theatre | 4 | 1 | 3 | 1 | 0 | 0 | 2 | 0 |
| Level 1/Main Level | 82 | 17 | 65 | 25 | 8 | 0 | 26 | 6 |
| Level 2/Upper Level | 79 | 13 | 66 | 42 | 3 | 0 | 17 | 4 |
| Level 3/Attic | 51 | 12 | 39 | 18 | 6 | 0 | 9 | 6 |
| **project-a total** | **285** | **67** | **218** | **111** | **20** | **0** | **63** | **24** |
| project-b MAIN LEVEL | 20 | 2 | 18 | 9 | 5 | 1 | 1 | 2 |

The dirty bucket is no longer the ceiling. The blockers are **111 area guards** and **87
loop/topology failures**. Rejected area deltas are not near misses: median is 6.504%, p95 is
18.925%, and max is 37.294%. Raising the cap enough to absorb them would violate the requested
3% honesty contract. Most loop failures contain degree-4 or higher touching junctions; pairing
them geometrically without room-boundary identity can silently change topology.

## Gates

| Gate | Committed | Candidate | Result |
| --- | ---: | ---: | --- |
| project-a rooms by level | 69 / 4 / 82 / 79 / 51 | 69 / 4 / 82 / 79 / 51 | PASS |
| project-b rooms by level | 20 / 0 | 20 / 0 | PASS |
| project-a TOTAL | 54.1 | 54.1 | PASS |
| project-b TOTAL | 23.3 | 23.3 | PASS |
| project-a `missing` | 0 | 0 | PASS |
| project-b `missing` | 8 | 8 | PASS |
| project-a precision junk | 185 | 184 | PASS |
| project-b precision junk | 9 | 9 | PASS |
| project-a wall recall @1.5 ft | 53.7% | 53.4% | PASS (>=53.2%) |
| project-a regularized | 9 / 285 | 67 / 285 | **FAIL** (needs >=171) |
| project-a weighted mean vertices | 293.2 | 231.8 | **FAIL** (20.9%, needs >=50%) |

Final project-a taxonomy is `ok:27`, `shape-poor:32`, `fragmented:36`, `merged:23`, `missing:0`.
Final project-b taxonomy is `ok:1`, `shape-poor:5`, `fragmented:8`, `missing:8`.

## Area honesty

Across the 67 regularized project-a rooms, geometric area delta versus the committed raw polygon is:

| Distribution | Absolute | Fractional |
| --- | ---: | ---: |
| p95 | 12.444 sf | 2.858% |
| max | 26.120 sf | 2.959% |

Every accepted room is within `RegularizeAreaTolerancePct` by construction. `RawSqft` is unchanged,
so project-a and project-b retain exact detector partition totals even when their polygons are regularized.

## Promoted fixture straightness

| Level | Regularized | Mean vertices before -> after | Median before -> after | Rooms <=12 before -> after |
| --- | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 24 / 69 | 341.8 -> 221.5 | 304 -> 142 | 4.3% -> 15.9% |
| Level 0/Theatre | 1 / 4 | 158.5 -> 77.2 | 98 -> 92 | 0.0% -> 0.0% |
| Level 1/Main Level | 17 / 82 | 300.9 -> 271.3 | 202 -> 140 | 3.7% -> 11.0% |
| Level 2/Upper Level | 13 / 79 | 271.5 -> 229.5 | 220 -> 156 | 0.0% -> 7.6% |
| Level 3/Attic | 12 / 51 | 259.1 -> 197.6 | 210 -> 170 | 3.9% -> 15.7% |
| project-b MAIN LEVEL | 2 / 20 | 85.7 -> 84.3 | 64 -> 64 | 5.0% -> 10.0% |

The regenerated TSVs for every populated project-a and project-b level are promoted. `ROOF PLAN` remains
empty and byte-unchanged.

## Verification

- `Source compile`: `Pe.Revit.Tests.csproj -c Debug.R25.Tests` succeeded.
- `FreshRevitProcess` replay: `ProjectAReplayDumpRun.Dump_replayed_tsvs` passed and regenerated both
  project fixture sets.
- `FreshRevitProcess` required suites: `TakeoffReplayTests`, `RhvacCandidateBuilderTests`, and
  `RhvacEvalTests` passed **35/35** (0 failed, 0 skipped).
- Python scoreboards: project-a TOTAL 54.1, 184 junk, 53.4% wall recall; project-b TOTAL 23.3, 9 junk.
- The user-owned RRD session was not contacted.
