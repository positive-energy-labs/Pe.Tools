# Mission brief — P9: native readback — Revit-edited Space boundaries become canonical (C#)

## Context

Prod workflow: calc draft → resolve intent → materialize (P8: Spaces for regularized rooms,
FilledRegions as unresolved evidence) → **human edits geometry in Revit** → readback. This
mission is the readback: after the human straightens/redraws separation lines and places or
renumbers Spaces, the native geometry — `Space.GetBoundarySegments()` — is the truth, and it
must flow back beside the takeoff artifacts so the route and downstream consumers display it.

The technique is proven: `docs/features/takeoffs/_GOALS.md:94` states the intent, and the
main checkout's `.artifacts/tmp/takeoff-viewport/create-aligned-native-overlay.cs` already
walks `GetBoundarySegments` loops into curve loops. This mission promotes it into a typed
core capability.

The web side (P9W, RESULTS-P9W-NATIVE-MERGE-WEB.md) is already built against this exact
contract — it is BINDING, do not deviate:

- Output: one file per level, `takeoff/<level>.native.tsv`, standard takeoff TSV format
  (`META level`, `META elev`, `ROOM`, `POLY` lines) plus one `META\tsource\tnative` line.
- Native rooms carry NO ambiguity flags and no residue lines.
- Room id = `Space.Number`. Human-created Spaces (no ownership token) are included — their
  Space number is the id. The human's edit is the point; owned-only would discard it.
- Geometry: boundary segment loops, verbatim (largest loop = outer, others = holes),
  model coordinates in feet, same `x;y|x;y` encoding as the detector TSV.

Read first (post-P7/P8 state, not older docs): `source/Pe.Revit.Takeoff/RoomTakeoff.cs`,
`SpaceMaterializer.cs`, `TakeoffTsv.cs`, `Contracts.cs` (`ToTsv` — reuse/extend its
serialization rather than hand-rolling a second writer),
`source/Pe.Revit.Tests/LibraryBehavior/TakeoffSpaceMaterializationTests.cs`.

## Scope

1. Core entry point `RoomTakeoff.ReadbackNative(doc, level, phase, takeoffDirectory, opt, log)`:
   collect ALL placed Spaces on the level+phase (owned or not; skip unplaced/unenclosed ones
   with a logged census — never silently), read boundary loops, write
   `takeoff/<level>.native.tsv` atomically (temp + move). Return a small typed result
   (spaces read, skipped census, path written).
2. ROOM line fields for native rooms: id, native area (`space.Area`), perimeter from the
   outer loop, label = `LocationPoint`, meanCeilingFt = `LimitOffset` (fall back sanely and
   log if unset).
3. Find how `MaterializeSpaces` is exposed as a public op (op metadata / host wiring). Mirror
   that exposure for readback with the same discoverability conventions (name it in the same
   family, e.g. the takeoff/spaces group). If materialization is genuinely test-lane-only
   with no op wrapper, note that in results and leave readback at the same lane.
4. FreshRevitProcess round-trip test: materialize a fixture level (P8 contract) → mutate
   nothing → readback → assert every materialized Space appears in the native TSV with
   matching id and area within Revit tolerance; assert the file parses via `TakeoffTsv.ParseTsv`
   and reports `source=native`. A second test: renumber one Space and re-readback → id follows.

## Binding gates

- Full C# filter green (this includes P8's updated materializer tests), exact counts:
  `dotnet tool run pe-revit -- test fresh --filter "FullyQualifiedName~TakeoffReplayTests|FullyQualifiedName~RhvacCandidateBuilderTests|FullyQualifiedName~RhvacEvalTests|FullyQualifiedName~RhvacMaterializationResolutionTests|FullyQualifiedName~TakeoffSpaceMaterializationTests|FullyQualifiedName~RhvacRoomShapeTests|FullyQualifiedName~TakeoffTsvTests" --timeout-seconds 900 --json`
  (RhvacProjectAEvalRun excluded as always.)
- Round-trip test green, counts reported.
- Committed replay TSVs untouched; `python eval/rhvac/score-takeoff.py` TOTAL = 54.1 exactly.
- No changes under `source/pe-tools/` except — ONLY IF an op surface was added — the
  regenerated typegen projections, using the proven typegen flow (needs live host +
  `--session`; if no live host is available, note it in results and leave typegen pending).

If a gate is unreachable, stop at the best honest point and write the tradeoff/census in
`eval/rhvac/RESULTS-P9-NATIVE-READBACK.md`. Write that results file either way.

Stage your changes; do not commit. Work autonomously; do not ask questions.
