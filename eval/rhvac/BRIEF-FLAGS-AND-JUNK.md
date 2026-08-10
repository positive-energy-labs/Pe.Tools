# Mission: flag round-trip fix, then junk-candidate reduction (two parts, in order)

Work in this worktree only. Stage your work; do NOT commit. Offline replay lane only — no
live Revit, no touching eval/rhvac fixtures' committed TSVs (regenerating scoreboard.txt etc.
is fine, they're gitignored).

## Part 1 — ambiguity flags are write-only through materialization (bug, fix first)

`Contracts.cs` `ToTsv` writes room flags as `META flag R07:open-plan-merge` lines, but
`RoomTakeoff.LoadResult` (RoomTakeoff.cs, ~line 253) parses only ROOM/POLY lines — flags are
lost on the TSV→materialization path, so materialized Revit Spaces and every downstream
consumer never see ambiguity. Fix: LoadResult parses META flag lines back onto the right
RoomResult; SpaceMaterializer stamps each Space's flags into its Comments parameter
(joined, e.g. "pe-takeoff: open-plan-merge, low-evidence-boundary") so a human sees them in
Revit. Add a test in Pe.Revit.Tests that round-trips a TakeoffResult with flags through
ToTsv → LoadResult and asserts flags survive (follow the existing TakeoffPartitionTests
style; pure-offline, no Revit doc needed for the parse half).

## Part 2 — junk reduction via acceptance gating inside PartitionFormulation

Context you must internalize first: read `eval/rhvac/RESULTS.md` (the PRECISION baseline:
285 candidates vs 118 GT, 185 junk best-IoU<0.2, 35.5k sf) and this design finding: the
pre-partition detector (see `git show c501fad:source/Pe.Revit.Takeoff/Detector.cs`) gated
regions on ceiling-fraction AND compactness before emitting, and only accepted rooms grew
into wall ink — its failure mode was omission (holes). The current partition assigns every
domain cell, so its failure mode is commission (junk rooms). The fix direction is agreed:
KEEP the partition accounting, but only ACCEPTED regions emit as rooms; non-accepted area
becomes explicitly flagged residue, not fake rooms.

In `PartitionFormulation.cs`:
- After sliver dissolution, run an acceptance pass per region. Mechanisms, not projectA
  constants (knobs go on TakeoffOptions with sane defaults):
  - interior width: erosion-based (largest inscribed disc / median interior chamfer depth),
    NOT max width — one bulge must not immunize a ribbon. Reject regions whose interior
    width < MinFeatureWidthFt.
  - compactness floor (area / bounding metric or isoperimetric quotient) tuned to admit real
    L-shaped rooms and corridors — corridors are rooms; wall-band ribbons are not. Consider
    width-based rejection primary and compactness secondary.
  - seedless components keep their existing flag but must pass the same acceptance.
- Rejected regions do NOT emit as rooms. Their cells either (a) merge into an accepted
  neighbor when the shared boundary is below evidence support (existing open-plan-merge
  machinery), or (b) emit in the TSV as `META residue` entries (polygon + area + reason) so
  nothing is silently lost and the UI can render them as gray "unclaimed" area.
- No formulation forks. Partition stays the only path.

## Gates (binding, measured on the committed project-a TSVs via replay + scoreboard)

Iterate with: `dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests
--filter "FullyQualifiedName~ProjectAReplayDumpRun"` with PE_TAKEOFF_REPLAY_OUT set, then
`python eval/rhvac/score-takeoff.py --takeoff-dir <out>` (see eval/rhvac/HANDOFF.md
RE-VERIFY section for the exact env-var recipe).

- junk candidates <60 sf: 0 (gate already in scoreboard)
- total junk (best-IoU<0.2): <= 90 (half of 185)
- candidate/GT ratio: <= 2.0 total (from 2.42), no level worse than baseline
- TOTAL SCORE: >= 53.1 (max 1.0 point sacrifice from 54.1)
- taxonomy `missing`: no increase (currently ~1) — do not buy junk reduction with dropped
  real rooms
- project-b run must not regress its count-ratio gate (currently PASS at 0.91).

Record before/after PRECISION + GATES blocks and per-change iteration notes in
`eval/rhvac/RESULTS-JUNK.md`. If a gate is unreachable without project-a-specific hacks, stop
and write why — an honest miss beats a tuned lie. Work autonomously; do not ask questions.
