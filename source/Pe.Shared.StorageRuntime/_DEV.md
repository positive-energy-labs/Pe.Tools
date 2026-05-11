# Pe.Shared.StorageRuntime

## Mental Model

This package is the storage/runtime infrastructure layer. It gives the repo one explicit way to compose authored settings, runtime state, user output, JSON documents, schemas, validation, and smart field metadata without hardcoding every feature into the host or Revit command layer.

## Architecture

- `Modules/` defines settings-module identity, storage conventions, and registration.
- `ModuleStorage` and `GlobalStorage` compose authored settings, LocalAppData state, and user output roots.
- `StateStorage` owns mutable runtime state files; `OutputStorage` owns user-facing command artifacts.
- `Documents/` owns filesystem-backed authored settings document IO contracts.
- `Validation/` owns schema-backed structural validation.
- `Json/JsonSchemaFactory.cs` builds authoring/editor/fragment schemas through one pipeline.
- `Json/SchemaDefinitions/` adds explicit per-type metadata and UI/field-option wiring.
- `Json/SchemaProviders/` contains option providers and context keys.
- `JsonTypeSchemaBindingRegistry` maps CLR/Revit types onto JSON/editor-facing shapes.
- `JsonCompositionPipeline` expands include/preset directives for authored documents.

## Key Flows

### Schema generation

1. Raw schema is generated from the settings type.
2. Type bindings rewrite special CLR/Revit types.
3. Include/preset processors add composition support.
4. Schema definitions attach descriptions, UI metadata, datasets, and field options.
5. Editor transforms reshape the authoring schema for the external editor.

### Root composition

1. Authored settings resolve through `Pe.Shared.StorageRuntime` over `ProductUserContentLayout.Settings`.
2. Runtime state resolves through `ProductRuntimeLayout.State`.
3. User-facing command output resolves through `ProductUserContentLayout.Output`.
4. Legacy module-local `state` folders are migration sources only, not the current state root.

### Document open/save

1. Host or runtime resolves the module and document path.
2. JSON is loaded from disk.
3. Include/preset composition and schema synchronization run as needed.
4. Structural validation runs through the schema-backed validator.
5. On save, normalized JSON is written back with defaults pruned where applicable.

### Smart options

1. A property is wired through a dataset/projection or provider.
2. Context values come from sibling fields or external execution context.
3. Runtime mode decides whether the provider can execute.
4. Results are returned as structured field-option envelopes, not ad hoc arrays.

## Open Questions

- Keep watching whether some provider-based surfaces should collapse into datasets/projections for consistency.
- Keep the structural vs live-document seam obvious; hiding that distinction makes debugging harder.
