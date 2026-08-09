# P8R Ring Repair Results

## Outcome

The mission is complete. `SpaceMaterializer` now repairs self-touching unresolved
raster rings by recursively splitting their closed walk at repeated vertices. Each
non-trivial simple sub-loop is converted to a `CurveLoop`; Revit first receives the
repaired outer loops together, then one FilledRegion per outer loop if it rejects
the combined boundary. Degenerate zero-area sub-loops are dropped. Holes are kept
on the combined attempt when they build successfully and are logged if they must be
dropped.

All FilledRegion elements produced for a repaired candidate receive the same owned
comments and unresolved graphic override. Accounting remains candidate-level: one
candidate increments `FilledRegions` exactly once even when Revit requires several
FilledRegion elements. A repair emits `[spaces] {id} ring repaired: ...`; only a
candidate that still cannot be repaired increments `FilledRegionFailures` and uses
the existing owned detail-line fallback.

## project-a Census

The FreshRevitProcess project-a Main Level test asserted this exact candidate-level
census:

| Spaces | Filled regions | Line fallbacks | FR failures | Rooms | Residues | Defectors | Deleted without replacement |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 72 | 2 | 2 | 72 | 3 | 9 | 0 |

Accounting held: `10 + 72 + 2 == 72 + 3 + 9 == 84`. Compared with P8, 29 of the
31 rejected candidates now render as FilledRegions; FilledRegion failures and line
fallbacks both fell from 31 to 2.

## Remaining FilledRegion Failures

| Candidate | One-line reason |
| --- | --- |
| R17 | Revit rejects the original boundary, and the outer ring contains no repeated vertex for the split repair pass. |
| R59 | Revit rejects the original boundary, and the outer ring contains no repeated vertex for the split repair pass. |

Both remain visible as owned outer-ring detail lines. Their logs include Revit's
invalid-boundary rejection and `ring repair failed: outer ring has no repeated
vertices`.

## Synthetic Regression

The idempotency fixture now includes `X02`, a pinched two-lobe raster ring whose
center vertex occurs twice. It proves the candidate materializes as one or more
owned FilledRegion elements, emits the repair log, contributes exactly one to the
candidate-level `FilledRegions` count, and contributes zero failures or line
fallbacks. The synthetic census is `2 Spaces / 4 FilledRegion candidates / 0 line
fallbacks / 0 FR failures / 3 rooms / 2 residues / 1 defector`.

## Gates

- Source compile: `dotnet build .\source\Pe.Revit.Takeoff\Pe.Revit.Takeoff.csproj -c Debug.R25` passed with 0 errors.
- Required FreshRevitProcess filter: `dotnet tool run pe-revit -- test fresh --filter "FullyQualifiedName~TakeoffSpaceMaterializationTests" --timeout-seconds 900 --json` passed 9 tests with 0 failed and 0 skipped; build, test, and close exit codes were 0.
- project-a target: 2 FilledRegion failures and 2 line fallbacks, below the binding maximum of 10.
- Candidate accounting invariant: asserted by both the synthetic and project-a document-backed tests without weakening.
- `git diff --exit-code -- '*.tsv'`: passed.
- `git diff --exit-code -- source/pe-tools/`: passed.
- `python eval/rhvac/score-takeoff.py`: printed `TOTAL SCORE 54.1` exactly.
- `git diff --check`: passed.

Detector, replay, resolution production code, fixture TSVs, `score-takeoff.py`, and
`source/pe-tools/` were not changed.
