# Suspect-flag mission results (2026-08-06)

Offline replay only. The dedicated `FreshRevitProcess` lane replayed the seven local capture bins;
the concurrent/user-owned Revit sandbox was not contacted. Replay output stayed under
`.artifacts/tmp` and the committed fixtures were read-only comparison targets.

## Verdict

Flagging is geometry-safe and precise, but the requested project-a recall gate is not achievable with
the two specified generic signals at their evidence-backed defaults:

- project-a suspect precision: **97.4%** (37/38 flagged candidates are junk).
- project-a recall: **30.1%** of junk under 60 sf (25/83), **20.0%** of all junk (37/185).
- project-a false positives: **1**, safely below the `<= 12` limit.
- New gate: **FAIL**, 57 junk candidates under 60 sf remain unflagged by any queued flag.

The detector does not have oracle IoU at runtime. Blanket-flagging every sub-60-sf candidate would
make the new gate pass, but would flag 17 matched candidates and fail the binding false-positive
limit. No project/level/candidate exception was added.

## Implementation

After sliver dissolution, `PartitionFormulation` computes the retained Part-2 median-chamfer
interior-width measure and raster isoperimetric compactness for each final region. It only adds
`suspect:narrow` and `suspect:compactness`; it does not reject, merge, re-flood, or create residue.
`MinFeatureWidthFt` remains 2.5 ft and the iteration-3 compactness default is `0.01`.
The compactness knob rejects non-finite or out-of-range values at the shared partition boundary.

`score-takeoff.py` now parses room `META flag` rows. Its PRECISION census splits junk with any
queued flag from unflagged junk, while the headline flag-quality block measures only the new
`suspect:*` kinds. The existing `zero junk candidates <60 sf` gate is unchanged; the new
`zero UNFLAGGED junk candidates <60 sf` gate is additional.

## project-a before / after

Geometry and truth counts are unchanged:

| metric | before | after |
|---|---:|---:|
| TOTAL SCORE | 54.1 | 54.1 |
| candidates | 285 | 285 |
| junk | 185 | 185 |
| junk under 60 sf | 83 | 83 |
| junk carrying any queued flag | 5 | 42 |
| unflagged junk | 180 | 143 |
| unflagged junk under 60 sf | 82 | 57 |

After:

```text
PRECISION  (candidate best same-floor GT IoU; matched >= 0.20)
floor  gt cand ratio match% junk flag unfl  junk sf  <60 60-150  >150
    0  17   73  4.29   19.2   59    8   51   9023.1   18     23    18
    1  44   82  1.86   42.7   47   12   35  15401.3   21      7    19
    2  45   79  1.76   46.8   42    4   38   6981.8   22      7    13
    3  12   51  4.25   27.5   37   18   19   4109.0   22     10     5
TOTAL 118  285  2.42   35.1  185   42  143  35515.2   83     47    55
```

### Suspect-flag quality

| floor | flagged | flagged junk | precision | junk <60 recall | all-junk recall | false positives |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 8 | 8 | 100.0% | 27.8% | 13.6% | 0 |
| 1 | 7 | 7 | 100.0% | 23.8% | 14.9% | 0 |
| 2 | 5 | 4 | 80.0% | 9.1% | 9.5% | 1 |
| 3 | 18 | 18 | 100.0% | 59.1% | 48.6% | 0 |
| **total** | **38** | **37** | **97.4%** | **30.1%** | **20.0%** | **1** |

Flag payloads contain 38 `suspect:narrow` occurrences and 3 co-occurring
`suspect:compactness` occurrences. Compactness at `0.01` adds no uniquely flagged candidate.

### False positives (complete)

| candidate | area | best matched GT | IoU | flags |
|---|---:|---|---:|---|
| `Level 2/Upper Level:R71` | 32.4 sf | #91 Suite #4 Mech 216 | 0.584 | `suspect:narrow` |

This is the expected small real mechanical room. One accept-touch clears it; leaving it silent
would be worse.

## project-b replay

project-b geometry is also unchanged: TOTAL remains 23.3, MAIN LEVEL remains 20 candidates, and ROOF
PLAN remains zero candidates with its level flag.

| metric | before | after |
|---|---:|---:|
| candidates | 20 | 20 |
| junk | 9 | 9 |
| junk under 60 sf | 4 | 4 |
| suspect flagged | 0 | 2 |
| suspect-flag precision | n/a | 50.0% (1/2) |
| junk under-60 recall | n/a | 0.0% (0/4) |
| all-junk recall | n/a | 11.1% (1/9) |
| false positives | 0 | 1 |

The complete project-b false-positive list is `MAIN LEVEL:R19`, 27.2 sf, best matched to #14 Primary
WC at IoU 0.333, with `suspect:narrow`. The new unflagged-small-junk gate fails with 4.

## Fixture diff

Removing `META flag` rows from both sides leaves raw bytes identical for every replayed TSV:

| fixture | non-flag bytes | added/changed room flag rows |
|---|---|---:|
| project-a Level 0 / Lower Level | identical | 6 |
| project-a Level 0 / Theatre | identical | 2 |
| project-a Level 1 / Main Level | identical | 7 |
| project-a Level 2 / Upper Level | identical | 5 |
| project-a Level 3 / Attic | identical | 18 |
| project-b MAIN LEVEL | identical | 2 |
| project-b ROOF PLAN | identical | 0 |

Thus ROOM, POLY, all non-flag META rows, ordering, line endings, and bytes are unchanged. Only room
flag rows differ.

## Proof

- Source compile: `Pe.Revit.Takeoff` `Debug.R25`, 0 warnings / 0 errors.
- Python: `score-takeoff.py` compiled with `py_compile` and both project score runs completed.
- FreshRevitProcess: the requested combined filter
  `FullyQualifiedName~TakeoffReplayTests|FullyQualifiedName~TakeoffPartitionTests` passed 16/16,
  zero skipped. The current tree has no separate `TakeoffPartitionTests` class; its partition
  checks live in `TakeoffReplayTests`, so the second filter arm matched no additional tests.
- Final exact-source operational dumps passed for all five project-a bins and both project-b bins.
- Final automated comparison: non-flag TSV bytes identical **7/7**.

The fresh harness build repeated the repo's existing two `NU1901` warnings for
`NuGet.Packaging 6.12.1`; there were no compile or test failures.

## Stop decision

The specified signals are high-precision review hints, not a complete junk detector. Tightening
compactness enough to chase small compact rooms rapidly flags real rooms, while the prior width
sweep already established the 0.25-ft raster cliff. A non-binding exported-polygon compactness
sweep showed the same separation failure: at 0.12 it produced 11 false positives but found only
26/83 small junk; at 0.15 it already produced 21 false positives while finding 27/83.

The implementation therefore stops at the generic `2.5 ft / 0.01` mechanisms and reports the
failed recall gate honestly. Passing it needs a new evidence signal, not a project-a constant or an
oracle-derived exception.
