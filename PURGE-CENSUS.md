# PURGE census — takeoff fresh-start worktree

Branch `worktree-takeoff-fresh`, base `909b76a`. Written after a diff-audit of the whole worktree
against `purge-mission.txt`, then a re-run of every binding gate. Nothing is trusted from memory:
each "pre-existing" claim below is proved by building/running the same thing at `909b76a` in a
detached worktree (`scratchpad/baseline`), removed afterwards.

Two of the four gates are red, both for reasons that reproduce unchanged at `909b76a`. Details and
the exact reproduction commands are in **Gates** at the bottom.

---

## VERIFY-THEN-DELETE

### C# — source/Pe.Revit.Takeoff + tests

| Item | State | Caller-verification evidence |
| --- | --- | --- |
| `StrictSpaceBoundaryNetwork.cs`, `StrictSpaceBoundaryNetworkCore.cs`, `Pe.Takeoff.Tests/StrictSpaceBoundaryNetworkTests.cs` | **done** | Repo-wide grep for `StrictSpaceBoundaryNetwork` returns zero hits in `source/`, `eval/`, `docs/`. The unrelated `SpaceBoundaryNetwork.cs` (no `Strict` prefix) survives and is still referenced. |
| `TakeoffPromotion.ApplyStrictNetwork`, `TakeoffPromotion.RejectUneditable` + their tests in `TakeoffPromotionTests.cs` | **done** | Grep for both identifiers: zero hits. `TakeoffPromotionTests.Keeps_orthogonal_room_and_rejects_triangle_whole` removed with them. `MoveToRejectedResidue` was kept — `ApplyFrameLocal` still calls it (proved by the clean Debug.R25 compile). |
| `SpaceMaterializer`: never-populated `defectors` list, `Defectors` accounting term, `DeletedWithoutReplacement`; `AccountingHolds` simplified | **done** | Grep for `Defectors\|defectors\|DeletedWithoutReplacement`: zero hits repo-wide. `SpaceMaterializationResult` is now `(Spaces, FilledRegions, LineFallbacks, FilledRegionFailures, Rooms, Residues)`; `AccountingHolds` is `Spaces + FilledRegions + LineFallbacks == Rooms + Residues`; the `DeletedWithoutReplacement != 0` throw-guard went with it. |
| `TakeoffSpaceMaterializationTests`: drop `Is.EqualTo((18, 65, 0, 0, 64, 2, 17))`, keep `AccountingHolds` | **done** | The exact-tuple assertion and its 2026-08-10 census comment are gone; `Assert.That(materialized.AccountingHolds, Is.True)` and the `ring repair failed:` assertion remain. The 4-room blank-doc tuple in `AssertMaterialization` was narrowed to `(4, 0, 0, 0, 4, 0)` to match the shrunk record — required, not gold-plating. |
| `PartitionFormulation.DumpDiagnostics` + its only caller `ProjectAReplayDumpRun.Dump_partition_diagnostics` | **done** | Grep for `DumpDiagnostics`: zero hits. `ProjectAReplayDumpRun.cs` survives in `source/Pe.Takeoff.Tests/` without that member. |
| `TakeoffSeedSource.DistanceMaxima` public enum member | **done** | Enum is now `{ RegionCores, Hybrid }`; the `TakeoffSeedSource.DistanceMaxima =>` switch arm in `PartitionFormulation.Run` is gone. The internal seeding is intact and still reachable: `SeedsFromDistanceMaxima` is called from `SeedsHybrid` (`PartitionFormulation.cs:481`, `:519`). Behaviorally inert for defaults — `TakeoffOptions.SeedSource` defaults to `RegionCores` (ordinal 0) both before and after. |
| `RoomTakeoff` dead verbs `Annotate`, `ExportEvidence`, `Cleanup`, `MaterializeSpaces` | **done** | All four wrappers gone from `RoomTakeoff.cs`. Surviving `RoomTakeoff.` callers are exactly the kept verbs: `Prepare`/`Detect` (`eval/rhvac/run-takeoff.py:64,68`, `RhvacTakeoffProbeTests.cs:58,62`), `AuditAndFinalize`, `PruneUneditableNative`, `ReadbackNative`, `LoadMaterializationResult`, `LoadResult`. |
| `RhvacProjectAEvalRun.Score_current_candidate` / whole file | **done** | `source/Pe.Revit.Tests/LibraryBehavior/NoDocumentRuntime/RhvacProjectAEvalRun.cs` deleted; grep for `RhvacProjectAEvalRun\|Score_current_candidate`: zero hits. |

