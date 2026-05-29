# Pe.Host

## Scope

Owns the external host runtime: HTTP endpoints, settings SSE streams, host-side operation routing, schema delivery, filesystem-backed settings document workflows, host/runtime status and logs, APS auth HTTP operations, and the public scripting HTTP surface.

## Purpose

`Pe.Host` is the out-of-proc backend for Pe Tools frontends, CLIs, and deployed agent callers. It should stay focused on transport, structural storage/editor concerns, visible routing decisions, and bridge-backed or proxied Revit workflows.

## Critical Entry Points

- `Program.cs` - Kestrel startup, DI, settings SSE endpoint, bridge WebSocket route, and base URL binding.
- `Operations/HostOperationRegistry.cs` - operation registration and local-vs-bridge routing surface.
- `Operations/HostEndpointMapper.cs` - public HTTP route mapping from shared operation definitions.
- `Operations/HostOperationExecutor.cs` - raw DTO success responses and `ProblemDetails` failure shaping.
- `BridgeServer.cs` - private WebSocket bridge server, single-session registry, bridge request admission, and host-side bridge event handling.
- `Services/HostSettingsStorageService.cs` - open/save/validate/sync path for settings documents.
- `Services/HostSettingsModuleCatalog.cs` - host-visible module exposure from the registry.
- `Services/HostEventStreamService.cs` - settings SSE fan-out/freshness path.
- `../Pe.Shared.HostContracts/Operations/` - route/operation contract authority consumed by Host, .NET clients, and generated TypeScript Host clients.

## Validation

- Prefer verifying host changes without Revit first when the change is structural-only.
- If an endpoint depends on live document data, verify the failure mode when the bridge is disconnected as well as the happy path when connected.
- Schema generation here is `HostOnly`; do not assume FF semantic or live-document validation is available in-process.
- For public contract changes, verify the shared operation catalog, `HostOperationRegistry`, `PeHostClient`, and generated `pea` client slice stay aligned.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **host-only** | Structural behavior available without a live Revit document | Avoid implying smart/live options are available |
| **settings event stream** | `/api/settings/events` freshness SSE for document/session changes | Avoid using it for unrelated streaming workflows |
| **bridge-backed operation** | Public host operation forwarded over the private Host/Revit WebSocket bridge | Avoid describing live Revit data as host-local work |
| **operation catalog** | Shared typed host operation definitions in `Pe.Shared.HostContracts` | Avoid hand-maintained parallel route lists |
| **Revit operation layer** | Public `revit.<layer>.<domain>` hierarchy: context, catalog, matrix, detail, resolve, reserved apply | Avoid old `revit-data.*` naming in public Host output |
| **single-flight group** | Operation metadata telling callers that bridge-backed calls must not be parallelized | Use `revit` for the current single Revit bridge lane |
| **TypeScript client slice** | Small generated TypeScript Host client subset intentionally exposed to `pea` and future frontend consumers | Avoid encoding `pea` as the contract owner or exposing the whole host surface as tools by default |

## Living Memory

- Prefer host-side iteration when possible; unlike Pe.App, host work usually does not consume the active RRD session.
- `Pe.Host` is a headless local runtime. Do not grow host-owned WPF windows, update dialogs, or dual server/CLI entrypoint behavior here.
- Keep HTTP as the source of truth for request/response workflows.
- Map public HTTP routes from `HostOperationRegistry`; do not add one-off minimal API routes that bypass the shared operation catalog.
- Keep `/api/settings/events` focused on host/document freshness only, not route-level invalidation or scripting output.
- Supported deployed install is per-user. Installed host runtime binaries live under `%LocalAppData%\Positive Energy\Pe.Tools\bin\host\`.
- `Pe.Host` should not grow Revit-side fallback logic. If data needs the active document/thread, route it through the bridge.
- Public Revit routes should mirror layer-first operation keys, such as `/api/revit/context/summary`, `/api/revit/catalog/loaded-families`, `/api/revit/matrix/loaded-families`, `/api/revit/detail/elements`, and `/api/revit/resolve/references`.
- Bridge-backed routes assume exactly one connected Revit session and the active document as the only target.
- Bridge-backed requests are serialized at the host bridge; do not design callers around hidden host-side queuing or multi-session targeting.
- Public HTTP should return raw DTO payloads on success and `ProblemDetails` on failure. Do not reintroduce envelope-style wrappers.
- Every new endpoint is part of the effective agent tool budget. Add host surfaces sparingly and prefer a few durable contracts over one endpoint per raw Revit type or operation.
- The endpoint bar is not just "is this useful?" but "does this create a stable contract that hides meaningful Revit weirdness better than scripting or an internal helper would?"
- Prefer internal Revit-side helpers when mechanics repeat but the host contract is not yet stable. Prefer ad hoc scripting for exploratory and one-off live-document work.
- Prefer one general-purpose current-selection inspection surface over many domain-specific "selected X" endpoints. Specialize only when the stable job concept is broader than selection itself.
- Electrical is the first good specialization test here because panels, circuits, panel schedules, and panel templates carry richer operational semantics than a generic element lookup.
- Scripting is public through host HTTP and executes through the same private Host/Revit bridge as live document queries.
- Scripting v1 is sync-only and requires exactly one connected Revit bridge session.
- Scripting has no dedicated IPC listener. Do not reintroduce a second pipe/server between host callers and Revit.
- `GET /api/settings/session-summary` is the first health check for scripting. Verify host/bridge/session posture there before reading compile/runtime failures as code problems.
- First-pass scripting failures are often transport-state failures: host not running, bridge disconnected, zero sessions, or rejected session registration.
- Settings schemas are bridge-backed and root-scoped. If schema changes appear stale, verify the requested module key, root key, and connected Revit session before blaming the schema processors.
- `HostSettingsModuleCatalog` is registry-driven, so new manifests should surface here automatically once registered.
- When documenting the frontend contract, point to the concrete routes and DTOs this project actually exposes, not older refactor notes.
- `pea` consumes host facts and selected operations as deployed agent resources. Keep repo-local build, runtime sync, and operator affordances in `pe-dev` unless deliberately promoted through Host contracts.
