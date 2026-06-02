# Family Foundry

## Mental Model

Family Foundry is not just an apply engine. It is an authored-workflow and proof system.

Profiles describe intent, queues execute that intent, snapshots capture what the family actually looked like, projections turn captured state back into authored/profile-shaped views, and pipeline-owned artifacts make those relationships inspectable.

## Architecture

- `Pe.Revit.FamilyFoundry` owns the top-level Manager and Migrator profile types, desired-state profile contracts, snapshot-to-profile projection code, queue construction, compiler/resolution, runtime operations, snapshot capture, and artifact writing.
- `Pe.Shared.StorageRuntime` owns generic settings infrastructure and storage/manifests primitives. FF-owned manifests/profiles live in `Pe.Revit.FamilyFoundry`, and schedule-owned manifests live in `Pe.Revit.Global`.
- `Pe.App` commands such as `CmdFFManager` and `CmdFFMigrator` should differ mainly in command shell behavior and queue/profile payload, not in parameter language or output shape.
- `Pe.Revit.Tests` should increasingly use the same artifacts as proof seams instead of relying on logs alone.

## Authored Profile Model

Family Foundry's external authoring model is declaration-first desired state. Hand authoring is a primary product goal: profile shapes should be flat, readable, table-friendly, and friendly to humans and agents editing JSON directly.

Durable authoring rules:

- Desired/declarative state is the only external parameter authoring model for Manager and Migrator.
- Legacy per-operation settings such as add-family-params, set-known-params, add-and-map-shared-params, and filter-APS-params are internal compiled execution details, not public profile options.
- Shared and local family parameters are authored in separate top-level declaration arrays.
- Parameter identity for family authoring is the parameter name. Revit family documents cannot contain duplicate family parameter names, so authored settings resolve by name and fail loudly on ambiguous or undeclared references.
- Shared parameter declarations may resolve richer APS/shared-parameter metadata internally, but authors should not need to provide shared GUIDs for ordinary FF work.
- Inline `Value` and `Formula` on parameter declarations are allowed for global assignments. They are mutually exclusive and compile into internal assignment settings.
- Per-type values stay centralized and table-shaped: one fixed `Parameter` column plus dynamic family-type columns.
- Mapping data includes remain supported for mapping-data only. Do not expand include support to param-driven solids until that API stabilizes.
- Shared-parameter bulk selection is named around shared-parameter selection, not APS filtering. Glob-ish include/exclude by exact name, prefix, and contains is the intended external language.
- `SourceNames` is authored as string names now, but the compiler boundary should be structured so future source references can carry optional metadata such as data type without breaking the authored model.
- Param-driven solids keep the `param:<token>` reference form. Nested parameter reference objects are not acceptable for this hand-authored surface, and only local family parameters may be compiler-synthesized for solids.

## Output Transparency Model

The canonical FF proof chain is:

`input profile -> operation plan -> pre snapshot -> post snapshot -> snapshot projections/diffs -> family report -> run summary`

Current artifact entrypoints:

- `run-summary.json`
- `family-report.json`
- `snapshot-diff.json`
- `parameter-events.json`
- `logs-detailed.json`

Current supporting artifacts:

- `input-profile.json`
- `profile-summary.json`
- `operation-plan.json`
- `desired-migration-plan.json` when a desired-state migrator profile is compiled
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
- `parameter-events.json`
- `input-profile-paramdrivensolids-plan.json` when authored solids are present

## Bulk Migration Verification Harness

The `Old_Template.rvt` bulk harness is the production-readiness proof lane for Family Foundry Migrator behavior. It should mutate only a test-owned project copy, never the checked-in source project, and should prove end state through artifacts rather than transient console output.

Proof ladder:

1. Generate synthetic Mechanical Equipment fixtures in Revit: a SetValue matrix family and a parameter metadata/state family.
2. Seed those fixtures plus selected real Mechanical Equipment families into the test-owned `Old_Template` copy.
3. Apply a test-only matrix migrator profile. Do not mutate the real BASE profile just to preserve synthetic harness parameters or alter cleanup behavior.
4. Assert required artifacts per family, especially `profile-summary.json`, `snapshot-diff.json`, `snapshot-parameters-post.json`, `parameter-events.json`, and `logs-detailed.json`.
5. Assert post-state from both snapshot artifacts and projected profile artifacts where useful.
6. Run final all-Mechanical-Equipment coverage through explicit partitions when the full 81-family lane is too slow for one autonomous proof.

Matrix dimensions intentionally covered:

- storage/data-type coercion across string, integer, yes/no, number, length, angle, voltage, and current-like values;
- global values, per-type values, formula-backed targets, blank-source fallback, and source-candidate ordering;
- local family parameters, shared family parameters, project-bound shared parameters, tooltip/description metadata, properties group, data type, instance/type, and shared GUID identity;
- generated family topology for labeled linear/angular/radial dimensions, labeled arrays, and one nested-family parameter association.

Association coverage is deliberately scoped. The matrix proves dimension labels, array labels, and nested-family parameter association because those are the SetValue/parameter surfaces currently needed by FF Manager and Migrator. Other associable Revit elements remain out of scope until product behavior needs them.

`parameter-events.json` should carry structured SetValue/coercion diagnostics in `Details` for mapping and per-type assignment events: mapping strategy, `CanMap`, source/target storage types, source/target data types, source value/value-string, source value CLR type, and target unit type. Console traces are not proof artifacts.

## Desired-State Compilation

Manager and Migrator profiles are external command shells over the same desired parameter language. The compiler resolves declarations, shared-parameter selection, mapping data, inline assignments, per-type table rows, and param-driven-solids references into an explicit reconciliation plan. Queue builders then lower that plan into internal operation settings for the existing execution layer.

Keep this boundary intact: do not expose cleanup/delete/sort/connector operation stacks as parameter authoring alternatives. Optional command overlays may remain where they represent command behavior, but per-operation parameter settings are not an external model.

Keep parameter ownership explicit. Family Foundry owns authored desired parameter intent, resolution provenance, and lowering into operation settings. `Pe.Revit.DocumentData` owns observed loaded-family matrix projections. Shared/public host DTOs may carry bounded observed parameter facts, but they should not become Family Foundry desired-state models. Common parameter descriptors should prove value inside document-owned Revit/Family Foundry seams before being promoted to public host contracts.

## Key Relationships

- Manager and Migrator should share one artifact contract.
- Desired-state profiles should stay declarative; compiled plans and lowered queues are the executable/debugging layers.
- Snapshots are a primary verification seam, not just an implementation detail.
- Projected snapshot profiles are evidence about capture/projection correctness, not merely convenience exports.
- Compiled plan artifacts are evidence about authored-to-runtime translation, not just debug leftovers.
- `parameter-events.json` is a standalone operation-local event stream for parameter/mapping decisions. It records what each operation decided or did through `Outcome` and `Reason` fields; it is not a lifecycle aggregator or final parameter-state reconciliation model.

## Reader Shortcut

If you are trying to understand an FF run quickly:

1. open `run-summary.json`
2. open `family-report.json`
3. read `snapshot-diff.json`
4. read `parameter-events.json` for parameter/mapping operation decisions
5. read `logs-detailed.json` for full human-readable operation messages
6. only then drill into full snapshot or projection files