**Noted, not deleted (out of mission scope):** `Annotate.ExportEvidence` and `Annotate.Cleanup` now
have zero callers repo-wide (grep confirms), stranded by the `RoomTakeoff` wrapper deletion. The
mission named only the facade verbs, so the `Annotate` class members were left alone. Follow-up
candidate.

### eval/rhvac

| Item | State | Evidence |
| --- | --- | --- |
| `score-takeoff.py`, `probe-score.py`, `probe-finecell.py`, `diag-partition.py`, `project-a/probe/` (4 files), `project-a/bluebeam/coverage.py`, `project-a/bluebeam/build-coverage-ledger.py`, `project-a/stale-rooms.json` | **done** | All staged deleted. Repo-wide grep for each filename returned only two survivors, both handled below. |
| `review.ps1`: remove the `score-takeoff.py --review-gate` step, keep audit → bundle → verify → seal | **done** | The `$structureDirectory`/`$scoreArgs` block is gone, the now-unused `-ProjectDirectory` param removed, and the exit code reduced to `exit $auditExit`. Grep for `ProjectDirectory` across `eval/`, `docs/`, `scripts/`, `source/Pe.Revit.Takeoff/`: zero hits, so no caller passed it. |
| `run-takeoff.py` trailing "next:" hint cited the deleted scorer | **finished by me — already done by predecessor** | Now prints the `review.ps1` invocation instead. |
| `project-a/oracle-geometry.json` `note` pointed at the deleted `stale-rooms.json` | **finished by me** | Deleted pointer from the prose `note` field (data untouched). It was the last dangling reference to a purged file. |

### web — source/pe-tools/apps/web

