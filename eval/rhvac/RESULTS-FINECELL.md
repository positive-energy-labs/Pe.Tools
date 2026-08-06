# Fine-cell probe — finer geometry does not separate junk from small rooms

Run date: 2026-08-06

Proof lane: agent-owned Revit 2025 sandbox only; detached project-a model; sandbox stopped with no-save armed

Level: `Level 2/Upper Level`
Verdict: **NO — 1.5-inch and 1-inch cells do not create a usable interior-width separation window.**

## Capture and replay cost

The baseline capture was not re-run. Its extraction time is the approximately 16 seconds between
the saved state and snapshot timestamps from the 2026-08-04 run; its Prepare time was not recorded.
Fine-cell capture is end-to-end Prepare + upstream extraction/gzip wall-clock. Replay is the
comparable NUnit test duration; end-to-end `dotnet test --no-build` time is included because runner
startup varied.

| Cell | Grid | Capture wall-clock | Snapshot | Size vs 0.25 | Replay | Replay vs 0.25 | Command wall-clock |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.25 ft | 1,876 × 1,690 | ≥~16 s; Prepare unknown | 0.53 MiB | 1.0× | 40 s | 1.0× | 102 s |
| 0.125 ft | 3,752 × 3,380 | 97.0 s = 42.5 + 54.5 | 1.94 MiB | 3.6× | 175 s | 4.4× | 330 s |
| 1 in | 5,627 × 5,070 | 88.7 s = 21.8 + 66.9 | 4.07 MiB | 7.6× | 431 s | 10.8× | 491 s |

The final local-only snapshots are under
`%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff-finecell-probe\cell_0_125_current` and
`cell_0_083333_current`; they are not staged.

### Capture compatibility note

Installed Pe.App 0.6.23 has the required `Heightfield` and `ProjectionSeed` primitives but predates
`DetectSnapshot` / `DumpReplaySnapshot`. The scripting probe therefore persisted those exact
production inputs in the current snapshot format; this is a deviation from the requested direct
live `RoomTakeoff.Detect` snapshot path, while offline replay still executes the current Detect
path. Its first attempt used the installed 14-ft
ceiling evidence cap and was discarded when replay showed double-height fraction falling from
13.3% to zero. The final captures invoke the same installed production rasterizer over the current
26-ft evidence window; final double-height fractions are 13.09% and 13.08%, versus 13.31% at
0.25 ft. Cell size is therefore the material changed capture input in the tables below.

## Quality

Junk uses the established rule: candidate best same-floor GT IoU `< 0.20`. Mean IoU is the mean
over the 45 Upper-Level GT rooms of each room's best candidate IoU. A mined wall is recalled when
at least 70% of its 2-ft samples lie within the stated tolerance of a candidate boundary. All
calculations retain each TSV polygon's outer loop and holes.

| Cell | Mean best-IoU | Candidates | Junk | Junk area | Wall recall @ 0.75 ft | Wall recall @ 1.5 ft |
|---:|---:|---:|---:|---:|---:|---:|
| 0.25 ft | 0.6229 | 79 | 42 | 6,895.5 sf | 31.5% | 53.5% |
| 0.125 ft | 0.6140 | 77 | 39 | 6,006.8 sf | 31.5% | 56.0% |
| 1 in | 0.6227 | 75 | 38 | 6,175.2 sf | 34.4% | 58.5% |

Finer cells remove only 3–4 junk candidates. At 0.125 ft this comes with a 0.0089 mean-IoU loss;
at 1 inch mean IoU is effectively flat (-0.0002) and wall recall gains only 2.9–5.0 points.

## Interior-width separation

`probe-finecell.py` rasterizes every candidate polygon on one fixed 0.0625-ft measurement grid,
independent of detector resolution, and applies SciPy's chessboard chamfer transform. Reported
interior width is twice the maximum chamfer distance: an approximation of the largest inscribed
disc diameter with at most about 0.125-ft raster quantization error. The comparison is junk versus
matched (`IoU >= 0.20`) candidates whose candidate area is at most 200 sf.

Counts by measured width:

| Cell / class | 2–3 ft | 3–4 ft | 4–5 ft | 5–6 ft | 6–8 ft | 8–12 ft | ≥12 ft |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0.25 junk | 12 | 11 | 8 | 0 | 2 | 4 | 5 |
| 0.25 matched ≤200 sf | 1 | 3 | 2 | 5 | 11 | 1 | 1 |
| 0.125 junk | 12 | 8 | 9 | 1 | 2 | 3 | 4 |
| 0.125 matched ≤200 sf | 1 | 3 | 3 | 4 | 11 | 1 | 1 |
| 1 in junk | 12 | 6 | 10 | 0 | 3 | 3 | 4 |
| 1 in matched ≤200 sf | 1 | 4 | 2 | 4 | 11 | 1 | 1 |

The empirical 0.25-ft-bin overlap coefficient is **20.2% at 0.25 ft, 31.1% at 0.125 ft, and
23.0% at 1 inch**. Finer resolution makes overlap worse, not better.

| Cell | Best accept-real threshold | Precision | Recall | F1 | Any threshold ≥90% precision and recall? |
|---:|---:|---:|---:|---:|---:|
| 0.25 ft | width ≥5.000 ft | 62.1% | 75.0% | 67.9% | No |
| 0.125 ft | width ≥5.125 ft | 65.4% | 70.8% | 68.0% | No |
| 1 in | width ≥4.375 ft | 57.6% | 79.2% | 66.7% | No |

There is no separation window: the best thresholds retain only about four-fifths of small matched
rooms while misclassifying roughly two-fifths of accepted candidates. The 1.5-inch threshold is
not more continuous in a useful statistical sense than the 3-inch baseline.

## Overlay

Magenta is junk under the 0.20-IoU rule; cyan is matched; thin gray is GT.

![0.25-ft and 0.125-ft Upper-Level candidates](project-a/probe/overlay_finecell.png)

## Recommendation

1. **Do not make a finer cell the default:** the width-separation hypothesis is falsified on Upper Level.
2. At 0.125 ft, junk improves only 42 → 39 while mean best-IoU regresses 0.6229 → 0.6140.
3. At 1 inch, junk reaches 38 and wall recall rises modestly, but mean best-IoU is effectively unchanged.
4. Width overlap remains 23–31%, and no threshold reaches 90% precision and recall at any resolution.
5. Keep 0.25 ft; use finer captures only for bounded diagnostics that justify a 4.4–10.8× replay cost.
