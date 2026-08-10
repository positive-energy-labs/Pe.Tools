# Junction-pairing results

Date: 2026-08-06

Proof lanes: `Source compile` (`NoRrdContact`), snapshot replay in
`FreshRevitProcess`, and offline Python takeoff-scoreboard evaluation (`NoRrdContact`) for projectA
and projectB.

## Outcome

**STOPPED: exact room-owner pairing does not reach the binding fallback gate.**

The trial kept each emitted network path intact and split degree-4+ geometric junctions into
virtual vertices keyed by the path's exact owner-room set. Degree-2 junctions stayed unchanged.
An owner set occurring exactly twice paired; any other multiplicity failed without a geometric
guess.

This repaired degree connectivity for 23 project-a rooms, but 20 of those reconstructed cycles still
failed the existing simple/intersecting-loop topology guard. Loop-trace plus topology therefore
moved only **87 -> 84** (3.4%), not the required **87 -> <=35** (60% reduction). Three additional
rooms reached, then correctly failed, the unchanged area guard. Regularized rooms stayed **67/285**.

The ineffective trial code and its two focused tests were removed. No constants, regularization
mechanisms, production code, or fixtures are retained from the experiment.

## Fallback census

The committed straightness state is the before case.

| Level | Loop before | Topology before | Loop candidate | Topology candidate | Combined |
| --- | ---: | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 9 | 8 | 6 | 9 | 17 -> 15 |
| Level 0/Theatre | 2 | 0 | 1 | 1 | 2 -> 2 |
| Level 1/Main Level | 26 | 6 | 15 | 17 | 32 -> 32 |
| Level 2/Upper Level | 17 | 4 | 10 | 10 | 21 -> 20 |
| Level 3/Attic | 9 | 6 | 8 | 7 | 15 -> 15 |
| **project-a total** | **63** | **24** | **40** | **44** | **87 -> 84** |

Full before -> candidate census (`raw` means retained detector geometry plus `unregularized`):

| Level | Rooms | Regularized | Raw | Area guard | Dirty emitted path | Label containment | Loop trace | Topology |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 69 | 24 -> 24 | 45 -> 45 | 25 -> 27 | 3 -> 3 | 0 -> 0 | 9 -> 6 | 8 -> 9 |
| Level 0/Theatre | 4 | 1 -> 1 | 3 -> 3 | 1 -> 1 | 0 -> 0 | 0 -> 0 | 2 -> 1 | 0 -> 1 |
| Level 1/Main Level | 82 | 17 -> 17 | 65 -> 65 | 25 -> 25 | 8 -> 8 | 0 -> 0 | 26 -> 15 | 6 -> 17 |
| Level 2/Upper Level | 79 | 13 -> 13 | 66 -> 66 | 42 -> 43 | 3 -> 3 | 0 -> 0 | 17 -> 10 | 4 -> 10 |
| Level 3/Attic | 51 | 12 -> 12 | 39 -> 39 | 18 -> 18 | 6 -> 6 | 0 -> 0 | 9 -> 8 | 6 -> 7 |
| **project-a total** | **285** | **67 -> 67** | **218 -> 218** | **111 -> 114** | **20 -> 20** | **0 -> 0** | **63 -> 40** | **24 -> 44** |
| project-b MAIN LEVEL | 20 | 2 -> 2 | 18 -> 18 | 9 -> 9 | 5 -> 5 | 1 -> 1 | 1 -> 0 | 2 -> 3 |

## What remains and why

The 40 candidate loop-trace failures divide cleanly:

| Cause | Lower | Theatre | Main | Upper | Attic | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three-or-more ends with the same owner identity | 5 | 1 | 6 | 6 | 7 | 25 |
| Unmatched emitted path ends (degree 1) | 1 | 0 | 9 | 4 | 1 | 15 |

