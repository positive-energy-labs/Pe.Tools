# Mission: snap coverage — why do rooms pin raw, and how many can we free?

Context: eval/rhvac/RESULTS-PURGE.md tier 2 proved some emitted polygons are still raster
staircases (L0:R27, 296 vertices, +1.19% grid-quantization drift) because BoundarySnap's
staged revert (full -> conservative -> raw, 12-iteration loop, BoundarySnap.cs ~:521) pinned
them raw. Raw-pinned rooms are jagged in the UI/Revit AND block ever collapsing the
duplicate SpaceBoundaryNetwork regularizer (~900 LOC). This mission is diagnosis-first:
find out WHY rooms pin raw on the real data, then fix the highest-yield causes within the
existing area-drift guard. Do not loosen the guard itself (MaxAreaDriftSqft 0.5 /
MaxAreaDriftFrac 0.01) — accuracy is not for sale.

## Step 1 — instrument (offline replay lane, HANDOFF.md recipe)
Add a diagnostic (env-gated like existing snap diagnostics) that reports per level: rooms
fully snapped / partially reverted / raw-pinned, and for each revert the CAUSE (which guard
tripped: area drift, non-simple polygon, corner-angle, junction move cap, iteration
exhaustion). Run on all 7 snapshots; write the cause census to the results file. This
census is deliverable #1 even if nothing else lands.

## Step 2 — fix the top causes, mechanisms only
Candidate mechanisms (pick by census evidence, not by list order): per-chain revert instead
of whole-room staged revert (one bad chain currently drags the whole polygon raw);
junction-resolution order sensitivity; colinear-cluster tolerance interacting with the
0.25-ft grid on diagonal walls; iteration budget spent on the largest polygons. No new
regularizer, no project-a constants; knobs with sane defaults only.

## Gates (binding, replay + scoreboard)
- TOTAL SCORE within ±0.2 of 54.1; PRECISION junk counts unchanged or better; taxonomy
  `missing` not increased; all existing gates no worse.
- Raw-pinned room count: report before/after per level; target >= 50% reduction. If the
  census shows the causes are inherent (e.g. genuinely curved/diagonal geometry the line
  model can't express), report that honestly and stop — that itself answers whether the
  SpaceBoundaryNetwork collapse can ever happen.
- Per-room area drift stays within the existing guard for every snapped room (the guard is
  the proof; state max observed drift).
- Tests: TakeoffReplayTests + RhvacCandidateBuilderTests green.
- project-b TSVs: geometry may change ONLY for rooms that move from raw to snapped; run the
  scoreboard on both projects and report.

If fixture TSVs change (rooms newly snapped), regenerate them and state the per-file diff
scope (which rooms changed, by how much area). Results to eval/rhvac/RESULTS-SNAP-COVERAGE.md.
Stage, do not commit. Work autonomously; do not ask questions.
