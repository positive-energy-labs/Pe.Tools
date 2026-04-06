# Pe.Revit.FamilyFoundry

## Scope

Owns Family Foundry authored settings, operation queues, runtime operations, compile/replay helpers, snapshots, and Family Foundry-specific schema definitions.

## Purpose

`Pe.Revit.FamilyFoundry` is the domain package for authored family-processing workflows. It should keep authored contracts, planning/compile steps, runtime operations, and diagnostics explicit and testable, while hiding low-level Revit mutation details behind predictable operations and helpers.

## Critical Entry Points

- `OperationProcessor.cs` — high-level queue execution across family/project documents.
- `FamilyProcessingContext.cs` — per-family processing state, logs, and snapshot helpers.
- `OperationQueue.cs` and `BaseOperation.cs` — authored execution plan and operation model.
- `OperationGroups/` and `Operations/` — reusable runtime mutation building blocks.
- `SchemaDefinitions/FamilyFoundrySchemaDefinitions.cs` — Family Foundry schema/provider wiring.
- `Aggregators/Snapshots/` and `Snapshots/` — snapshot collection and replay-oriented diagnostics.
- `Resolution/AuthoredParamDrivenSolidsCompiler.cs` — authored param-driven solids compile path.
- `OperationSettings/` — authored settings contracts used by profiles.

## Validation

- Prefer proving FF behavior with focused Revit-backed tests or snapshot/artifact comparison, not by inspection alone.
- When a fix changes runtime member shape, assume a Revit restart is required for trustworthy validation.
- For schema/autocomplete changes, verify both generated schema metadata and the runtime path that ultimately consumes the field.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **profile** | Authored Family Foundry settings document | Avoid using it for collected runtime state |
| **snapshot** | Collected family/document state used for proof, replay, or diagnostics | Avoid using it as authored input terminology |
| **operation** | One runtime mutation/action unit in the FF queue | Avoid calling whole workflows one operation when the queue/group distinction matters |
| **queue** | Ordered set of operations/groups passed to `OperationProcessor` | Avoid using it as a synonym for a single command |
| **param-driven solids** | The canonical authored/serialized semantic solids shape | Avoid referring to old low-level extrusion authoring as an equal peer model |

## Living Memory

- Use the FF debugging ladder before changing code:
  1. semantic/compiler validation
  2. authored profile/layout issue
  3. operation-time API/logic issue
  4. transaction-commit warning or failure-processing issue
  5. snapshot / reverse-inference / diagnostics issue
- Prefer adding targeted logs, snapshots, or proof artifacts over speculative fixes.
- Keep operations linear and debuggable. If nesting or orchestration gets hard to inspect, extract helpers or move logic up a level.
- Preserve the distinction between authored contracts and compiled/runtime execution plans.
- Schedule/filter/provider wiring belongs in schema definitions unless there is a stronger shared-runtime reason to place it elsewhere.
- When validating geometry, connectors, or param associations, assert across multiple types/states so broken associations do not hide behind a single happy-path family type.
- Explicitly state the assumed family orientation before authoring connector faces when docs are ambiguous.
- Distinguish air-path faces from service-connection faces and verify both against submittal/CAD views.
- For refrigeration equipment:
  - liquid line typically leaves the condenser and enters the evaporator
  - suction line typically leaves the evaporator and enters the condenser
  - condensate leaves the indoor unit only
- Prefer tests and docs that encode these patterns before adding stronger abstractions.
