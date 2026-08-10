# Mission brief — P7: seam flip — TSV parse + resolutions into core Takeoff (C#)

## Context

Core takeoff materialization currently depends on the RHVAC export adapter:
`RoomTakeoff.cs:152` calls `RhvacCandidateBuilder.ResolutionPath` and `:340` calls
`RhvacCandidateBuilder.ParseTsvDirectory`. That seam is backwards — TSV parsing and
resolution application are core takeoff concerns; RHVAC is one consumer (r10 export).
Decision (user, 2026-08-07): flip it. Core Takeoff owns parse + resolutions; RHVAC adapts.

Additional simplifying fact: the polygon simplifier inside `ParseTsv` is used only for r10
candidate export (`RhvacCandidateBuilder.Build`); the Revit lane parses `simplify: false` and
the web viewer is dropping simplification in a parallel mission. So simplification is an
RHVAC-export concern and stays in the Rhvac folder; **core parse has no simplify option and
returns geometry verbatim.**

Read first: `source/Pe.Revit.Takeoff/Rhvac/RhvacCandidateBuilder.cs` (1219 lines),
`source/Pe.Revit.Takeoff/RoomTakeoff.cs` (:152, :334-363), the test files named below.
This is a **behavior-preserving refactor** — no semantic changes anywhere.

## Scope

1. Create core files in `source/Pe.Revit.Takeoff/` (namespace `Pe.Revit.Takeoff`), e.g.
   `TakeoffTsv.cs` and `TakeoffResolutions.cs`, and move there from RhvacCandidateBuilder:
   - records `TakeoffRoomShape`, `TakeoffResidueShape`, `LevelTakeoff`, `ResolutionApplyResult`
   - `ParseTsv` (drop the `simplify` parameter — always verbatim), `ParseTsvDirectory`
     (same), `ResolutionPath`, `ApplyResolutions`
2. `Rhvac/RhvacCandidateBuilder.cs` keeps: conventions (`LoadConventions`, records), `Build`,
   and the simplification helpers (`DeriveGridPitch`, `SimplifyLevelLoops`, `SimplifyShape`,
   `SimplifyOnce`, `SimplifyChain`, etc.), now applied by `Build` (or its immediate caller) on
   top of core-parsed shapes so r10 export output is byte-identical to today.
3. `RoomTakeoff.cs` (and `SpaceMaterializer.cs` if applicable) reference only core — after
   this mission, `grep -n "Rhvac" source/Pe.Revit.Takeoff/RoomTakeoff.cs
   source/Pe.Revit.Takeoff/SpaceMaterializer.cs` is empty.
4. Split/move tests to match ownership (parse/resolution tests out of
   `RhvacCandidateBuilderTests` into a core-named test file; Build/conventions/simplify tests
   stay). Python/TS mirrors are NOT in scope — no files outside `source/Pe.Revit.Takeoff/`
   and `source/Pe.Revit.Tests/`.

## Binding gates

- Full C# filter green, exact counts reported:
  `dotnet tool run pe-revit -- test fresh --filter "FullyQualifiedName~TakeoffReplayTests|FullyQualifiedName~RhvacCandidateBuilderTests|FullyQualifiedName~RhvacEvalTests|FullyQualifiedName~RhvacMaterializationResolutionTests|FullyQualifiedName~TakeoffSpaceMaterializationTests|FullyQualifiedName~RhvacRoomShapeTests" --timeout-seconds 900 --json`
  (`RhvacProjectAEvalRun` is designed to fail while eval gates fail — excluded from pass/fail.)
- Committed replay TSVs untouched (`git status` shows no `eval/**/*.tsv` changes; do NOT
  regenerate fixtures).
- Scoreboard unchanged: `python eval/rhvac/score-takeoff.py` TOTAL = 54.1 exactly.
- No public op metadata / typegen surface changed.

If a gate is unreachable, stop at the best honest point and write the tradeoff/census in
`eval/rhvac/RESULTS-P7-SEAM-FLIP.md`. Write that results file either way (what moved where,
LOC deltas, test counts).

Do not touch `source/pe-tools/` (a parallel mission owns the web app). Stage your changes; do
not commit. Work autonomously; do not ask questions.
