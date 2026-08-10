# Mission: LOC purge — delete what the settled decisions made dead

The takeoff core grew 1.4k → 4.3k LOC compensating for problems now solved or settled
elsewhere. Purge in two tiers with hard proof gates. Deletion is the deliverable; a smaller
diff of the SAME behavior. Read docs/ARCHITECTURE.md posture first: greenfield, delete
stale code, no compatibility shims.

## Tier 1 — provably-dead code (gate: byte-identical replay)
Sweep source/Pe.Revit.Takeoff for: knobs on TakeoffOptions no code path reads; branches
unreachable under the shipped defaults + the Stock policy path (KEEP the Stock/
PE_TAKEOFF_POLICY replay path — it is the falsification lane); diagnostic dumps not wired
to any env flag that eval/rhvac scripts or HANDOFF.md mention; leftover Regions-era
helpers. Gate: all 7 committed replay TSVs regenerate BYTE-IDENTICAL (modulo the META flag
lines if the suspect-flag change landed first — state the diff), TakeoffReplayTests +
TakeoffPartitionTests + RhvacCandidateBuilderTests green.

## Tier 2 — collapse the double regularization (the real prize, ~900 LOC target)
BoundarySnap (983 LOC) straightens polygons INSIDE the detector; SpaceBoundaryNetwork
(905 LOC) then re-derives straightness from scratch at materialization (dominant-axes
histogram, wall-line clustering, seam ruling, L-connectors) because it predates snapping
(Jul 13) and the TSV round-trip used to be jagged. TSV polygons are now already snapped.

Replace SpaceBoundaryNetwork.Build's regularization with a minimal shared-boundary welder:
quantize the already-snapped polygon edges to the grid, weld coincident vertices across
neighboring rooms, emit the curve loops. KEEP: the ShapeDefect gate, area-drift logging,
dropped-room reporting, hole handling, and the ink-oracle plumbing (InkSupport). DELETE:
axis inference, wall-line clustering, vertex re-solve, seam/L-connector synthesis, the
8-ft unsupported-seam allowance (a snapped TSV needs no invented walls — if two rooms'
shared edges disagree after welding beyond 1 cell, DROP to the existing dropped-room path
and report, don't synthesize).

Gates:
- New NoDocumentRuntime unit tests for the welder: shared edges weld exactly; disagreeing
  edges drop; flags/holes preserved (follow TakeoffReplayTests style).
- TakeoffSpaceMaterializationTests must still compile; if it can only run in a live Revit
  lane, say so explicitly and mark live parity PENDING in the results — do not claim it.
- Net LOC change across source/Pe.Revit.Takeoff: target <= -700 lines. Report exact
  before/after per file.
- Replay TSVs untouched by tier 2 (materialization is post-TSV) — verify anyway.

If the welder reveals the snapped TSVs are NOT actually clean enough to weld (area drift,
open loops), stop tier 2, write the evidence — that is a detector finding, not a failure.
Results to eval/rhvac/RESULTS-PURGE.md. Stage, do not commit. Work autonomously; do not
ask questions.
