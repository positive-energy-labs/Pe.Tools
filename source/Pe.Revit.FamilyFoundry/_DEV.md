# Pe.Revit.FamilyFoundry

## Mental Model

Family Foundry is an authored-workflow engine for family mutation and proof. Profiles describe intent, queues and operations execute that intent, snapshots prove what existed before or after, and compilers bridge compact authored models into runnable plans.

## Architecture

- `OperationSettings/` contains authored settings contracts.
- `OperationQueue`, `BaseOperation`, and `OperationGroups/` model executable work.
- `OperationProcessor` orchestrates family/project document execution, save/load, and snapshot collection.
- `FamilyProcessingContext` carries logs, snapshots, and proof-friendly state for one family run.
- `Capture/` and `Snapshots/` collect reverse-inference/proof data.
- `Resolution/` contains compilers and resolution helpers such as param-driven solids compilation.
- `SchemaDefinitions/FamilyFoundrySchemaDefinitions.cs` wires authored settings into shared schema/runtime metadata.

## Language In Code

- `profile` currently means the top-level authored settings document. Concrete examples are `FFManagerProfile` and `FFMigratorProfile`.
- `capture` currently has one explicit public family-side entrypoint: `Document.CaptureFamilySnapshot()` / `FamilyDocument.CaptureFamilySnapshot()` in `Capture/FamilySnapshotCaptureExtensions.cs`.
- `snapshot` currently means captured family state. Concrete examples are `FamilySnapshot`, `ParameterSnapshot`, `RefPlaneSnapshot`, and `ParamDrivenSolidsSnapshot`.
- `collect` currently means live query/capture substeps. In FF this is represented by `IFamilySnapshotCollector`, `IProjectSnapshotCollector`, `SnapshotCapturePipeline`, and classes such as `ParameterSnapshotCollector`, `LookupTableSnapshotCollector`, `ReferencePlaneSnapshotCollector`, and `ParamDrivenSolidsSnapshotCollector`.
- `projection` currently means deriving an authored target shape from captured state. Concrete examples are `Pe.Revit.FamilyFoundry.Profiles.FamilySnapshotProfileProjector` and `FamilyParamProfileAdapter.ProjectSnapshotsToProfile(...)`.
- `apply` currently means running authored settings through Family Foundry mutation pipelines. The main caller seams are the document-owned `ApplyFamilyProfile(...)` / `ApplyFamilyMigrationProfile(...)` extensions, which build `OperationQueue` plans and execute mutation operations such as `SetKnownParams`, `SetLookupTables`, `MakeParamDrivenPlanesAndDims`, `MakeConstrainedExtrusions`, and `MakeParamDrivenConnectors`.
- `create` does not yet exist as a stable caller-facing FF seam. Today it mostly appears inside lower-level helpers and operations such as `CreateProjectedFamilyDocument(...)`, `ConstrainedExtrusionFactory.CreateRectangle/CreateCircle(...)`, `RefPlaneDimCreator.Create...(...)`, and connector/schedule creation APIs.
- `spec` is currently overloaded:
  - authored reusable parts such as `AuthoredPlaneSpec`, `AuthoredSpanSpec`, `AuthoredPrismSpec`, `AuthoredConnectorSpec`
  - captured or legacy FF shapes such as `MirrorConstraintSnapshot`, `OffsetConstraintSnapshot`, `ConstrainedRectangleExtrusionSnapshot`, `ConstrainedCircleExtrusionSnapshot`
  - resolved execution shapes such as `SymmetricPlanePairSpec` and `OffsetPlaneConstraintSpec`
- `profile` and `spec` are also blurred outside FF less than before: `Pe.Revit.Global.Revit.Documents.Schedules.ScheduleProfile` is a persisted top-level authored profile, while schedule field/filter/sort/title parts remain `Spec` types.

## Current Naming Debt

- `SnapshotCollector` is the preferred noun. These classes collect snapshot fragments, not abstract "sections".
- `Snapshots/` currently mixes captured models and some legacy/replay-oriented spec types.
- `Capture/` vs `Snapshots/` is the intended conceptual boundary. `FamilySnapshot` and `ParameterSnapshot` are concrete snapshot models, while collector mechanics should stay under `Capture/`.
- `CapturedCollection<T>` is a provenance wrapper, not a domain snapshot in its own right. It is useful, but its name can obscure the fact that the real snapshot noun is the property type it wraps.
- `AuthoredParamDrivenSolidsSettings` is authored profile content, but its compiler output becomes execution settings like `ParamDrivenPlanesAndDimsPlan` and `ConstrainedExtrusionsPlan`. That is a real authored -> resolved-execution transition and should be described that way.
- `CmdFFManager`, `CmdFFMigrator`, and `CmdFFManagerProjectSnapshot` still expose the semantic mismatch most clearly: one command applies authored profiles, one captures and projects to profiles, and both depend on snapshot collectors whose names still read like low-level implementation details.

## Key Flows

### Authored profile execution

1. A profile is deserialized into authored settings.
2. Queue/group/operation builders turn that shape into executable work.
3. `OperationProcessor` opens the relevant family or family set.
4. Operations run with logging and optional snapshot collection.
5. Results, saved outputs, and logs become the proof surface.

### Capture, projection, and apply

1. Live collectors and family-document capture paths extract family state.
2. Captured snapshot output is adapted back into authored-friendly profile shapes when possible.
3. Apply-oriented tests rebuild profiles from that output and prove the runtime result.

### Param-driven solids

1. Compact authored solids describe semantic geometry intent.
2. Compiler/resolution code expands that intent into lower-level execution constructs.
3. Runtime operations mutate Revit only after compile/validation passes.

## Open Questions

- Decide whether `create` should become a first-class public FF verb or stay an implementation detail inside broader `apply` flows. Param-driven solids are the main pressure point because one authored apply can require both creating and updating family elements.
- Decide whether FF top-level authored profile types should eventually move into a `Pe.Revit.FamilyFoundry.Profiles` namespace instead of staying under settings-catalog manifests.
- Keep collapsing old rename-era traces of section-based capture language and reinforce the `Capture/` vs `Snapshots/` split without losing the useful distinction between captured state and lower-level collection mechanics.
- Reverse-inference should stay explicit about ambiguity rather than silently normalizing doubtful semantics.
- Keep deciding where schema/provider wiring belongs locally versus in shared runtime when new live-document surfaces appear.
