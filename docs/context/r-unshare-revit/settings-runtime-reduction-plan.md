# Settings Runtime Reduction Plan

This note is the current saved context for the long-running settings/runtime simplification refactor.

It is intentionally orchestration-oriented. The point is to preserve the current mental model, the next recommended spike, and the explicit stop conditions so later implementation slices stay coherent.

## Checkpoint After Spikes 1 And 2

### What is now true

- `Pe.Shared.SettingsLayout` exists and owns neutral layout/path/global-settings helpers.
- `Pe.Shared.StorageRuntime` is now actually neutral and owns the structural/shared storage layer.
- `Pe.Revit.SettingsRuntime` now owns Revit-authored settings runtime behavior:
  - Revit-aware schema generation
  - field options
  - type bindings
  - schema-backed validation
  - schema sync
  - AutoTag settings runtime
- `Pe.Host` no longer generates Revit-authored schemas locally and now behaves as a structural host for schema routes.

### What got simpler

- The old lie that `Pe.Shared.StorageRuntime` was a shareable Revit-aware runtime is gone.
- The host/runtime boundary is much clearer.
- The biggest compile-pressure seam moved out of the shared layer and into a correctly Revit-owned package.

### What is still not resolved

- The module system is still carrying too much boundary responsibility.
- Host still learns modules through typed feature manifests.
- Schedules still exist in two authored/settings forms.
- `Pe.Shared.RevitProfiles` is still a transitional package rather than a durable conceptual one.

## First-Principles Reevaluation

### 1. The dominant remaining smell is no longer schema ownership

That problem was the right target for spike 2, and it is mostly solved.

The dominant remaining smell is now **module ownership**.

The repo still uses one abstraction family to carry two fundamentally different concerns:

- structural catalog/storage facts that host needs
- typed Revit runtime facts that only the Revit runtime needs

Those are not the same thing.

### 2. Host still depends on typed feature packages because the module abstraction is shallow

Current evidence:

- [HostSettingsModuleCatalog.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Host/Services/HostSettingsModuleCatalog.cs) still composes:
  - `StorageRuntimeSettingsModules.All`
  - `RevitSettingsRuntimeModules.All`
  - `RevitProfileSettingsModules.All`
  - `FamilyFoundrySettingsModules.All`
- [Pe.Host.csproj](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Host/Pe.Host.csproj) still references:
  - `Pe.Revit.SettingsRuntime`
  - `Pe.Revit.FamilyFoundry`
  - `Pe.Shared.RevitProfiles`

That means the host is still compile-time coupled to Revit feature/runtime packages even though it no longer owns their schema/runtime intelligence.

### 3. `ISettingsModuleManifest` still conflates structural and typed/runtime concerns

Current evidence:

- [SettingsModuleManifest.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.StorageRuntime/Modules/SettingsModuleManifest.cs) still requires:
  - `SettingsType`
  - `CreateStorageDefinition(SettingsRuntimeMode runtimeMode)`
- [SettingsModule.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.StorageRuntime/Modules/SettingsModule.cs) still treats module identity, storage options, host scope, active-document scope, and typed settings ownership as one unit.

First-principles read:

- host needs:
  - module key
  - roots
  - storage options
  - host scope
  - active-document kind
- host does not need:
  - settings type
  - Revit validator policy
  - typed schema/runtime ownership

The fact that host must depend on a typed manifest abstraction to do structural work is the clearest current design smell.

### 4. Schedules are still duplicated and still transitional

Current evidence:

- [Pe.Shared.RevitProfiles/Schedules/ScheduleManagerSettingsManifest.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.RevitProfiles/Schedules/ScheduleManagerSettingsManifest.cs)
- [Pe.Revit.Global/Revit/Lib/Schedules/ScheduleManagerSettingsManifest.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.Global/Revit/Lib/Schedules/ScheduleManagerSettingsManifest.cs)
- [SharedScheduleProfileAdapter.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.Global/Revit/Lib/Schedules/SharedScheduleProfileAdapter.cs)
- [DocumentScheduleProfileExtensions.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.Global/Revit/Documents/Schedules/DocumentScheduleProfileExtensions.cs)

There are still two first-class settings/profile shapes and two manifest paths for the same workflow.

This is still a real smell, but it is now a second-order smell compared with the module boundary issue.

### 5. The next spike should not be "merge more packages"

The next spike should be about making the next boundary real, not about package count as an end in itself.

Right now the next real boundary is:

