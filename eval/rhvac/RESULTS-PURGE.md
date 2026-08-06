# LOC purge results

Date: 2026-08-06

Mission starting commit: `2fa634a`

Proof lanes: `Source compile` (`NoRrdContact`) and `FreshRevitProcess`

## Outcome

Tier 1 completed. `Detector.TraceLeak` was the only provably dead source found: it had no caller,
no eval/HANDOFF reference, and no environment-backed diagnostic lane. The sweep found no
declaration-only `TakeoffOptions` knob. The `Stock` / `PE_TAKEOFF_POLICY` falsification path and
the env-backed partition/snap diagnostic dumps remain intact.

Tier 2 was prototyped, failed the brief's real-snapshot cleanliness gate, and was fully reverted.
The detector output is not yet uniformly clean enough to replace `SpaceBoundaryNetwork` with a
grid-only welder. This is a detector finding; no materialization behavior was changed.

## Tier 1 proof

Before editing, all seven local snapshots replayed byte-identically to the committed fixtures.
After deleting `TraceLeak`, the combined fresh-process gate passed 27 tests with 0 failures and 0
skips (`ProjectAReplayDumpRun`, `TakeoffReplayTests`, and `RhvacCandidateBuilderTests`). The named
`TakeoffPartitionTests` class no longer exists: commit `49859d4` deleted that Regions-era test
with `PartitionRegularizer`; current partition behavior is covered by `TakeoffReplayTests`.

The suspect-flag change had landed before this mission. Fixture and replay outputs already contain
the `META\tflag` lines, so no modulo comparison was needed: every file was byte-for-byte exact.
After reverting the Tier 2 prototype, the explicit replay ran again in `FreshRevitProcess` (1/1,
0 skipped); all seven generated files were again byte-for-byte identical to the fixtures.

| Replay TSV | Bytes | SHA-256 | Result |
| --- | ---: | --- | --- |
| `rooms_Level_0_Lower_Level.tsv` | 574817 | `C1D812B1E22016DA5FF4998046865FE928974750E88EFED7CBBADEBB8D07D4C4` | identical |
| `rooms_Level_0_Theatre.tsv` | 14741 | `CF076AFCCBFF1D992C16B5C5993010C9D31E12115C9E13BE2463C8059D0782D2` | identical |
| `rooms_Level_1_Main_Level.tsv` | 639030 | `4A17EAE60B5AF173894CEA8769E46A9E20FD719F02F842306827EB6471977447` | identical |
| `rooms_Level_2_Upper_Level.tsv` | 493770 | `751EA70B2DAE9E23277DCD0ED7A4D04C72AAB65B23D68F0EBD8A48C94A306A93` | identical |
| `rooms_Level_3_Attic.tsv` | 335935 | `807AB7E6C88724D59BBBE4E43268872FE5B344222297BFCCB1B6EA2C9FAB29F6` | identical |
| `rooms_MAIN_LEVEL.tsv` | 42513 | `9492B00FE4883FF227B9C432EC53A7AF4A918638DDE34084A8681CFC59A8A741` | identical |
| `rooms_ROOF_PLAN.tsv` | 409 | `5020F419B315795756BE8A835EA11C3A928EB516324867BEF526C55C80E65826` | identical |

## Tier 2 stop evidence

A minimal prototype quantized detector polygons to the capture grid, unioned coincident collinear
edges once, preserved holes/flags, and dropped rooms with multi-cell disagreement. Its three new
NoDocumentRuntime checks passed in `FreshRevitProcess`; the source/test graph also passed the
separate `Source compile` lane.

The first real replay then failed on `Level 0/Lower Level:R27`:

| Evidence | Value |
| --- | ---: |
| polygon vertices | 296 |
| detector polygon area | 169.880852 sf |
| area after 0.25-ft grid quantization | 171.906250 sf |
| drift | +2.025398 sf / +1.192% |
| existing snap guard | 1.698809 sf (1%) |

`R27` is still mostly a 0.25-ft raster staircase with several off-grid snapped points. A
grid-only materialization welder therefore changes its area beyond the detector's own accepted
snap guard. Per the mission, Tier 2 stopped here rather than inventing another materialization
regularizer. The prototype and its tests were reverted.

`TakeoffSpaceMaterializationTests` passed the `Source compile` lane during the prototype build,
but Revit behavior parity was not run after the detector finding. Live materialization parity is
**PENDING** and is not claimed.

## LOC

Physical line counts for purge-touched production files, measured against the starting commit:

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `Detector.cs` | 271 | 240 | -31 |
| `Contracts.cs` | 181 | 181 | 0 |
| `SpaceBoundaryNetwork.cs` | 905 | 905 | 0 (Tier 2 reverted) |
| `SpaceMaterializer.cs` | 283 | 283 | 0 (Tier 2 reverted) |
| **Purge-owned total** | **1640** | **1609** | **-31** |

The `<= -700` target was not reached because its Tier 2 prerequisite failed. Concurrent unrelated
RHVAC editor/anchor work in the shared worktree is excluded from this purge delta.

## Next detector work

Make `BoundarySnap` either fully straighten `R27` within its 1% area guard or explicitly flag/drop
that detector proposal. Re-run the same seven-snapshot welder probe before attempting this purge
again; materialization should not compensate for the remaining staircase.
