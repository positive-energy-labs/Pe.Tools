# Snap coverage results

Date: 2026-08-06

Proof lane: offline snapshot replay in `FreshRevitProcess` (`NoRrdContact`)

## Outcome

The cause census landed; the geometry experiment did not.

The accepted behavior still has **222 raw-pinned rooms out of 305 snap-stage rooms**. The dominant
failure is non-simple polygon topology, followed by area drift and corner-angle rejection.
Junction-move caps are minor, and no snapshot exhausted the 12-iteration budget.

A per-chain staged-revert prototype was the strongest mechanism tested. It reduced raw-pinned
rooms from **222 to 128 (42.3%)**, but missed the >=50% target and reduced the project-a wall-recall
gate from 53.7% to 53.3%. The prototype and its fixture output were reverted. The accepted seven
replays are byte-identical to the existing fixtures, so `SpaceBoundaryNetwork` still cannot be
collapsed safely.

## Cause census

Classification is about staged reversion, not whether every boundary segment found a wall line:

- `fully-snapped`: no room guard caused a revert;
- `partially-reverted`: at least one guard revert occurred, but the final polygon is not the raw
  raster polygon;
- `raw-pinned`: at least one guard revert occurred and the final polygon is byte-for-byte the raw
  raster polygon.

Cause cells are `unique rooms / revert attempts`; rooms can have more than one cause.

| Snapshot | Fully snapped | Partial revert | Raw-pinned | Area drift | Non-simple polygon | Corner angle | Junction move cap | Iteration exhaustion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Level 0/Lower Level | 3 | 20 | 46 | 40 / 68 | 30 / 59 | 19 / 22 | 2 / 2 | 0 / 0 |
| Level 0/Theatre | 2 | 0 | 2 | 0 / 0 | 2 / 4 | 1 / 2 | 0 / 0 | 0 / 0 |
| Level 1/Main Level | 7 | 8 | 67 | 28 / 45 | 55 / 102 | 20 / 21 | 1 / 2 | 0 / 0 |
| Level 2/Upper Level | 4 | 13 | 62 | 42 / 70 | 42 / 78 | 28 / 31 | 4 / 4 | 0 / 0 |
| Level 3/Attic | 9 | 4 | 38 | 7 / 9 | 36 / 74 | 14 / 15 | 5 / 5 | 0 / 0 |
| project-b MAIN LEVEL | 4 | 9 | 7 | 9 / 11 | 9 / 13 | 5 / 5 | 0 / 0 | 0 / 0 |
| project-b ROOF PLAN | 0 | 0 | 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| **Total** | **29** | **54** | **222** | **126 / 203** | **174 / 330** | **87 / 96** | **12 / 13** | **0 / 0** |

The env-gated replay diagnostic now writes every room, outcome, guard attempt, cause list, area
drift, and guard bound into each `snap_<level>.json` under `PE_TAKEOFF_SNAP_DIAG_OUT`. Per-chain
geometry remains in the same file. Run it with:

```powershell
$env:PE_TAKEOFF_REPLAY_OUT = '<tsv-output-dir>'
$env:PE_TAKEOFF_SNAP_DIAG_OUT = '<diagnostic-output-dir>'
dotnet tool run pe-revit -- test fresh --filter "Name~Dump_replayed_tsvs" --timeout-seconds 900 --json
```

## Mechanism experiments

| Mechanism | Evidence | Decision |
| --- | --- | --- |
| Per-chain staged revert, largest moved-area chain first | Raw pins 222 -> 128 (42.3%). Lower 46 -> 23, Theatre 2 -> 2, Main 67 -> 41, Upper 62 -> 28, Attic 38 -> 33, project-b Main 7 -> 1. project-a score 54.1 -> 54.2; junk counts and taxonomy unchanged; wall recall 53.7% -> 53.3%. | Reverted: missed raw-pin target and worsened a binding gate. |
| Per-chain direct-to-raw | Lower 46 -> 24; Main 67 -> 43. Faster than staged fallback but slightly worse coverage. | Rejected. |
| Freeze moved junctions before chain reversion | Lower 46 -> 28. Faster, but topology remained dominant and coverage regressed against per-chain revert. | Rejected. |
| Exhaustive/local trial of candidate chain fallbacks | Lower produced no better raw-pin count; exhaustive Main exceeded the adapter's 20-minute timeout. | Rejected as operationally unusable. |

This evidence rules out iteration budget and colinear-cluster tolerance as the first changes to
make. The remaining problem is topology: non-simple assembled rings dominate Main and Attic, and
the current room-level guard cannot identify a safe minimal chain subset without expensive search.
The line model therefore does not yet provide enough clean coverage to remove the duplicate
materialization regularizer.

## Gates and area proof

Accepted output (instrumentation only):

- project-a score: **54.1**; taxonomy unchanged; `missing` remains zero; precision junk remains
  **185 total / 143 unflagged**; wall recall remains **53.7%**.
- project-b score: **23.3**; taxonomy unchanged with **8 missing**; precision junk remains
  **9 total / 8 unflagged**; wall recall remains **0.0%**.
- Maximum accepted absolute area drift: **7.295838 sf** (`Level 2/Upper Level:R02`),
  **0.915987%** against a **7.965 sf** guard bound.
- Maximum accepted fractional area drift: **0.999245%** (`Level 2/Upper Level:R10`),
  **4.073173 sf** against a **4.07625 sf** guard bound.
- `MaxAreaDriftSqft = 0.5` and `MaxAreaDriftFrac = 0.01` were not changed.

All accepted replay TSVs are byte-identical to their fixtures. No project-a or project-b fixture changed,
so the permitted geometry-diff set is empty.

## Verification

`Source compile` passed:

```powershell
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --no-restore --nologo -v minimal
```

The combined `FreshRevitProcess` gate passed **27/27**, 0 failed, 0 skipped:

```powershell
$env:PE_TAKEOFF_REPLAY_OUT = '<accepted-output-dir>'
$env:PE_TAKEOFF_SNAP_DIAG_OUT = '<accepted-diagnostic-dir>'
dotnet tool run pe-revit -- test fresh --filter "Name~Dump_replayed_tsvs|FullyQualifiedName~TakeoffReplayTests|FullyQualifiedName~RhvacCandidateBuilderTests" --no-build --timeout-seconds 900 --json
```

Both project scoreboards were rerun against those accepted outputs. RRD was not contacted.