The first bucket is explicitly ambiguous under the brief and cannot be resolved without a
geometric or richer boundary-cycle guess. The second means path emission no longer supplies a
closed owner cycle. Identity pairing moved 20 rooms from loop-trace into the topology guard; with
the 24 pre-existing topology failures, the candidate total was 44 non-simple or intersecting-loop
failures. Accepting those would silently change room topology; the experiment stops instead.

## Binding gates

The candidate TSVs were byte-identical to the committed fixtures, so all downstream metrics are
unchanged.

| Gate | Before | Candidate | Result |
| --- | ---: | ---: | --- |
| project-a rooms by level | 69 / 4 / 82 / 79 / 51 | 69 / 4 / 82 / 79 / 51 | PASS |
| project-b rooms by level | 20 / 0 | 20 / 0 | PASS |
| project-a TOTAL | 54.1 | 54.1 | PASS |
| project-b TOTAL | 23.3 | 23.3 | PASS |
| project-a `missing` | 0 | 0 | PASS |
| project-b `missing` | 8 | 8 | PASS |
| project-a precision junk | 184 | 184 | PASS |
| project-b precision junk | 9 | 9 | PASS |
| project-a wall recall @1.5 ft | 53.4% | 53.4% | PASS (>=53.2%) |
| project-a loop + topology | 87 | 84 | **FAIL** (needs <=35) |
| project-a regularized | 67 / 285 | 67 / 285 | reported |
| Maximum accepted area drift | 2.959% | 2.959% | PASS (<=3%) |

project-a taxonomy remains `ok:27`, `shape-poor:32`, `fragmented:36`, `merged:23`,
`missing:0`. project-b remains `ok:1`, `shape-poor:5`, `fragmented:8`, `missing:8`.

## Straightness

| Level | Mean vertices before -> candidate | Median before -> candidate | Rooms <=12 before -> candidate |
| --- | ---: | ---: | ---: |
| Level 0/Lower Level | 221.5 -> 221.5 | 142 -> 142 | 15.9% -> 15.9% |
| Level 0/Theatre | 77.2 -> 77.2 | 92 -> 92 | 0.0% -> 0.0% |
| Level 1/Main Level | 271.3 -> 271.3 | 140 -> 140 | 11.0% -> 11.0% |
| Level 2/Upper Level | 229.5 -> 229.5 | 156 -> 156 | 7.6% -> 7.6% |
| Level 3/Attic | 197.6 -> 197.6 | 170 -> 170 | 15.7% -> 15.7% |
| project-b MAIN LEVEL | 84.3 -> 84.3 | 64 -> 64 | 10.0% -> 10.0% |

## Fixtures and verification

- Regenerated `rooms_Level_0_Lower_Level.tsv`, `rooms_Level_0_Theatre.tsv`,
  `rooms_Level_1_Main_Level.tsv`, `rooms_Level_2_Upper_Level.tsv`,
  `rooms_Level_3_Attic.tsv`, `rooms_MAIN_LEVEL.tsv`, and `rooms_ROOF_PLAN.tsv` were SHA-identical
  to their committed fixtures: zero lines and zero bytes changed on every level. Nothing was
  promoted.
- `Source compile`: `Pe.Revit.Tests.csproj -c Debug.R25.Tests` succeeded after the trial was
  removed.
- `FreshRevitProcess`: the paired/ambiguous owner-identity trial tests passed 2/2 before removal.
- `FreshRevitProcess`: `ProjectAReplayDumpRun.Dump_replayed_tsvs` passed and regenerated all seven
  snapshots with the candidate assembly.
- `FreshRevitProcess`: the binding post-replay filter `TakeoffReplayTests`,
  `RhvacCandidateBuilderTests`, and `RhvacEvalTests` passed **35/35** (0 failed, 0 skipped).
  `RhvacProjectAEvalRun` is excluded from this claim as required.
- The split project-a and project-b Python scoreboards reproduced the committed metrics above.
- The user-owned RRD session was not contacted.