- structural module catalog ownership
- versus
- typed Revit module/runtime ownership

If that split is not made first, deleting `Pe.Shared.RevitProfiles` or collapsing schedules will still leave host coupled to the wrong abstraction.

## Recommended Next Spike: Spike 3

### Split Structural Module Descriptors From Typed Module Manifests

### Goal

Make module ownership honest in the same way spike 2 made settings-runtime ownership honest.

After this spike:

- host should consume structural module descriptors
- Revit should consume typed module manifests
- one type should no longer try to serve both responsibilities

### Why this spike next

Because it is the cleanest remaining seam that unlocks almost everything else:

- host package decoupling
- removal of feature-package refs from host
- later deletion of `Pe.Shared.RevitProfiles`
- later schedule collapse

### What this spike is trying to prove

That host can operate on structural module metadata only, while Revit owns typed settings/runtime behavior separately.

If this works, the remaining refactor becomes much easier to reason about.

## Clear Goalposts

### Done means all of these are true

1. `Pe.Host` no longer references:
   - `Pe.Revit.SettingsRuntime`
   - `Pe.Revit.FamilyFoundry`
   - `Pe.Shared.RevitProfiles`
2. `HostSettingsModuleCatalog` no longer composes `ISettingsModuleManifest`.
3. Host storage/open/save/validate flows operate on a structural module descriptor/definition type that does not carry `SettingsType`.
4. `ISettingsModuleManifest` or its replacement is no longer the only module contract in the repo.
5. Structural module facts are shared from a neutral/shared layer:
   - module key
   - default root
   - roots
   - storage options
   - host scope
   - active-document kind
6. Typed Revit manifests are still used by `Pe.App` and Revit-side registration.
7. On-disk layout does not change:
   - module keys remain stable
   - root keys remain stable
   - include/preset policy remains stable
8. Host workspaces/tree/open/save/validate behavior remains intact.
9. No schedule model collapse happens in this spike.

### Done does not require

- deleting `Pe.Shared.RevitProfiles`
- deleting duplicate schedule types
- deleting `SharedScheduleProfileAdapter`
- changing schema route behavior again
- changing settings file layout

## Ordered High-Level Plan

### 1. Introduce a neutral structural module contract

Add a shared-neutral module descriptor type in `Pe.Shared.StorageRuntime.Modules` or another already-neutral shared surface.

It should describe only structural facts:

- `ModuleKey`
- `DefaultRootKey`
- `Roots`
- `StorageOptions`
- `HostScope`
- `ActiveDocumentKind`

It should not carry:

- `SettingsType`
- validator creation
- runtime-mode branching

### 2. Split typed manifests from structural descriptors

Create a typed manifest layer that wraps:

- the shared structural descriptor
- the settings type
- live-document validator/runtime policy

Typed Revit manifests should become a Revit/runtime concern again, not the thing host consumes.

### 3. Centralize the structural catalog in the shared layer

Move the structural definitions for host-visible modules into a neutral/shared location.

That catalog should include the current host-visible modules:

- global fragments
- AutoTag
- Schedule Manager
- Family Foundry manager
- Family Foundry migrator

Revit feature packages can still consume those descriptors when constructing typed manifests.

### 4. Update host to consume structural descriptors only

Rewrite:

- [HostSettingsModuleCatalog.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Host/Services/HostSettingsModuleCatalog.cs)
- [HostSettingsStorageService.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Host/Services/HostSettingsStorageService.cs)

So host builds its workspaces/catalog/storage definitions from structural descriptors only.

Host should no longer need typed settings manifests or feature packages just to browse and validate structural documents.

### 5. Remove host's feature/runtime package references

Once host depends only on structural descriptors, remove these project refs from [Pe.Host.csproj](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Host/Pe.Host.csproj):

- `Pe.Revit.SettingsRuntime`
- `Pe.Revit.FamilyFoundry`
- `Pe.Shared.RevitProfiles`

The target shape is:

- `Pe.Host`
  - `Pe.Shared.HostContracts`
  - `Pe.Shared.SettingsLayout`
  - `Pe.Shared.StorageRuntime`

and no Revit feature/runtime package refs.

### 6. Keep Revit registration typed

Revit-side module registration in [Application.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.App/Application.cs) should continue to use typed manifests for live-document/runtime-aware behavior.

The important change is not "remove typed manifests."

The important change is "stop making host consume them."

### 7. Stop

Do not broaden this spike into schedule deduplication.