| Item | State | Evidence |
| --- | --- | --- |
| `routes/demo/tanstack-query.tsx` | **done, with a fix** | File deleted. **Fix applied:** the checked-in generated route table `src/routeTree.gen.ts` still imported the deleted module (21 lines of `DemoTanstackQueryRoute` wiring) — a stale artifact that would break any consumer reading it directly. Running `vp build` regenerated it; the resulting diff is exactly those 21 deletions and nothing else. Grep for `demo/tanstack-query\|DemoTanstackQuery` now returns zero hits repo-wide. |
| `plan-pane.tsx` geometry verbs `split` (2-click chord), `merge-into`, `claim-residue`, `promote`; keep accept/reject | **done, with a fix** | −279 lines. Remaining `split`/`claim` hits in the file are `levelName.split("/")` and the `unclaimed residue` legend chip. **Fix applied:** the predecessor's header-comment rewrite left a stray `*/ */` at line 12 — a hard parse error that made `vp check` abort before analysis. Corrected to `*/`. |
| `resolutions.ts`: `splitShape`, `mergeShapes`, `nearestOnRing`, `walkBetween` + their noding/loop-walk helpers; keep `applyResolutions` purity, anchor remap, orphan accounting | **done** | −510 lines. Exported surface is now `upsertResolution`, `applyResolutions`, `pendingFlags`, `loadStoredResolutions`, `storeResolutions`, `toResolutionsFile`, `provenanceMismatch`; private helpers are `pointInRing`, `pointInShape`, `sortHashes`, `storageKey`. Retired actions still parse but count as orphans rather than silently dropping. |
| C# mirror `TakeoffResolutions.cs`: delete `SplitShape`/`MergeShapes` and claim handling; keep accept/reject + anchor resolution + orphan counting | **done** | −461 lines. Sidecar parity holds: both twins accept `accept\|reject\|split\|merge\|claim-residue` in the vocabulary (so pre-pivot sidecars still load) and both increment `orphaned` for anything that is not accept/reject, with matching comments. |
| `types.ts` `KNOWN_FLAG_KINDS['open-plan-merge']`; `rooms-grid.tsx` zone column; `zoneNumber` in `BulkAssignPatch` | **done** | Flag entry removed (`low-evidence-boundary` and `seedless` remain). Zone sort key, header, bulk input, and grid cell all removed from `rooms-grid.tsx`; `BulkAssignPatch` in `editor.ts` is `{ systemNumber?: number }`. `RhvacRoom.zoneNumber` (the C#/TS DTO field) was deliberately left — it is real RHVAC data, mirrored by `RhvacRoom.cs:150`, and deleting it would break sidecar parity. |
| Fixtures: `project-a-main-four-verbs.json` → surviving verbs; delete `residue-claim-remap.json`; update consuming TSV/resolution tests; keep `sidecar-anchor-remap.json` + rank-reshuffle anchor tests | **done, with a fix** | Renamed to `project-a-main-two-verbs.json` (one accept, one reject — the name no longer lies); `residue-claim-remap.json` deleted and its `RESIDUE_FIXTURE` const removed from `takeoff.test.ts`. `sidecar-anchor-remap.json` kept, with its split/merge entries and `mergedFrom` expectation dropped and counts retuned to `{applied: 2, remapped: 0, orphaned: 1}`; the rank-reshuffle anchor tests survive. `TakeoffSpaceMaterializationTests.cs:264` follows the rename. **Fix applied:** the `square()` helper in `takeoff.test.ts` was orphaned by the `splitShape` test deletion and failed typecheck (`TS6133`); deleted. |

### TEST MOVE

**done.** All seven files are staged as renames (`R`) into `source/Pe.Takeoff.Tests/`:
`TakeoffReplayTests.cs`, `TakeoffTsvTests.cs`, `ProjectAReplayDumpRun.cs`, `RhvacEvalTests.cs`,
`RhvacCandidateBuilderTests.cs`, `RhvacRoomShapeTests.cs`, `RhvacMaterializationResolutionTests.cs`.

- **Revit-free verified:** `grep -rn "Autodesk" source/Pe.Takeoff.Tests/` returns zero hits.
- **Fixture-dir resolution verified working:** `RhvacEvalTests.FindFixtureDir` (now `internal` in the
  new assembly, called by `RhvacCandidateBuilderTests`, `RhvacMaterializationResolutionTests`,
  `TakeoffTsvTests`) walks up to `Pe.Tools.slnx` and resolves to this worktree's
  `eval/rhvac/project-a`. Proof: the 12 fixture-backed tests in those files pass under plain
  `dotnet test` with no Revit — they would throw `InvalidOperationException` on a bad walk.
- **Cross-assembly break repaired:** `TakeoffSpaceMaterializationTests` (still in `Pe.Revit.Tests`)
  used to call `NoDocumentRuntime.RhvacEvalTests.FindFixtureDir()`. It now carries its own private
  `FindFixtureDir` with the same `CallerFilePath` anchor walk. No project structure was hacked.
- `Pe.Takeoff.Tests.csproj` needed no edit — it globs sources and already references
  `Pe.Revit.Takeoff`. The seven files' remaining `NoDocumentRuntime` siblings (family/doc-shadow
  tests) stayed put, matching `Pe.Shared.Tests/AGENTS.md`.

### DOC-LINK FIXES

All four **done**, verified by a repo-wide grep for the stale targets:

