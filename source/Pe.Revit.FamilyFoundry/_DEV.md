# Pe.Revit.FamilyFoundry

## Mental Model

Family Foundry is an authored-workflow engine for family mutation and proof. Profiles describe intent, queues and operations execute that intent, snapshots prove what existed before or after, and compilers bridge compact authored models into runnable plans.

## Architecture

- `OperationSettings/` contains authored settings contracts.
- `OperationQueue`, `BaseOperation`, and `OperationGroups/` model executable work.
- `OperationProcessor` orchestrates family/project document execution, save/load, and snapshot collection.
- `FamilyProcessingContext` carries logs, snapshots, and proof-friendly state for one family run.
- `Snapshots/` and `Aggregators/Snapshots/` collect reverse-inference/proof data.
- `Resolution/` contains compilers and resolution helpers such as param-driven solids compilation.
- `SchemaDefinitions/FamilyFoundrySchemaDefinitions.cs` wires authored settings into shared schema/runtime metadata.

## Key Flows

### Authored profile execution

1. A profile is deserialized into authored settings.
2. Queue/group/operation builders turn that shape into executable work.
3. `OperationProcessor` opens the relevant family or family set.
4. Operations run with logging and optional snapshot collection.
5. Results, saved outputs, and logs become the proof surface.

### Snapshot and replay

1. Snapshot collectors capture family state.
2. Snapshot output is adapted back into authored-friendly shapes when possible.
3. Replay-oriented tests rebuild profiles from that output and prove the runtime result.

### Param-driven solids

1. Compact authored solids describe semantic geometry intent.
2. Compiler/resolution code expands that intent into lower-level execution constructs.
3. Runtime operations mutate Revit only after compile/validation passes.

## Open Questions

- Reverse-inference should stay explicit about ambiguity rather than silently normalizing doubtful semantics.
- Keep deciding where schema/provider wiring belongs locally versus in shared runtime when new live-document surfaces appear.
