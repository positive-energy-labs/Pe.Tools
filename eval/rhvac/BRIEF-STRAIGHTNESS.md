# Mission: straightness remedy — unlock the two fallback buckets

Base: the committed single-regularizer state (RESULTS-SINGLE-REGULARIZER.md). 9/285 rooms
regularize; fallback census: 119 area-guard reverts, 126 dirty-path, 21 loop-trace, 10
topology. Goal: majority of rooms regularized with honest conservation. Read the census
and per-level logs first (.artifacts/tmp/single-regularizer-replay/log_*.txt if still
present; otherwise regenerate with the replay diagnostic).

## Mechanism 1 — right-size the area guard (evidence-backed, not a loosening for its own sake)
The 1% guard is inherited BoundarySnap conservatism. The downstream truth: RhvacEval's
roomArea gate tolerance is 10% (eval/rhvac/project-a/tolerances.json — confirm the exact
profile values and cite them). Add `RegularizeAreaTolerancePct` to TakeoffOptions,
default 3.0 (≥3x headroom vs downstream), floor still max(0.5 sf, pct). A room's
regularized area beyond tolerance still reverts to raw + `unregularized`. Report the
census shift from this change ALONE before touching mechanism 2.

## Mechanism 2 — dirty-path causes (126 rooms, the bigger bucket)
Instrument WHY paths fail to rule (per-path cause: no dominant axis fit? support below
threshold? junction disagreement? path too short?). Report the cause census. Then fix the
top causes with mechanisms, not constants — candidates: per-path fallback to a straight
chord when the path's raw polyline deviates < 2 cells from it; axis inference pooled
across the level (small rooms borrow the level's dominant axes instead of failing alone);
degree-2 junction pass-through. Every ruled path without ink support keeps the
`ruled-seam` flag discipline.

## Gates (binding; both projects; replay + scoreboard)
- Room counts identical (no-drop invariant stays).
- TOTAL within ±0.5 of 54.1 / 23.3; `missing` not increased; junk within ±3; wall recall
  >= 53.2% projectA.
- Area honesty: report the full distribution of regularized-room area deltas (max, p95);
  every room within RegularizeAreaTolerancePct by construction.
- Straightness targets: >= 60% of project-a rooms regularized; weighted mean outer-ring
  vertices reduced >= 50% vs the committed fixtures. If unreachable, report the honest
  ceiling and which bucket blocks it.
- Tests green (TakeoffReplayTests, RhvacCandidateBuilderTests, RhvacEvalTests) + new unit
  coverage for the tolerance knob and any new path mechanism.
- Fixtures: promote regenerated TSVs; report per-level regularized counts and vertex
  stats before/after.

Results to eval/rhvac/RESULTS-STRAIGHTNESS.md. Stage, do not commit. Work autonomously;
do not ask questions.