| Site | Now points at |
| --- | --- |
| `source/Pe.Revit.Takeoff/Contracts.cs:6` | `docs/features/takeoffs/rhvac-and-mj-reference.md` |
| `source/Pe.Revit.Takeoff/Rhvac/RhvacRoom.cs:5` | `docs/features/takeoffs/rhvac-and-mj-reference.md` |
| `eval/rhvac/run-takeoff.py:11` | `source/Pe.Revit.Takeoff/README.md` |
| `TakeoffReplayTests.cs` (was `:240`) | `source/Pe.Revit.Takeoff/DECISIONS.md` |

`grep -rn "docs/context/\|PHASE2-PARTITION\|Rhvac/README.md"` over the worktree leaves only two
`docs/BUILD.md` hits (runtime-acceptance and automation-manifest paths) that are unrelated to the
takeoff purge and out of scope. `RoomTakeoff.cs:51` also carries the corrected
`docs/features/takeoffs/` link. The doc itself moved `docs/context/ → docs/features/takeoffs/`
(staged rename) and `docs/context/takeoff-learnings.md` is deleted.

---

## Gates

### Gate 1 — builds per CI (`.github/workflows/Compile.yml` runs Debug.R25, Debug.R23, Release.R25 over `Pe.Tools.slnx`)

| Command | Result |
| --- | --- |
| `dotnet build source/Pe.Revit.Takeoff -c Debug.R25 -v:q -nologo` | **PASS** — `Build succeeded. 0 Warning(s) 0 Error(s)`, 8.09 s |
| `dotnet build Pe.Tools.slnx -c Debug.R25 -v:q -nologo` | **PASS** — `99 Warning(s) 0 Error(s)`, 51.10 s (this is the gate for `Pe.Revit.Tests`, which CI builds only as part of the solution) |
| `dotnet build Pe.Tools.slnx -c Release.R25 -v:q -nologo` | **PASS** — `103 Warning(s) 0 Error(s)`, 2:01.87 |
| `dotnet build Pe.Tools.slnx -c Debug.R23 -v:q -nologo` | **FAIL — pre-existing** — `216 Warning(s) 11 Error(s)` |

The Debug.R23 (net48) failure is **not** caused by this purge. All 11 errors are net48 API gaps in
`Pe.Revit.Takeoff` files the purge did not touch — `SpaceBoundaryNetwork.cs` (`Array.Fill`,
`MinBy`, two-arg `GetValueOrDefault`, zero-arg `Coordinate.Copy`) plus `PartitionFormulation.cs:37`
(`double.IsFinite`, in code above every hunk this branch edits).

Reproduction at base: `git worktree add --detach <scratch>/baseline HEAD` then
`dotnet build source/Pe.Revit.Takeoff -c Debug.R23` → the identical 11 errors at the identical
line numbers. Baseline worktree removed after the check.

### Gate 2 — `dotnet test source/Pe.Takeoff.Tests -c Debug.R25`

**77 passed, 1 failed, 0 skipped, 78 total** (9 s). Every moved file contributes passing tests,
including the fixture-backed ones — the move is proven under plain `dotnet test` with no Revit.

The single failure is **pre-existing**:
`TakeoffReplayTests.Partition_flags_suspect_regions_without_changing_geometry`
(`TakeoffReplayTests.cs:378-388`) — the synthetic replay yields 0 rooms, so
`Assert.That(result.Rooms, Has.Count.EqualTo(2))` and `TotalSqft == 140` fail and
`result.Rooms.Single(r => r.RawSqft < 50)` throws `Sequence contains no matching element`.

Proof it predates the purge: at `909b76a` the same test still lived in `Pe.Revit.Tests`, where
`dotnet test` demands the `.Tests` configuration. Running
`dotnet test source/Pe.Revit.Tests -c Debug.R25.Tests --filter "FullyQualifiedName~Partition_flags_suspect"`
in the baseline worktree — i.e. through the ricaun Revit harness, in Revit 2025 — fails with the
same `System.InvalidOperationException: Sequence contains no matching element` at the same
assertion. So the move **exposed** a red test that the Revit-only lane was hiding; it did not
cause it. It is left failing rather than silenced: no `Assert.Ignore`, no deletion, no retuned
expectation. Fixing the partition semantics is a takeoff-behavior task, not a purge task.

