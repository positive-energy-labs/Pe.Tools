# Mission: degree-4+ junction pairing — unlock the 87 loop/topology rooms

Base: committed straightness state (RESULTS-STRAIGHTNESS.md). 67/285 project-a rooms
regularize; the tractable remaining bucket is 63 loop-trace + 24 topology failures, mostly
degree-4 or higher touching junctions where pairing path ends geometrically can silently
change topology. The fix direction named in the results: pair using ROOM-BOUNDARY IDENTITY
— each path knows its owner rooms, and at a junction the correct continuation is the path
that preserves each room's boundary cycle. Read RESULTS-STRAIGHTNESS.md and
SpaceBoundaryNetwork.cs first.

## Scope
- In the emit-side network pass: when assembling room loops at degree-4+ junctions, walk
  each room's boundary cycle by owner identity (the path's two owning rooms) instead of
  purely geometric continuation. A junction where identity is ambiguous (three+ paths
  sharing the same owner pair) stays a failure — no geometric guessing.
- Loop-trace failures (emitted curves not forming degree-2 loops) get the same treatment:
  identity-first assembly, fail honestly otherwise.
- No new regularization mechanisms; no constants tuned. The area guard
  (RegularizeAreaTolerancePct) and no-drop invariant stay by construction.

## Gates (binding; replay + scoreboard, both projects)
- Room counts identical; TOTAL within ±0.5 of 54.1 / 23.3; `missing` not increased; junk
  within ±3; project-a wall recall >= 53.2%.
- Loop-trace + topology fallbacks: project-a 87 -> <= 35 (60% reduction). Report the full
  fallback census before/after.
- project-a regularized rooms: report (67 -> ?); no hard floor, but every newly regularized
  room must pass the existing area guard by construction (print max drift).
- Straightness stats per level (mean/median vertices, % <= 12) before/after.
- Tests: full filter "TakeoffReplayTests|RhvacCandidateBuilderTests|RhvacEvalTests" green
  AFTER fixture promotion (a prior mission claimed green without rerunning post-promotion
  — do not repeat that). RhvacProjectAEvalRun is a designed fails-while-gates-fail runner;
  exclude it from pass/fail claims. Add unit coverage for identity-pairing (paired vs
  ambiguous junction).
- Fixtures: promote regenerated TSVs; report per-level diff scope.

If identity pairing can't reach the 60% reduction without geometric guessing, stop and
write the census of what remains and why. Results to
eval/rhvac/RESULTS-JUNCTION-PAIRING.md. Stage, do not commit. Work autonomously; do not
ask questions.
