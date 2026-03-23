# Host Storage Architecture Overview

## Goal

Refactor settings/storage so the **preferred execution path** is out-of-proc in
`Pe.Host`, while preserving a **transparent in-proc fallback** inside the Revit
add-in when the host is unavailable.

The design should optimize for:

- less blocking work on the Revit UI thread
- a richer browser editing experience without Revit running
- shared storage semantics across browser, host, and Revit
- resilience when the host crashes or is not running

## Core Direction

The system should stop treating the host as a separate one-off implementation
and instead treat it as the **preferred backend** for one shared storage
runtime.

That means:

- the host and the Revit add-in both consume the same shared storage/runtime
  code
- ordinary settings file IO, discovery, composition, fragment handling, and
  validation should default to the host
- the Revit add-in should automatically fallback to an in-proc backend when the
  host is dead or unavailable
- true Revit-only capabilities should remain capability-gated rather than being
  baked into the storage engine

## In-Proc vs Out-of-Proc Backend Management

The Revit add-in should not directly decide between raw filesystem codepaths at
every callsite. Instead, it should depend on a backend-neutral storage service.

Suggested shape:

- `ISettingsStorageBackend` or similar shared interface
- `HostStorageBackend` as the preferred backend
- `LocalRevitStorageBackend` as the transparent fallback backend
- `StorageBackendSelector` or `SettingsStorageRouter` inside Revit

Behavior:

- Revit-native workflows first attempt to use the host backend
- if the host is unavailable, unhealthy, times out, or crashes, the operation
  transparently falls back to the local in-proc backend
- browser workflows remain host-dependent and should not silently tunnel back
  through Revit
- fallback should be logged/observable, but should not make the add-ins unusable

This keeps:

- browser editing host-first
- Revit-native workflows resilient
- backend selection centralized instead of scattered

## Code Sharing Boundary

The long-term center of gravity should be a new shared runtime project, not
`Pe.Host.Contracts`.

Recommended project split:

- `Pe.Host.Contracts`
  - browser-visible DTOs
  - HTTP route constants
  - SignalR event names
  - logical file identity models
  - capability flags
- new shared runtime project, for example `Pe.Settings.Runtime` or
  `Pe.Storage.Runtime`
  - pathing
  - workspace/module/root metadata
  - storage discovery
  - composition
  - fragment/preset resolution
  - schema generation pipeline
  - validation pipeline
  - backend-neutral storage abstractions
  - provider abstractions and capability/context model
- Revit-specific layer
  - Revit context adapters
  - document/thread/transaction-aware providers
  - bridge-only enrichments

The practical intent is that almost all of
`source/Pe.Global/Services/Storage/` ends up in shared runtime form, but not
necessarily as a literal folder move with no restructuring. Any code that
assumes `DocumentManager`, active document access, or Revit thread affinity
should be isolated behind runtime interfaces/adapters.

## Modules, Pathing, and Storage Shape

Modules, roots, pathing, and identity should be defined once in shared runtime
and consumed by both backends.

The shared model should own:

- module identity
- logical roots per module
- default relative directories
- local vs global fragment/preset roots
- canonical document identity
- path normalization and path safety
- dependency closure rules

Canonical document identity should be:

- `moduleKey`
- `rootKey`
- `relativePath`

And the system can derive a stable convenience ID for caching and UI keys.

This shared pathing model must be the same whether the operation is executed by:

- host backend
- local Revit fallback backend
- browser-facing APIs

## Context-Aware Providers

Providers should move away from a binary “host vs Revit” distinction and toward
a capability-aware strategy model.

Suggested priority order:

1. valid Revit API context plus open document
2. valid Revit API context required
3. Revit assembly reference required
4. no Revit dependency required

This can be modeled with a strategy/context abstraction such as:

- `IProviderExecutionContext`
- `ISettingsRuntimeCapabilities`
- `IProviderStrategy`

The provider runtime should select behavior based on what is actually available
at execution time.

Examples:

- document-aware providers use the richest strategy only when live Revit context
  exists
- assembly-only providers can still work in host mode if Autodesk types/helpers
  are loadable and no live document is required
- host-safe providers always work
- when no valid Revit context exists, providers should degrade gracefully rather
  than crashing

Degraded behavior is acceptable for:

- reduced examples
- empty/fallback options
- less rich schema hints

But the degradation should be explicit in architecture and preferably visible in
capability flags so browser/revit clients understand the current fidelity level.

## Schema, Validation, and Revit-Bound Features

