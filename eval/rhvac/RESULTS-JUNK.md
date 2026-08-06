# Flags and junk-candidate mission results (2026-08-06)

Offline replay only. No committed fixture TSVs or live Revit session were touched.

## Part 1 — retained

`RoomTakeoff.LoadResult` now round-trips room ambiguity flags from `META flag` lines, and
`SpaceMaterializer` appends the human-readable flags to each owned Space's Comments value.
`Tsv_round_trip_preserves_room_flags` passed in the offline `NoDocumentRuntime` test lane.

## Part 2 — baseline

Five captured project-a snapshots were replayed to `.artifacts/tmp/rhvac-junk-baseline` and scored.

```text
PRECISION  (candidate best same-floor GT IoU; matched >= 0.20)
floor  gt cand ratio match% junk  junk sf  <60 60-150  >150
    0  17   73  4.29   19.2   59   9023.1   18     23    18
    1  44   82  1.86   42.7   47  15401.3   21      7    19
    2  45   79  1.76   46.8   42   6981.8   22      7    13
    3  12   51  4.25   27.5   37   4109.0   22     10     5
TOTAL 118  285  2.42   35.1  185  35515.2   83     47    55

MISSION GATES
FAIL zero junk candidates <60 sf: 83
FAIL total junk <= 90: 185
FAIL candidate/GT <= 2.0 total: 2.42 (L0 4.29, L1 1.86, L2 1.76, L3 4.25)
PASS TOTAL SCORE >= 53.1: 54.1
PASS taxonomy missing no increase: 0
```

## Iterations

1. Added post-dissolution median-chamfer width acceptance (`MinFeatureWidthFt=2.5`) plus an
   isoperimetric compactness floor (`0.04`). Rejected regions were emitted as three-column
   `META residue` records; weakly supported rejected regions could merge into accepted neighbors.
   A synthetic bulged-ribbon test passed.
2. Full replay improved candidates `285 -> 241` and junk `185 -> 144`, but failed binding quality
   gates: score `54.1 -> 52.5` and taxonomy `missing 0 -> 4`. Compactness rejected real Upper and
   Attic shapes, so `0.04` was not retained.
3. Lowered compactness to `0.01` and separated width acceptance from area-only sliver dissolution
   so width failures became residue instead of being silently re-flooded. Upper Level at 2.5 ft
   produced 75 candidates and 39 junk, but introduced one missing real room (Suite #4 Mech 216).
   Switching the rejected-region merge from the consumed `0.35` open-plan threshold to the existing
   `0.60` low-evidence threshold did not merge that strongly evidenced room.
4. Width sweep on Upper Level: 2.0 ft was identical to 2.5 ft (75 candidates, 39 junk, one missing);
   1.5 ft cleared missing but worsened detection to 86 candidates and 48 junk versus the 79/42
   baseline. The 0.25 ft raster makes this a discrete cliff, not a tunable middle ground.

Best full acceptance attempt:

```text
TOTAL SCORE 52.5
taxonomy fragmented:35 merged:21 missing:4 ok:27 shape-poor:31

PRECISION  (candidate best same-floor GT IoU; matched >= 0.20)
floor  gt cand ratio match% junk  junk sf  <60 60-150  >150
    0  17   64  3.76   21.9   50   8263.7   13     20    17
    1  44   75  1.70   46.7   40  12362.0   16      7    17
    2  45   72  1.60   47.2   38   6639.9   20      6    12
    3  12   30  2.50   46.7   16   1672.8    9      5     2
TOTAL 118  241  2.04   40.2  144  28938.4   58     38    48

MISSION GATES
FAIL zero junk candidates <60 sf: 58
FAIL total junk <= 90: 144
FAIL candidate/GT <= 2.0 total: 2.04
FAIL TOTAL SCORE >= 53.1: 52.5
FAIL taxonomy missing no increase: 4
```

## Stop decision

No Part 2 detector change is retained. The first threshold that rejects the evidenced narrow junk
also rejects a real 31.9 sf mechanical-room candidate; relaxing it to preserve `missing` makes the
candidate and junk counts worse than baseline. Stricter width or compactness can only preserve that
missing regression, so the requested `<= 90` junk gate is unreachable through these mechanisms on
the captured project-a partition without a project-a-specific exception or new evidence signal.

The retained post-mission project-a result is therefore the unchanged baseline block above. project-b was
replayed from the retained source state: 20 candidates / 22 GT = `0.91`, count-ratio gate PASS.
