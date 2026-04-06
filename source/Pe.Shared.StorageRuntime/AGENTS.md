# Pe.Shared.StorageRuntime

## Scope

Owns shared settings storage/runtime infrastructure: module registration, settings document IO and validation, JSON composition, schema generation, type/schema bindings, and field-options/provider plumbing.

## Purpose

This package is the shared backbone for settings authoring and validation. It should provide explicit, type-safe storage and schema infrastructure that both host and Revit-side consumers can compose, while keeping capability boundaries clear between structural and live-document behavior.

## Critical Entry Points

- `Modules/SettingsModule.cs` and `Modules/SettingsModuleContracts.cs` — settings module contract surface.
- `Modules/SettingsModuleRegistry.cs` — central registration and duplicate-key guard.
- `Json/JsonSchemaFactory.cs` — authoring/editor/fragment schema generation pipeline.
- `Json/SchemaDefinitions/` — explicit schema-definition augmentation model.
- `Json/SchemaProviders/` — live/static field-options providers and option-context keys.
- `Documents/LocalDiskSettingsStorageBackend.cs` — filesystem-backed document IO.
- `Validation/SchemaBackedSettingsDocumentValidator.cs` — structural validation path.
- `Json/JsonTypeSchemaBindingRegistry.cs` — type binding and conversion registration.

## Validation

- Read the owning schema definition and binding registry before adding new metadata; there is already a strong explicit pattern here.
- Verify whether a change is structural, semantic, or live-document before choosing where to implement it.
- Keep schema/provider wiring testable through generated schema output when possible, not only through UI behavior.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **module** | A registered settings contract with storage/schema identity | Avoid using it for arbitrary feature folders |
| **schema definition** | Explicit per-type augmentation registered in `SettingsSchemaDefinitionRegistry` | Avoid describing this as generic attribute reflection |
| **field options** | Runtime option metadata/items for a specific property | Avoid using `examples` and field options interchangeably |
| **dataset** | Shared option source identified by dataset/projection metadata | Avoid inventing new per-module provider concepts when dataset wiring fits |
| **option context** | Sibling/context keys passed to field option resolution | Avoid ad hoc magic strings outside `OptionContextKeys` |

## Living Memory

- Prefer explicit schema definitions over scattering metadata assumptions across settings types.
- `JsonSchemaFactory` is the main pipeline truth: one-of handling, type bindings, includes/presets, then schema definitions.
- Collection item bindings are supported; if a property is a list/array, check item-type binding before adding custom special cases.
- `SettingsModuleRegistry` is intentionally idempotent only when the module key maps to the same settings type. Reusing a key for a different contract should fail fast.
- Host structural schemas and live-document field options are different concerns. Keep those seams obvious.
- When wiring autocomplete/LSP behavior, prefer dataset/projection metadata or existing providers before inventing a new provider.
