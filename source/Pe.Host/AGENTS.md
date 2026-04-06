# Pe.Host

## Scope

Owns the external settings host: HTTP endpoints, SSE invalidation stream, host-side operation routing, schema delivery, and filesystem-backed settings document workflows.

## Purpose

`Pe.Host` is the out-of-proc backend for the settings editor. It should stay focused on structural storage/editor concerns and host transport, while delegating live Revit-backed behavior to the bridge and shared contracts/runtime packages.

## Critical Entry Points

- `Program.cs` — Kestrel startup, DI, CORS, SSE endpoint, base URL binding.
- `Operations/HostOperationRegistry.cs` — operation registration and routing surface.
- `Services/HostSettingsStorageService.cs` — open/save/validate/sync path for settings documents.
- `Services/HostSchemaService.cs` — schema caching and structural schema generation.
- `Services/HostSettingsModuleCatalog.cs` — host-visible module exposure from the registry.
- `Services/HostEventStreamService.cs` — SSE fan-out/invalidation path.
- `Services/LoadedFamiliesFilterSchemaDefinitions.cs` — host-owned special-case schema registration.

## Validation

- Prefer verifying host changes without Revit first when the change is structural-only.
- If an endpoint depends on live document data, verify the failure mode when the bridge is disconnected as well as the happy path when connected.
- Schema generation here is `HostOnly`; do not assume FF semantic or live-document validation is available in-process.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **host-only** | Structural behavior available without a live Revit document | Avoid implying smart/live options are available |
| **schema envelope** | The host response wrapper around generated schema data and issues | Avoid using it as a synonym for raw JSON schema |
| **event stream** | SSE invalidation channel exposed by the host | Avoid using it for request/response workflows |

## Living Memory

- Keep HTTP as the source of truth for request/response workflows and SSE as invalidation-only.
- `Pe.Host` should not grow Revit-side fallback logic. If data needs the active document/thread, route it through the bridge.
- `HostSchemaService` caches by module key. If schema changes appear stale, verify the requested module key and cache behavior before blaming the schema processors.
- `HostSettingsModuleCatalog` is registry-driven, so new manifests should surface here automatically once registered.
- When documenting the frontend contract, point to the concrete routes and DTOs this project actually exposes, not older refactor notes.
