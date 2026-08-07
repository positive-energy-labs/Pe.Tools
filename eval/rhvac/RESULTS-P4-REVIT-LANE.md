# P4 Revit lane results (2026-08-07)

## Outcome

`RoomTakeoff.MaterializeSpaces` now applies the resolution sidecar before
`SpaceMaterializer.Replace`. It reuses `RhvacCandidateBuilder.ParseTsvDirectory` with
`simplify: false`; there is no second implementation of accept, split, merge, or reject.

The path convention is the existing host/export convention:

- `TakeoffOptions.ArtifactDir` is `<project>/takeoff` and contains `rooms_*.tsv`.
- The sidecar is `<project>/takeoff-resolutions.json`, beside the takeoff directory.
- No new path option was added.

Resolved shapes are adapted into `TakeoffResult`. Split children carry `SplitFrom`; merge
survivors carry `MergedFrom`. `SpaceMaterializer.SpaceComments` keeps `token|roomId` as the
first line and appends flags and provenance afterward, preserving owned-element cleanup.
Materialization logs `applied`, `remapped`, and `orphaned`; orphaned decisions emit an
uppercase warning and their unchanged rooms remain in the materialization input.

## Proof

Proof ran from a detached `HEAD` worktree containing only the P4 diff because a concurrent P3
residue change was active in the shared checkout.

- `pe-revit test fresh --filter "FullyQualifiedName~RhvacMaterializationResolutionTests"`
  - PASS: 1 passed, 0 failed, 0 skipped.
  - The committed four-verb project-a fixture produced the same ids, geometry, flags,
    provenance, and `{ applied: 4, remapped: 0, orphaned: 0 }` as the export builder.
- `pe-revit test fresh --filter "TakeoffReplayTests|RhvacCandidateBuilderTests|RhvacEvalTests"`
  - PASS: 37 passed, 0 failed, 0 skipped.
- Both Fresh runs rebuilt `Pe.Revit.Tests` successfully, so
  `TakeoffSpaceMaterializationTests` compiles.
- `git diff --check`: PASS.
- The isolated P4 diff changes no detector, TSV, or fixture file.

The existing `NuGet.Packaging` low-severity advisory remained the only build warning relevant
to these runs.

## Pending

Live Space-materialization parity is **PENDING**. No AttachedRrd, user-owned Revit document,
or live `TakeoffSpaceMaterializationTests` behavior was used as proof.
