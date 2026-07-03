# Pe.Shared.StorageRuntime

## Scope

Owns shared storage/runtime infrastructure over the product layout: structural module descriptors, root bindings, storage path composition, runtime state stores, user output stores, global settings/log storage, APS credential lookup, and small schema metadata contracts exported to host contracts.

## Purpose

This package is the shared backbone for C# storage identity and product-root composition. It should provide explicit, type-safe storage contracts that Revit-side consumers can compose while keeping authored settings, runtime state, user output, and live-document behavior distinct.

## Critical Entry Points

- `Modules/SettingsRuntimeContracts.cs` and `Modules/SettingsModuleContracts.cs` - structural module + root-binding contract surface.
- `Modules/SettingsRuntimeRegistry.cs` - central structural-module/root-binding registration and duplicate-key guard.
- `ModuleStorage.cs` and `GlobalStorage.cs` - composition over settings, runtime state, and user output roots.
- `ModuleDocumentStorage.cs` - C# storage identity for authored settings documents.
- `StateStorage.cs` and `OutputStorage.cs` - filesystem-backed runtime state and user output stores.
- `SettingsPathing.cs` and `SettingsDiscovery*.cs` - authored settings path discovery and bounded path normalization.
- `Json/` - JSON/CSV file wrappers plus directive marker attributes consumed by settings schema/runtime code.
- `Capabilities/` - small schema metadata contracts that are exported through host contract codegen.

Authored settings document open/save/validate/composition is TS-owned in `source/pe-tools/apps/host/src/settings.ts`. Revit schema generation, schema definitions, validation, type bindings, and field options live in `source/Pe.Revit.SettingsRuntime`.

## Validation

- Verify whether a change is storage layout, structural settings metadata, semantic schema behavior, or live-document behavior before choosing where to implement it.
- Keep filesystem/path behavior covered through narrow storage/path tests.
- Keep schema/provider behavior in `Pe.Revit.SettingsRuntime`; this package should not grow new schema pipelines.

## Shared Language

| Term                  | Meaning                                                                         | Prefer / Avoid                                                                  |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **module**            | A host-visible structural settings area with storage identity                   | Avoid using it for arbitrary feature folders                                    |
| **root binding**      | A typed runtime binding for one `(moduleKey, rootKey)` pair                     | Avoid collapsing this back to module-level typing                               |
| **schema definition** | Explicit per-type augmentation registered in `SettingsSchemaDefinitionRegistry` | Avoid describing this as generic attribute reflection                           |
| **field options**     | Runtime option metadata/items for a specific property                           | Avoid using `examples` and field options interchangeably                        |
| **state**             | Mutable runtime data under `%LocalAppData%\Positive Energy\Pe.Tools\state`      | Avoid writing state under authored settings except as a legacy migration source |
| **output**            | User-facing command artifacts under `Documents\Pe.Tools\output`                 | Avoid writing command output under authored settings modules                    |

## Living Memory

- Prefer explicit metadata contracts over scattering storage and schema assumptions across settings types.
- `SettingsRuntimeRegistry` is intentionally idempotent only when a structural module or `(moduleKey, rootKey)` pair maps to the same contract. Reusing a key for a different contract should fail fast.
- Host structural schemas and live-document field options are different concerns. Keep those seams obvious.
- `ModuleStorage` deliberately splits roots: authored settings under `Documents\Pe.Tools\settings`, runtime state under LocalAppData, and user output under `Documents\Pe.Tools\output`.
- Product root names belong in `Pe.Shared.Product`; storage runtime composes those layouts rather than defining its own roots.