Schema generation and validation should move into the shared runtime and be
executed in the host by default, but with hybrid parity expectations.

Target state:

- validation is host-owned by default
- schema generation is host-owned by default
- provider-backed richness degrades gracefully when no live Revit context exists
- truly live Revit/document-sensitive features remain optional enrichments

The Revit bridge should still exist for features like:

- live document-derived options
- parameter catalogs
- any transaction/document-sensitive data gathering

The important architectural rule is:

- the storage/document backend should not depend on the bridge for ordinary file
  authoring
- the bridge should enrich the system with Revit-only capabilities when
  available

## Replacement For `ComposableJson`

`source/Pe.Global/Services/Storage/Core/Json/ComposableJson.cs` should stop
being the center of the architecture.

The replacement should be two things:

- a backend-neutral document/storage service for the actual runtime
- an optional compatibility wrapper during migration

Suggested direction:

- replace direct `ComposableJson<T>` ownership of file IO with a coarse-grained
  async document API
- keep pure composition/schema/validation logic in shared runtime
- move backend-specific file execution into `HostStorageBackend` and
  `LocalRevitStorageBackend`

Callsites in `source/Pe.Global/Services/Storage/Storage.cs` should gradually
stop returning concrete local file managers as the only path and instead expose
backend-aware entry points. A likely end state is:

- `Storage` becomes a runtime/service entry point rather than a thin local
  filesystem wrapper
- settings operations route through a backend selector
- old `SettingsManager`/`ComposableJson<T>`-style callsites can use adapters
  temporarily, but should not define the long-term model

In other words, the replacement for `ComposableJson` is not another file class.
It is a **document/backend service model** with optional adapters for older
callers.

## HTTP Backend Responsibilities

The host should expose a coarse-grained HTTP API sufficient for a fully
featured browser editor and for host-backed Revit operations.

At a high level, the host needs to expose:

- workspace/module/root discovery
- file tree discovery
- document open
- compose preview
- document save
- fragment open
- fragment save
- dependency metadata
- optimistic concurrency/version tokens

Suggested HTTP surface:

- `GET /api/settings/workspaces`
- `GET /api/settings/tree`
- `POST /api/settings/document/open`
- `POST /api/settings/document/compose`
- `POST /api/settings/document/save`
- `POST /api/settings/fragment/open`
- `POST /api/settings/fragment/save`

And SignalR should remain useful for:

- host status
- bridge/revit capability state
- file invalidation events
- document-sensitive invalidation events

The HTTP/document model should return enough metadata for a rich editor:

- canonical file identity
- raw authoring content
- composed/resolved content
- dependency list
- fragment/preset references
- version token for optimistic concurrency
- capability hints when behavior is degraded or bridge-backed

## Invalidation and Versioning

Both backends should use the same conceptual model for:

- document identity
- dependency closure
- version tokens
- stale/conflict detection

The host should own watcher/polling-based invalidation for normal host-backed
editing. The local fallback backend does not need identical transport behavior,
but it should preserve the same logical notions of:

- “this document is stale”
- “this save conflicts with newer state”
- “these dependencies changed”

That consistency matters if the system switches from host-backed execution to
fallback execution during a session.

## Fallback Philosophy

Transparent fallback is a product decision, not just a technical one.

The recommended model is:

- host-backed execution is preferred
- in-proc execution is a resilience path
- both use the same shared runtime rules
- browser remains host-dependent

This keeps add-ins functional if the host dies without forcing the browser model
to become more complicated than necessary.

## Migration Shape

The refactor should be driven by architecture extraction rather than by trying
to “move everything into the host” in one step.

High-level sequence:

1. Extract a shared runtime from storage/json/schema/pathing code.
2. Define a backend-neutral storage/document interface.
3. Implement host backend against HTTP plus invalidation.
4. Implement local Revit fallback backend using the same runtime.
5. Introduce backend selection inside Revit.
6. Refactor callsites away from direct local `ComposableJson` ownership.
7. Move schema/validation into shared runtime with capability-aware provider
   behavior.
8. Keep live Revit/document-sensitive enrichments bridge-backed or degraded as
   needed.

## Architecture Summary

The target architecture is:

- one shared storage/runtime engine
- one preferred out-of-proc host backend
- one transparent in-proc Revit fallback backend
- one capability-aware provider system
- one browser-facing HTTP/SignalR surface

This gives:

- faster normal Revit workflows by defaulting file work out of proc
- a much better browser editing experience without Revit running
- resilience when the host is unavailable
- less drift because host and fallback use the same storage/runtime rules
