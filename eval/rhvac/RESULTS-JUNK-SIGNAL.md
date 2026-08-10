# Non-geometric junk-signal results (2026-08-06)

Proof lane: offline replay of the seven committed local snapshots through SDK-owned
`FreshRevitProcess`; the user-owned RRD session was not reused or changed.

## Verdict

**PASS.** A small region whose cell headrooms have a standard deviation of at least 0.5 ft now
gets `suspect:ceiling-variance`. The generic defaults are `SuspectMaxSqft = 60` and
`MinSuspectCeilingStdDevFt = 0.5`; setting either to zero disables this signal. It only adds a
flag after the final partition is fixed.

- project-a unflagged junk under 60 sf: **57 historical / 11 committed HEAD -> 5** (binding maximum 25).
- project-a junk under 60 sf without a suspect flag: **58 -> 24**.
- project-a suspect precision: **93.4%** (71/76), with **5** false positives.
- Both projects combined: **92.7%** suspect precision (76/82), with **6** false positives.
- TOTAL remains exactly **54.1 / 23.3**; candidate and junk counts are unchanged.

The prior result's reported 57 was the queue with *any* existing flag, while its 30.1% suspect
recall was 25/83 and therefore left 58 without `suspect:*`. Later straightness flags reduced the
any-flag queue to 11 before this mission. The scorer preserves that metric (final 5) and separately
gates the explicit `suspect:*` queue (final 24), so unrelated flags cannot hide suspect recall.
It also enforces the binding 85% precision and 20-false-positive limits.

## Measured signal selection

Temporary instrumentation dumped one joined signal row for every one of the 285 project-a candidates.
Truth remained best same-floor IoU `< 0.20`. Median values show why ceiling variation won:

| signal | junk median | matched median | useful result |
|---|---:|---:|---|
| boundary support | 0.948 | 1.000 | precise but weak recall; threshold `<= 0.95` leaves 43 small junk |
| dominant-neighbor share | 0.589 | 0.500 | opposite the simple dominance hypothesis; best gate-reaching cut has 10 false positives |
| within 1 ft of ink | 0.688 | 0.482 | works at `>= 0.70`, but leaves 22 with 7 false positives |
| ceiling coverage | 1.000 | 1.000 | no separation |
| ceiling headroom std-dev | 0.901 ft | 0.598 ft | at `>= 0.50 ft`, leaves 24 with 5 false positives |

The round ceiling threshold was selected instead of the replay-optimal cut point. Its local
tradeoff curve is:

| minimum std-dev | unflagged junk <60 sf | false positives | suspect precision |
|---:|---:|---:|---:|
| 0.40 ft | 19 | 8 | 90.5% |
| 0.45 ft | 22 | 6 | 92.4% |
| **0.50 ft** | **24** | **5** | **93.4%** |
| 0.55 ft | 28 | 4 | 94.4% |

No adjacency or ink-band combination was retained: the single ceiling-variance mechanism clears
the gates with less code and fewer false positives.

## project-a before / after

The before column is the committed HEAD replay before this mission, not the older geometry snapshot
quoted by `RESULTS-SUSPECT-FLAGS.md`.

| metric | before | after |
|---|---:|---:|
| TOTAL SCORE | 54.1 | 54.1 |
| candidates | 285 | 285 |
| junk | 184 | 184 |
| junk under 60 sf | 83 | 83 |
| suspect flagged | 38 | 76 |
| suspect-flagged junk | 37 | 71 |
| suspect precision | 97.4% | 93.4% |
| junk-under-60 recall | 30.1% | 71.1% |
| unflagged junk under 60 sf (any queued flag) | 11 | 5 |
| junk under 60 sf without a suspect flag | 58 | 24 |
| false positives | 1 | 5 |

### Per-level suspect quality

