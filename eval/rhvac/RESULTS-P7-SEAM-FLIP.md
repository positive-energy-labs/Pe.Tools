# P7 seam flip results

## Outcome

TSV parsing and takeoff-resolution application now belong to core `Pe.Revit.Takeoff`.
`RhvacCandidateBuilder` is an export adapter over those core shapes and applies its raster
simplification to cloned geometry inside `Build`, leaving core-parsed geometry verbatim.

- `TakeoffTsv.cs`: core shape records plus `ParseTsv` and `ParseTsvDirectory`.
- `TakeoffResolutions.cs`: `ResolutionApplyResult`, `ResolutionPath`, and `ApplyResolutions`.
- `RoomTakeoff.cs`: materialization uses only the core parser/resolution seam.
- `RhvacCandidateBuilder.cs`: conventions, simplification, and RHVAC room construction only.
- Parse/resolution tests moved to `TakeoffTsvTests`; RHVAC build/simplification tests remain in
  `RhvacCandidateBuilderTests`.

## LOC census

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `Rhvac/RhvacCandidateBuilder.cs` | 1,219 | 456 | -763 |
| `TakeoffTsv.cs` | 0 | 189 | +189 |
| `TakeoffResolutions.cs` | 0 | 610 | +610 |
| Production ownership files | 1,219 | 1,255 | +36 |
| `RhvacCandidateBuilderTests.cs` | 494 | 245 | -249 |
| `TakeoffTsvTests.cs` | 0 | 276 | +276 |
| Test ownership files | 494 | 521 | +27 |

## Gates

- Source compile: `Pe.Revit.Takeoff` passed with 0 warnings / 0 errors.
- Test assembly compile: passed; only pre-existing repository warnings were reported.
- Core FreshRevitProcess filter `FullyQualifiedName~TakeoffTsvTests`: **6 passed, 0 failed**.
- Binding FreshRevitProcess filter from the brief: **43 passed, 1 failed, 0 skipped, 44 total**.
  The failure is
  `TakeoffSpaceMaterializationTests.Boundary_network_straightens_shared_wall_without_an_area_preserving_dogleg`.
  It reproduces alone (**0 passed, 1 failed**) and both its test file and
  `SpaceBoundaryNetwork.cs` are unchanged from `HEAD`. P7 does not use that regularization path.
  The binding gate is therefore unreachable without expanding this behavior-preserving seam flip
  into an unrelated geometry change; no such semantic change was made.
- Committed replay TSV status: clean; no `eval/**/*.tsv` changes.
- Scoreboard: `python eval/rhvac/score-takeoff.py` reported **TOTAL SCORE 54.1** exactly.
- Core ownership grep: no `Rhvac` references in `RoomTakeoff.cs`, `SpaceMaterializer.cs`,
  `TakeoffTsv.cs`, or `TakeoffResolutions.cs`.
- Public op metadata/typegen paths: no diff under `source/Pe.Shared.HostContracts/` or
  `source/pe-tools/packages/host-contracts/`.

No replay fixture was regenerated and no commit was created.