**Tradeoff recorded:** this gate is honestly 77/78, not green. Making it green would require
either changing detector behavior (out of scope, and the purge must not move the numbers) or
weakening the assertion (dishonest).

### Gate 3 — web typecheck / build (`source/pe-tools/apps/web`)

`node_modules` was empty in this worktree; `pnpm install --prefer-offline` (1313 packages, all
reused from the store) ran first.

| Command | Result |
| --- | --- |
| `pnpm exec tsc --noEmit -p tsconfig.json` | **PASS** — exit 0, no diagnostics (after the `square` fix below) |
| `pnpm exec vp test` | **PASS** — `Test Files 17 passed (17) / Tests 93 passed (93)`, 3.7 s |
| `pnpm exec vp build` | **PASS** — `✓ built in 5.29s`, prerendered 1 page |
| `pnpm exec vp check` | **FAIL — pre-existing** — `Found formatting issues in 171 files` |

Two real defects surfaced here and were fixed:

1. `plan-pane.tsx:12` had a stray `*/ */`. `vp check` aborted with
   `x Unexpected token … Formatting failed before analysis started` — the previous run never got
   past parsing, so nothing about the web edits had actually been proven. Fixed.
2. `takeoff.test.ts` still declared the `square()` helper the deleted `splitShape` tests used:
   `error TS6133: 'square' is declared but its value is never read`. Deleted; typecheck went green.

`vp check` remains red on **formatting** across 171 files repo-wide. Six are under `src/rhvac`
(`assemblies.ts`, `cells.tsx`, `fixture.ts`, `room-detail.tsx`, `takeoff.ts`, `types.ts`) and only
`types.ts` is one this branch touched. Proof it is pre-existing drift and not purge damage: copying
the **base-commit** `types.ts` over the working copy and re-running `vp check src/rhvac/types.ts`
reports the same single formatting issue. (The working copy was restored immediately; its diff is
still exactly the intended 2-line deletion.) Running `vp check --fix` would rewrite 171 unrelated
files into this branch's diff, so it was not run.

### Gate 4 — this census

**done.**

---

## Summary of work this run

Finished/fixed by me (everything else was already complete and is verified above):

- `plan-pane.tsx` stray `*/ */` → parse error blocking the entire web lint/format lane.
- `takeoff.test.ts` orphaned `square()` helper → `TS6133` typecheck failure.
- `src/routeTree.gen.ts` still wired the deleted `demo/tanstack-query` route; regenerated via
  `vp build` (21 lines removed, nothing else).
- `project-a/oracle-geometry.json` prose pointer to the deleted `stale-rooms.json`.
- Ran every gate for the first time; established with base-commit reproductions that the two red
  gates (Debug.R23 net48 compile, `Partition_flags_suspect_regions_without_changing_geometry`) are
  pre-existing and that `vp check`'s formatting red is repo-wide drift.

Left undone, with reasons:

- **Debug.R23 net48 compile** — broken at base; repairing `SpaceBoundaryNetwork.cs` for net48 is a
  compat task, not a deletion, and would have put untouched code into a purge diff.
- **`Partition_flags_suspect_regions_without_changing_geometry`** — red at base under the Revit
  harness; a detector-semantics bug the test move newly makes visible.
- **`vp check` formatting** — 171 files repo-wide, 5 of the 6 `src/rhvac` offenders untouched by
  this branch and `types.ts` red at base too.
- **`Annotate.ExportEvidence` / `Annotate.Cleanup`** — newly caller-less, but outside the mission's
  named set; flagged above rather than deleted unilaterally.

`git add -A` staged. **Not committed.**