| floor | flagged | flagged junk | precision | small-junk recall | small junk without suspect flag | false positives |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 20 | 20 | 100.0% | 94.4% | 1 | 0 |
| 1 | 15 | 15 | 100.0% | 61.9% | 8 | 0 |
| 2 | 15 | 13 | 86.7% | 50.0% | 11 | 2 |
| 3 | 26 | 23 | 88.5% | 81.8% | 4 | 3 |
| **total** | **76** | **71** | **93.4%** | **71.1%** | **24** | **5** |

### False positives (complete)

| candidate | area | best matched GT | IoU | suspect flags |
|---|---:|---|---:|---|
| `Level 2/Upper Level:R53` | 53.0 sf | #89 Suite #4 Bath 214 | 0.234 | `ceiling-variance` |
| `Level 2/Upper Level:R71` | 32.4 sf | #91 Suite #4 Mech 216 | 0.584 | `ceiling-variance`, `narrow` |
| `Level 3/Attic:R32` | 51.1 sf | #127 Bunk Bath 311 | 0.251 | `ceiling-variance` |
| `Level 3/Attic:R37` | 44.4 sf | #130 Closet 314 | 0.393 | `ceiling-variance` |
| `Level 3/Attic:R38` | 43.9 sf | #123 WIC #2 | 0.381 | `ceiling-variance` |

All are below 60 sf and remain review flags; none is rejected or merged.

## project-b transfer check

TOTAL remains **23.3**, with 20 candidates, 9 junk, and 4 junk under 60 sf. Suspect flags move
from 2 to 6: 5/6 are junk, all four small junk are flagged, and there is no new false positive.
The sole false positive remains `MAIN LEVEL:R19`, 27.2 sf, matched to #14 Primary WC at IoU 0.333;
it now carries `suspect:ceiling-variance` and `suspect:narrow`.

## Fixture census and byte proof

| project / level | rooms | suspect flagged | ceiling variance | narrow | compactness | flag rows before -> after |
|---|---:|---:|---:|---:|---:|---:|
| project-a Lower Level | 69 | 18 | 16 | 6 | 0 | 55 -> 58 |
| project-a Theatre | 4 | 2 | 0 | 2 | 0 | 4 -> 4 |
| project-a Main Level | 82 | 15 | 11 | 7 | 2 | 67 -> 68 |
| project-a Upper Level | 79 | 15 | 13 | 5 | 1 | 66 -> 67 |
| project-a Attic | 51 | 26 | 21 | 18 | 0 | 43 -> 45 |
| project-b MAIN LEVEL | 20 | 6 | 5 | 2 | 0 | 18 -> 18 |
| project-b ROOF PLAN | 0 | 0 | 0 | 0 | 0 | 1 -> 1 |

A tab-aware Git Bash comparison used `tab=$(printf '\t')`, removed only rows beginning
`META${tab}flag${tab}`, then ran byte `cmp` on every fixture. Result: **7/7 identical**. Thus all
ROOM, POLY, non-flag META, ordering, line-ending, and other bytes are unchanged; only META flag
rows differ.

## Proof

- Source compile: `Pe.Revit.Takeoff` `Debug.R25`, 0 warnings / 0 errors.
- Python: `score-takeoff.py` passed `py_compile`; exact re-scores produced **54.1 / 23.3**.
- Targeted FreshRevitProcess: ceiling-variance regression plus all seven operational dumps passed
  **2/2**, zero skipped.
- Final post-review FreshRevitProcess operational dump passed **1/1**; all seven emitted TSV hashes
  are byte-identical to the promoted fixtures.
- Full post-promotion FreshRevitProcess filter:
  `FullyQualifiedName~LibraryBehavior.NoDocumentRuntime&FullyQualifiedName!~RhvacProjectAEvalRun`
  passed **41**, failed **0**, with the two explicit operational dump tests skipped. This includes
  `RhvacCandidateBuilderTests`; `RhvacProjectAEvalRun` is excluded from the claim.
- The harness build repeated the existing two `NU1901` warnings for `NuGet.Packaging 6.12.1`;
  there were no compile or test failures.
