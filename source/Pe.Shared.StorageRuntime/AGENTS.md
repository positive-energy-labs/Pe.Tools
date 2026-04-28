# Pe.Shared.StorageRuntime

## Scope

Owns shared settings storage/runtime infrastructure: structural module descriptors, root bindings, settings document
IO and validation, JSON composition, schema generation, type/schema bindings, and field-options/provider plumbing.

## Purpose

This package is the shared backbone for settings authoring and validation. It should provide explicit, type-safe
storage and schema infrastructure that both host and Revit-side consumers can compose, while keeping capability
boundaries clear between structural and live-document behavior.

## Critical Entry Points

- `Modules/SettingsRuntimeContracts.cs` and `Modules/SettingsModuleContracts.cs` - structural module + root-binding contract surface.
- `Modules/SettingsRuntimeRegistry.cs` - central structural-module/root-binding registration and duplicate-key guard.
- `Json/JsonSchemaFactory.cs` - authoring/editor/fragment schema generation pipeline.
- `Json/SchemaDefinitions/` - explicit schema-definition augmentation model.
- `Documents/LocalDiskSettingsStorageBackend.cs` - filesystem-backed document IO.
- `Validation/SchemaBackedSettingsDocumentValidator.cs` - structural validation path.
- `Json/JsonTypeSchemaBindingRegistry.cs` - type binding and conversion registration.

## Validation

- Read the owning schema definition and binding registry before adding new metadata; there is already a strong explicit pattern here.
- Verify whether a change is structural, semantic, or live-document before choosing where to implement it.
- Keep schema/provider wiring testable through generated schema output when possible, not only through UI behavior.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **module** | A host-visible structural settings area with storage identity | Avoid using it for arbitrary feature folders |
| **root binding** | A typed runtime binding for one `(moduleKey, rootKey)` pair | Avoid collapsing this back to module-level typing |
| **schema definition** | Explicit per-type augmentation registered in `SettingsSchemaDefinitionRegistry` | Avoid describing this as generic attribute reflection |
| **field options** | Runtime option metadata/items for a specific property | Avoid using `examples` and field options interchangeably |

## Living Memory

- Prefer explicit schema definitions over scattering metadata assumptions across settings types.
- `JsonSchemaFactory` is the main pipeline truth: one-of handling, type bindings, includes/presets, then schema definitions.
- `SettingsRuntimeRegistry` is intentionally idempotent only when a structural module or `(moduleKey, rootKey)` pair maps to the same contract. Reusing a key for a different contract should fail fast.
- Host structural schemas and live-document field options are different concerns. Keep those seams obvious.
