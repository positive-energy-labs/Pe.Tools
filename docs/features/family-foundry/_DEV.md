# Family Foundry

## Mental Model

Family Foundry is not just an apply engine. It is an authored-workflow and proof system.

Profiles describe intent, queues execute that intent, snapshots capture what the family actually looked like, projections turn captured state back into authored/profile-shaped views, and pipeline-owned artifacts make those relationships inspectable.

## Architecture

- `Pe.Revit.FamilyFoundry` owns the top-level Manager and Migrator profile types, snapshot-to-profile projection code, queue construction, compiler/resolution, runtime operations, snapshot capture, and artifact writing.
- `Pe.Shared.SettingsCatalog` owns generic settings infrastructure, storage/manifests primitives, and non-FF settings modules.
- `Pe.App` commands such as `CmdFFManager` and `CmdFFMigrator` should differ mainly in authored entrypoint and queue/profile payload, not in output shape.
- `Pe.Revit.Tests` should increasingly use the same artifacts as proof seams instead of relying on logs alone.

## Output Transparency Model

The canonical FF proof chain is:

`input profile -> operation plan -> pre snapshot -> post snapshot -> snapshot projections/diffs -> family report -> run summary`

Current artifact entrypoints:

- `run-summary.json`
- `family-report.json`
- `snapshot-diff.json`
- `logs-detailed.json`

Current supporting artifacts:

- `input-profile.json`
- `profile-summary.json`
- `operation-plan.json`
- `snapshot-pre.json`
- `snapshot-post.json`
- `snapshot-parameters-{pre|post}.json`
- `snapshot-lookuptables-{pre|post}.json`
- `snapshot-refplanesanddims-{pre|post}.json`
- `snapshot-authoredparamdrivensolids-{pre|post}.json`
- `snapshot-authoredparamdrivensolids-plan-{pre|post}.json`
- `snapshot-profile-dense-{pre|post}.json`
- `snapshot-profile-empty-allowed-{pre|post}.json`
- `snapshot-parameters-diff.json`
- `input-profile-paramdrivensolids-plan.json` when authored solids are present

## Key Relationships

- Manager and Migrator should share one artifact contract.
- Snapshots are a primary verification seam, not just an implementation detail.
- Projected snapshot profiles are evidence about capture/projection correctness, not merely convenience exports.
- Compiled plan artifacts are evidence about authored-to-runtime translation, not just debug leftovers.

## Reader Shortcut

If you are trying to understand an FF run quickly:

1. open `run-summary.json`
2. open `family-report.json`
3. read `snapshot-diff.json`
4. read `logs-detailed.json`
5. only then drill into full snapshot or projection files
