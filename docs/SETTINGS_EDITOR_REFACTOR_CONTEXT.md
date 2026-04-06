# Settings Editor Refactor Context

## Non-Negotiables

- Out-of-proc storage/editor capabilities remain. Local FS IO and frontend comm should stay out of the Revit process.
- Fragments/presets and reusable authored blocks remain. Do not simplify them away.
- Manual JSON editing UX matters. Opening a profile from the palette should keep `$schema` injection/schema sidecars fresh enough for JSON LSP in VS Code.
- The frontend must be able to fetch fresh schemas whenever it needs them.
- No backward compatibility constraints. Prefer the long-term maintainable shape.

## Current Pain

- Storage still has too many apparent entrypoints. `ComposableJson` and the older manager types still exist, but editor storage is centered on host + shared backend.
- Execution paths are muddled:
  - Host/editor path: `HostOperationRegistry` -> `HostSettingsStorageService` -> `LocalDiskSettingsStorageBackend`
  - Revit typed/preview path: `SharedModuleSettingsStorage.ReadRequired` -> backend snapshot -> typed deserialize -> FF-specific compile/queue validation in palette code
- Schema/provider metadata is split:
  - newer central definitions: `SettingsSchemaDefinitionRegistry`, `FamilyFoundryRootSchemaDefinitions`
  - older attribute/binding infrastructure still exists: `JsonTypeSchemaBindingRegistry`, `IncludableAttribute`, `PresettableAttribute`, Revit type bindings
- Host structural validation exists; FF semantic/business-rule preview validation is still Revit-side only.
- Shared providers are cross-domain concerns, but current placement makes settings feel too split across assemblies/TFMs.
- Legacy Revit-side storage surfaces still exist:
  - `ComposableJson`
  - `LocalManagers` / `GlobalManager`
  - older typed file/state/output helpers

## Accepted Simplifications

- Remove `RevitAssemblyOnly` as a supported capability target.
- Remove hybrid local-or-bridge field options.
- Host without Revit/bridge connected only needs to be usable with basic validation, not smart.
- Do not pull Revit-backed semantic/live validation into disconnected host right now.
- Keep datasets/projections/load-mode system for now unless it later proves unnecessary.

## Completed Simplifications

- Host is structural-only. Live Revit-backed behavior is bridge-only.
- `ComposeAsync` was deleted. Open-with-composed-content is the single read path.
- `SharedModuleSettingsStorageExtensions` was deleted; typed read now lives on `SharedModuleSettingsStorage`.
- The old central settings split was collapsed into local manifests + one registry.
- The three-part manifest stack was deleted:
  - `SettingsCatalogModule`
  - `SettingsSchemaRegistration`
  - `CatalogSettingsModule<T>`
- The descriptor leftovers were deleted:
  - `ISettingsModuleDescriptor`
  - `SettingsModuleDescriptor`
- Runtime capability modeling was collapsed to two modes:
  - `HostOnly`
  - `LiveDocument`

## Target Direction

- Split by capability seam, not by command/addin project.
- Domain assemblies keep domain-owned settings types and rules.
  - Example: `ProfileRemap` / `ProfileFamilyManager` should stay in `Pe.Revit.FamilyFoundry`.
- Shared provider implementations should live in shared capability packs, not per-addin.
- Central settings catalog should remain, but only as an exposure/selection layer for host/frontend, not as the place that owns all real schema/provider logic.
- Aim for one clear fidelity model:
  - structural: parse/compose/schema
  - semantic: cross-field/domain rules
  - live-document: active Revit doc/thread required
- Host should primarily own structural storage concerns:
  - pathing
  - document open/save/compose
  - schema injection/schema-sidecar freshness
  - structural validation
- Bridge should be the only route for live Revit-backed behavior.

## UX/Product Position

- Disconnected external editor only needs to provide a usable editor with basic validation and plain/manual inputs.
- Smart dynamic options and rich semantic validation are nice-to-have, not worth significant assembly/runtime complexity.
- Most users are expected to use the editor with Revit available; optimizing hard for fully smart disconnected usage is not a priority.

## Practical Implications

- Host validation today is structural only. FF preview/business-rule errors still surface through Revit palette preview, not host.
- Refactor should make this asymmetry explicit rather than hiding it behind hybrid capability paths.
- Prefer a small number of obvious orchestrator files after refactor. Current files to anchor against:
  - `source/Pe.Host/Operations/HostOperationRegistry.cs`
  - `source/Pe.Host/Services/HostSettingsStorageService.cs`
  - `source/Pe.Shared.StorageRuntime/Documents/LocalDiskSettingsStorageBackend.cs`
  - `source/Pe.Shared.StorageRuntime/Modules/SharedModuleSettingsStorage.cs`
  - `source/Pe.App/Commands/FamilyFoundry/FamilyFoundryUi/FoundryPaletteBuilder.cs`

## Design Bias

- Favor clarity over clever offline capability.
- Favor shared provider registries/provider keys over per-module concrete provider wiring.
- Favor fewer execution modes and fewer fidelity branches, even if some disconnected-host smartness is lost.
- Favor deleting legacy typed storage wrappers before merging assemblies.

## Best Next Deletes

- Delete `ComposableJson` by moving the remaining typed reads/writes to `SharedModuleSettingsStorage` / `LocalDiskSettingsStorageBackend`.
- Delete `LocalManagers` and `GlobalManager` by moving their surviving responsibilities into:
  - module-bound shared storage
  - small non-settings utility types for output/state if still needed
- Re-evaluate `Pe.Shared.StorageRuntime` vs `Pe.Shared.StorageRuntime` only after the legacy storage surfaces above are gone.
