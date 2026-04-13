# Pe.Host

## Scope

Owns the external settings host: HTTP endpoints, settings SSE streams, host-side operation routing, schema delivery, filesystem-backed settings document workflows, and the public scripting HTTP surface.

## Purpose

`Pe.Host` is the out-of-proc backend for the settings editor and the public scripting surface for frontend/tool callers. It should stay focused on transport, structural storage/editor concerns, visible routing decisions, and bridge-backed or proxied Revit workflows.

## Critical Entry Points

- `Program.cs` - Kestrel startup, DI, settings SSE endpoint, and base URL binding.
- `Operations/HostOperationRegistry.cs` - operation registration and routing surface.
- `BridgeServer.cs` - named-pipe bridge server, session registry, and host-side bridge event handling.
- `Services/HostScriptingPipeClientService.cs` - sync proxy from host scripting endpoints to the internal Revit scripting pipe.
- `Services/HostSettingsStorageService.cs` - open/save/validate/sync path for settings documents.
- `Services/HostSchemaService.cs` - schema caching and structural schema generation.
- `Services/HostSettingsModuleCatalog.cs` - host-visible module exposure from the registry.
- `Services/HostEventStreamService.cs` - settings SSE fan-out/invalidation path.
- `Services/LoadedFamiliesFilterSchemaDefinitions.cs` - host-owned special-case schema registration.

## Validation

- Prefer verifying host changes without Revit first when the change is structural-only.
- If an endpoint depends on live document data, verify the failure mode when the bridge is disconnected as well as the happy path when connected.
- Schema generation here is `HostOnly`; do not assume FF semantic or live-document validation is available in-process.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **host-only** | Structural behavior available without a live Revit document | Avoid implying smart/live options are available |
| **schema envelope** | The host response wrapper around generated schema data and issues | Avoid using it as a synonym for raw JSON schema |
| **settings event stream** | `/api/settings/events` invalidation SSE for document and host-status changes | Avoid using it for unrelated streaming workflows |
| **scripting proxy** | Host-local sync forwarder from `/api/scripting/*` to `Pe.Scripting.Revit` | Avoid calling it a bridge operation |
## Living Memory

- Keep HTTP as the source of truth for request/response workflows.
- Keep `/api/settings/events` invalidation-only.
- `Pe.Host` should not grow Revit-side fallback logic. If data needs the active document/thread, route it through the bridge.
- Scripting is public through host HTTP even though execution still uses the internal scripting pipe.
- Scripting v1 is sync-only and requires exactly one connected Revit bridge session.
- `HostSchemaService` caches by module key. If schema changes appear stale, verify the requested module key and cache behavior before blaming the schema processors.
- `HostSettingsModuleCatalog` is registry-driven, so new manifests should surface here automatically once registered.
- When documenting the frontend contract, point to the concrete routes and DTOs this project actually exposes, not older refactor notes.
