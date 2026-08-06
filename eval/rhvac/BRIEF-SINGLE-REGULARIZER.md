# Mission: one regularizer — delete BoundarySnap, run SpaceBoundaryNetwork's straightening at emit

Decision (user, 2026-08-06): BoundarySnap is deleted (983 LOC that fully works on 29/305
rooms and scored 0.0 — see RESULTS-SNAP-COVERAGE.md). The remedy for straightness: the
regularization inside SpaceBoundaryNetwork (which demonstrably produces clean straight
Spaces FROM RAW RASTER input — it predates BoundarySnap) runs ONCE at detector emit time,
and its output becomes the single shared geometry: TSV, /rhvac web UI, and materialized
Spaces all consume the same straight polygons. Read RESULTS-SNAP-COVERAGE.md,
RESULTS-PURGE.md tier-2 stop evidence, and REFINEMENT.md ground rules first.

## Scope
1. Delete BoundarySnap.cs and every reference (SnapBoundaries knob and Snap* options go —
   greenfield, no compat shims). The phase-3 state-log entry in REFINEMENT.md gets a
   one-line amendment noting the supersession (append, do not rewrite history).
2. Move SpaceBoundaryNetwork's regularization (DP simplify, dominant axes, wall-line
   clustering, vertex re-solve, seam ruling) into a detect-side pass invoked by
   PartitionFormulation after emit ranking, operating on the level's full room set (it
   needs all rooms for shared boundaries — that is its strength). Its output polygons are
   what ToTsv writes.
3. Behavior repairs (binding, doctrine from CLAUDE.md / flag-not-reject):
   - NO wholesale room drops: a room the network cannot regularize keeps its raw polygon
     and gains flag `unregularized`. Room count in == room count out, always.
   - Ruled seams without ink support gain flag `ruled-seam` on the rooms they bound (the
     existing low-evidence flag lane format).
   - Per-room area conservation: regularized area within the existing snap guard bounds
     (max(0.5 sf, 1%)); a room exceeding it reverts to raw + `unregularized` flag.
4. Materialization: SpaceBoundaryNetwork.Build reduces to welding/curve emission over the
   already-regular TSV polygons (the purge tier-2 welder direction — now the input IS
   clean by construction for regularized rooms; raw+flagged rooms use the existing loop
   tracing). ShapeDefect gate, ink oracle, dropped-path reporting stay.
5. score-takeoff.py: add straightness metrics to the scoreboard (report, not hard gate):
   mean vertices per candidate polygon, median, % rooms with <= 12 vertices, % rooms
   flagged unregularized — per level, before/after in your results.

## Gates (binding; replay + scoreboard, both projects)
- Room counts per level identical to current fixtures (zero drops by construction).
- TOTAL SCORE within +/-0.5 of 54.1 (projectA) and +/-0.5 of 23.3 (projectB); taxonomy
  `missing` not increased; PRECISION junk totals within +/-3 of current.
- Wall recall >= 53.2% project-a @1.5 ft (baseline 53.7, small dip tolerated for geometry
  change; report exact).
- Max per-room area drift within the guard for every regularized room (print max).
- Straightness: mean vertices per room must drop by >= 50% vs current fixtures on projectA
  (current TSVs are mostly raster staircases; if regularization works this is easy —
  report honestly).
- Net LOC across source/Pe.Revit.Takeoff: <= -700 (BoundarySnap -983 alone nearly covers
  it; do not pad with unrelated deletions).
- Tests: TakeoffReplayTests + RhvacCandidateBuilderTests + RhvacEvalTests green; add
  NoDocumentRuntime tests for: no-drop invariant, unregularized flag emission, area-guard
  revert. TakeoffSpaceMaterializationTests must compile; live parity marked PENDING.
- Fixture TSVs regenerate (geometry changes are the point); report per-level diff scope:
  rooms regularized / raw-flagged, vertex reduction, area deltas.

If the no-drop or area-guard invariants force reverting so many rooms that straightness
misses its gate, STOP and write the census of why — that is the honest outcome. Results to
eval/rhvac/RESULTS-SINGLE-REGULARIZER.md. Stage, do not commit. Work autonomously; do not
ask questions.