If the host can consume structural descriptors only and drop the feature/runtime refs, the spike is complete.

## Why Not Collapse Schedules First

Because schedule duplication is no longer the first blocking boundary.

If schedules are collapsed first:

- host still depends on typed module manifests
- host still stays coupled to feature packages
- the shallow module abstraction still survives

That would remove some duplication, but it would not fix the next deepest architectural problem.

## Follow-On Spike: Spike 4

### Collapse Schedules And Delete `Pe.Shared.RevitProfiles`

### Goal

Pick one canonical authored schedule artifact and remove the transitional schedule package entirely.

### Recommended target shape

- canonical authored artifact:
  - `Pe.Shared.RevitData.Schedules`
- Revit execution model:
  - internal Revit-only types in `Pe.Revit.Global` only if still necessary

### Clear goalposts

1. `Pe.Shared.RevitProfiles` is deleted.
2. There is only one canonical schedule settings/profile artifact.
3. There is only one schedule module manifest path.
4. `SharedScheduleProfileAdapter` is deleted or reduced to one narrow boundary that no longer props up duplicate first-class settings models.
5. Host continues to see the same structural schedule module descriptor as before.

### Why this is easier after spike 3

Once host is off typed manifests, deleting `Pe.Shared.RevitProfiles` becomes a feature/data refactor instead of another host-boundary refactor at the same time.

## Residual Questions To Keep In Mind

### 1. Does `Pe.Revit.StorageRuntime` still deserve to exist after the module split and schedule collapse?

Do not answer this yet.

Revisit it after:

- host is off typed manifests
- schedule duplication is gone

Only then decide whether it should:

- merge into `Pe.Revit.SettingsRuntime`
- or stay as a smaller clearly named collector/data package

### 2. Should structural descriptors live in `Pe.Shared.StorageRuntime` or in a new smaller package?

Default answer for now:

- keep them in `Pe.Shared.StorageRuntime`

Reason:

- avoid adding another package unless the descriptor surface proves independently reusable enough to justify it

### 3. Should host eventually get its module catalog from the bridge instead of from compile-time shared descriptors?

Maybe, but not yet.

The next spike should first prove the simpler rule:

- compile-time shared structural descriptors
- runtime-side typed manifests

Only after that split is stable should dynamic bridge-backed catalogs be reconsidered.

## Current High-Signal Seams

- host typed-manifest coupling:
  - [HostSettingsModuleCatalog.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Host/Services/HostSettingsModuleCatalog.cs)
  - [Pe.Host.csproj](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Host/Pe.Host.csproj)
- shallow module contracts:
  - [SettingsModuleManifest.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.StorageRuntime/Modules/SettingsModuleManifest.cs)
  - [SettingsModule.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.StorageRuntime/Modules/SettingsModule.cs)
  - [SettingsModuleCatalogComposer.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.StorageRuntime/Modules/SettingsModuleCatalogComposer.cs)
- current structural-vs-typed split pressure:
  - [RevitSettingsRuntimeModules.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.SettingsRuntime/Modules/RevitSettingsRuntimeModules.cs)
  - [FamilyFoundrySettingsModules.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.FamilyFoundry/FamilyFoundrySettingsModules.cs)
  - [RevitProfileSettingsModules.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.RevitProfiles/Schedules/RevitProfileSettingsModules.cs)
- schedule duplication:
  - [ScheduleManagerSettingsManifest.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Shared.RevitProfiles/Schedules/ScheduleManagerSettingsManifest.cs)
  - [ScheduleManagerSettingsManifest.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.Global/Revit/Lib/Schedules/ScheduleManagerSettingsManifest.cs)
  - [SharedScheduleProfileAdapter.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.Global/Revit/Lib/Schedules/SharedScheduleProfileAdapter.cs)
  - [DocumentScheduleProfileExtensions.cs](/C:/Users/kaitp/source/repos/Pe.Tools/source/Pe.Revit.Global/Revit/Documents/Schedules/DocumentScheduleProfileExtensions.cs)

## Recommended Order From Here

1. Spike 3:
   - split structural module descriptors from typed manifests
   - remove host refs to typed Revit feature/runtime packages
2. Spike 4:
   - collapse schedule duplication
   - delete `Pe.Shared.RevitProfiles`
3. Spike 5:
   - reevaluate whether `Pe.Revit.StorageRuntime` still deserves to exist
   - simplify remaining module abstractions once the real boundaries are stable
