# Pe.Shared.StorageRuntime

## Mental Model

This package is the C# storage/runtime infrastructure layer. It gives the repo one explicit way to compose authored-settings identities, runtime state, user output, global settings/log files, APS credential lookup, and storage-related metadata without hardcoding paths into feature code.

## Architecture

- `Modules/` defines settings-module identity, storage conventions, and registration.
- `ModuleStorage` and `GlobalStorage` compose authored settings, LocalAppData state, and user output roots.
- `StateStorage` owns mutable runtime state files; `OutputStorage` owns user-facing command artifacts.
- `Documents/` defines the C# settings document DTOs still needed by Revit-side clients.
- `Json/` owns JSON/CSV storage wrappers and directive marker attributes consumed by settings schema/runtime code.
- `Capabilities/` contains small schema metadata contracts exported into host contracts.
- BCL compatibility helpers come from the SDK-injected `Pe.Bcl.Compat` package (`BclCompat`).

Authored settings document open/save/validate/composition is implemented in `source/pe-tools/apps/host/src/settings.ts`. Revit schema generation, schema definitions, validation, type bindings, and field options live in `source/Pe.Revit.SettingsRuntime`.

## Key Flows

### Root composition

1. Authored settings resolve through `Pe.Shared.StorageRuntime` over `ProductUserContentLayout.Settings`.
2. Runtime state resolves through `ProductRuntimeLayout.State`.
3. User-facing command output resolves through `ProductUserContentLayout.Output`.
4. Legacy module-local `state` folders are migration sources only, not the current state root.

### Module discovery

1. Revit-side packages register structural settings modules and root bindings.
2. `SettingsRuntimeRegistry` guards duplicate module/root keys.
3. The bridge exposes module descriptors and settings roots to the TS host.
4. TS host document operations use those descriptors to resolve storage options and settings document paths.

### Runtime files

1. Product state and output roots come from `Pe.Shared.Product`.
2. `StateStorage` and `OutputStorage` normalize filenames and directories.
3. Runtime callers consume JSON, CSV, text, and dated-output helpers from the storage wrappers.

## Open Questions

- Decide whether structural settings contracts should stay here long term or move to a smaller settings-contracts package if more non-storage consumers appear.
- Keep the structural vs live-document seam obvious; hiding that distinction makes debugging harder.
