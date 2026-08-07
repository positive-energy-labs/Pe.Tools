# Mission brief — P8: materialize everything — Spaces for regularized, FilledRegions for the rest

## Context

Decision (user, 2026-08-07): promotion to Revit means "handed to the human for geometry
editing," not "geometry is finished." Revit's native tools are the polygon editor. Therefore
the materializer must draw **every** takeoff room and residue, honestly typed:

- **Regularized rooms** (no `unregularized` flag): separation lines + native MEP Space —
  today's finished lane.
- **Unregularized rooms**: NO Space, NO separation lines. A 150-vertex raster boundary as
  separation lines would be hundreds of tiny segments a human must delete by hand — worse
  than useless. Instead draw the raw detector polygon as an owned **FilledRegion** on the
  owned spaces view: visible evidence saying "this territory exists; straighten me."
- **Residues**: owned FilledRegions likewise.
- **Shape-gate defectors** (`ShapeDefect` in `SpaceMaterializer.cs:79-95`): today the Space is
  DELETED, leaving a silent hole in the plan. Change: delete the Space but draw the room's
  detector polygon as an unresolved FilledRegion. Nothing the detector found ever vanishes
  from the drawn result.

The FilledRegion technique is proven in `Annotate.cs` (`FilledRegion.Create` from detector
loops) — reuse its mechanics, not its rainbow styling.

Read first: `source/Pe.Revit.Takeoff/SpaceMaterializer.cs`, `Annotate.cs`, `RoomTakeoff.cs`
(`MaterializeSpaces`, `LoadMaterializationResult`), `SpaceBoundaryNetwork.cs` (how
`unregularized` is flagged), `Contracts.cs`, and
`source/Pe.Revit.Tests/LibraryBehavior/TakeoffSpaceMaterializationTests.cs`.
NOTE: a prior mission (P7, RESULTS-P7-SEAM-FLIP.md) moved TSV parse/resolutions into core
Takeoff — read the moved files as they are now, not as older docs describe them.

## Scope

1. `SpaceBoundaryNetwork` / `SpaceMaterializer`: separation lines are emitted **only from
   regularized rooms' loops**; Spaces are created only at regularized rooms' label points.
   Each regularized room's full loop is emitted, so enclosure survives the exclusion of
   unregularized neighbors.
2. Unregularized rooms, residues (if present in the materialization result — extend the
   core loader to carry residues if it doesn't yet), and shape-gate defectors are drawn as
   FilledRegions on the owned spaces view: first `FilledRegionType`, muted solid override
   (halftone / gray — visually "unresolved evidence", clearly distinct from Space color fills),
   stamped via the existing `Stamp`/token mechanism so `DeleteOwned`/`Cleanup` remove them.
   Include the room id + flags in the Comments stamp.
3. Raw raster rings can be non-simple (self-touching loops). FilledRegion.Create may reject
   them: attempt creation after dropping consecutive duplicate vertices; on failure, fall back
   to drawing the outer ring as owned detail lines on the view and log the room id — NEVER
   silently skip. Report the failure census in results.
4. Accounting is a hard invariant, logged at the end of `Replace`:
   `spaces + filledRegions + lineFallbacks == rooms.Count + residues.Count + defectors`,
   and zero rooms deleted-without-replacement. Log the counts.
5. Area validation, level-total conservation, and enclosure checks now apply to the
   regularized/Space population only (FR rooms have no native area). Keep them.
6. Update `TakeoffSpaceMaterializationTests` to the new contract: assert the accounting
   invariant, assert a defector produces an FR instead of a hole, assert unregularized rooms
   produce FRs and no Space. Use/extend the existing doc-backed fixtures.
7. **Known-red test you now own**:
   `TakeoffSpaceMaterializationTests.Boundary_network_straightens_shared_wall_without_an_area_preserving_dogleg`
   fails today (pre-existing; causally isolated from P6/P7 — likely stale vs the
   RegularizeAreaTolerancePct 1%→3% straightness remedy, df44338). Diagnose it: if the
   current SBN behavior is correct under the 3% contract, update the test's expectation with
   a one-line justification in the results file; if SBN is genuinely wrong, fix SBN. Do not
   delete the test.

## Binding gates

- Doc-backed + no-document C# filter green, exact counts reported:
  `dotnet tool run pe-revit -- test fresh --filter "FullyQualifiedName~TakeoffReplayTests|FullyQualifiedName~RhvacCandidateBuilderTests|FullyQualifiedName~RhvacEvalTests|FullyQualifiedName~RhvacMaterializationResolutionTests|FullyQualifiedName~TakeoffSpaceMaterializationTests|FullyQualifiedName~RhvacRoomShapeTests" --timeout-seconds 900 --json`
  (RhvacProjectAEvalRun excluded from pass/fail as always.)
- Accounting invariant asserted by a test, not just logged.
- Detector/replay untouched: committed TSVs byte-identical, `python eval/rhvac/score-takeoff.py`
  TOTAL = 54.1 exactly.
- No changes under `source/pe-tools/`.

If a gate is unreachable, stop at the best honest point and write the tradeoff/census in
`eval/rhvac/RESULTS-P8-MATERIALIZE-EVERYTHING.md`. Write that results file either way
(counts: spaces / FRs / fallbacks / failures on the project-a fixture level used by tests).

Stage your changes; do not commit. Work autonomously; do not ask questions.
