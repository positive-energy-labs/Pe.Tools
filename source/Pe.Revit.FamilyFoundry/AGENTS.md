# Pe.Revit.FamilyFoundry

## Scope

Owns Family Foundry authored settings, operation queues, runtime operations, compile/apply helpers, snapshots, projections, and Family Foundry-specific schema definitions.

## Purpose

`Pe.Revit.FamilyFoundry` is the domain package for authored family-processing workflows. It should keep authored contracts, planning/compile steps, runtime operations, and diagnostics explicit and testable, while hiding low-level Revit mutation details behind predictable operations and helpers.

## Critical Entry Points

- `OperationProcessor.cs` — high-level queue execution across family/project documents.
- `FamilyProcessingContext.cs` — per-family processing state, logs, and snapshot helpers.
- `ProcessingResultBuilder.cs` — canonical FF run/family artifact model and output writing.
- `OperationQueue.cs` and `BaseOperation.cs` — authored execution plan and operation model.
- `OperationGroups/` and `Operations/` — reusable runtime mutation building blocks.
- `SchemaDefinitions/FamilyFoundrySchemaDefinitions.cs` — Family Foundry schema/provider wiring.
- `Capture/` and `Snapshots/` — snapshot capture entrypoints, collectors, portable structure, and apply/proof-oriented diagnostics.
- `Profiles/` — FF-owned authored profile contracts, manifests, and snapshot-to-profile projection seams.
- `Resolution/AuthoredParamDrivenSolidsCompiler.cs` — authored param-driven solids compile path.
- `Apply/DocumentFamilyProfileApplyExtensions.cs` and `Apply/FamilyProfileApplicator.cs` — document-owned apply verbs plus the shared runtime apply path.
- `OperationSettings/` — authored settings contracts used by profiles.
- `docs/features/family-foundry/_DEV.md` — cross-package output/transparency model and default debugging read order.

## Validation

- Prefer proving FF behavior with focused Revit-backed tests or snapshot/artifact comparison, not by inspection alone.
- When a fix changes runtime member shape, assume a Revit restart is required for trustworthy validation.
- For schema/autocomplete changes, verify both generated schema metadata and the runtime path that ultimately consumes the field.
- For FF runtime debugging, start with `run-summary.json`, then `family-report.json`, then `snapshot-diff.json` and `logs-detailed.json`.
- Treat `snapshot-diff.json` and projected snapshot-profile artifacts as primary verification surfaces; use raw snapshot files only after narrowing scope.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **operation** | One runtime mutation/action unit in the FF queue | Avoid calling whole workflows one operation when the queue/group distinction matters |
| **queue** | Ordered set of operations/groups passed to `OperationProcessor` | Avoid using it as a synonym for a single command |
| **param-driven solids** | The canonical authored/serialized semantic solids shape | Avoid referring to old low-level extrusion authoring as an equal peer model |
| **artifact manifest** | The per-family output map carried on `FamilyProcessingContext.Artifacts` | Prefer this over ad hoc “output files” wording when discussing FF transparency |
| **family report** | The per-family top-level proof packet entrypoint written as `family-report.json` | Open this before drilling into raw logs or snapshot payloads |

## Living Memory

- Use the FF debugging ladder before changing code:
  1. semantic/compiler validation
  2. authored profile/layout issue
  3. operation-time API/logic issue
  4. transaction-commit warning or failure-processing issue
  5. snapshot / reverse-inference / diagnostics issue
- Prefer adding targeted logs, snapshots, or proof artifacts over speculative fixes.
- Keep operations linear and debuggable. If nesting or orchestration gets hard to inspect, extract helpers or move logic up a level.
- Preserve the distinction between authored contracts, captured snapshots, derived projections, and compiled/runtime execution plans.
- Preserve the distinction between run-level artifacts, family-level artifacts, and snapshot-phase artifacts; output shape drift across commands is an FF architecture bug.
- Manager and Migrator should share the same artifact contract even when their authored profiles and queues differ.
- New FF features should define their proof surface as part of implementation:
  - which snapshot files should show the change
  - whether `snapshot-diff.json` should surface it
  - whether projected profile artifacts should reflect it
  - whether a compiled plan artifact is needed
- Favor specs as the reusable building blocks that authored profiles and captured snapshots compose, rather than duplicating similar shapes under `State`/`Model` names.
- Schedule/filter/provider wiring belongs in schema definitions unless there is a stronger shared-runtime reason to place it elsewhere.
- When validating geometry, connectors, or param associations, assert across multiple types/states so broken associations do not hide behind a single happy-path family type.
- Do not treat logs as the only audit surface when a stronger structural artifact exists.
- Explicitly state the assumed family orientation before authoring connector faces when docs are ambiguous.
- Distinguish air-path faces from service-connection faces and verify both against submittal/CAD views.
- For refrigeration equipment:
  - liquid line typically leaves the condenser and enters the evaporator
  - suction line typically leaves the evaporator and enters the condenser
  - condensate leaves the indoor unit only
- Prefer tests and docs that encode these patterns before adding stronger abstractions.
