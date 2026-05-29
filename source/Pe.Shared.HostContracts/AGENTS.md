# Pe.Shared.HostContracts

## Scope

Owns durable host-facing contracts: HTTP route constants, host operation definitions, request/response/problem DTOs, the hand-maintained .NET client plus the generated TypeScript client slice, scripting contracts, settings storage DTOs, and protocol versions.

## Purpose

`Pe.Shared.HostContracts` is the public contract package for callers that talk to `Pe.Host`. It defines the stable shape of host HTTP behavior and websocket bridge mechanics. Besides the small bridge protocol convenience helper, this package knows nothing of host implementation details.

## Critical Entry Points

- `Protocol/HostProtocolContracts.cs` and `Operations/` - route and contract-version authority.
- `Operations/` - typed host operation definitions and the public `pea` client catalog slice; avoid caller-local route maps.
- `Scripting/` - scripting HTTP and bridge operation DTOs.
- `SettingsStorage/` - settings storage DTO contracts.
- `PeHostClient.cs` - hand-maintained .NET host client that repo callers and scripts consume directly.
- `HostRuntimeDefaults.cs` - fixed runtime/operator defaults for host probe/startup/bridge timing.
- `HostReachability.cs` - shared probe/session-summary reachability helpers.
- `Bridge/BridgeContracts.cs` - bridge request/response/event frame contracts.
- `Bridge/BridgeTransportSession.cs` - fragmented WebSocket text-frame reassembly, bounded frame reads, and serialized writes.
- `Bridge/HostProbeCompatibility.cs` - compatibility check tying host probe identity, Host protocol version, bridge protocol version, and bridge route together.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **operation family** | Top-level public operation area: `host`, `settings`, `script`, `revit`, `aps` | Avoid reviving `revit-data` as a public family |
| **Revit layer** | Layer-first Revit operation segment: `context`, `catalog`, `matrix`, `detail`, `resolve`, reserved `apply` | Prefer `revit.<layer>.<domain>` keys |
| **domain noun** | User-facing plural Revit noun after the layer, such as `schedules`, `loaded-families`, `elements`, `references` | Prefer plural user language over raw API class names |
| **result grain** | Metadata describing output shape: summary, catalog, matrix, detail, handles, rows, etc. | Use this to steer Pea/frontend rendering |
| **cost tier** | Cheap/bounded/expensive/mutation operation metadata | Prefer compact context/catalog/resolve before matrix/detail |
| **single-flight group** | Metadata that tells callers not to run bridge-backed operations in parallel | Use `revit` for the current bridge-backed Revit lane |

## Living Memory

- Do not recreate a separate host environment package. Product/process identity lives in `Pe.Shared.Product`; host HTTP + WS contract behavior lives here.
- Product names, executable names, env var names, default local URLs, and filesystem roots come from `Pe.Shared.Product`.
- Keep contracts stable and explicit. Avoid adding host implementation services, caller-local route aliases, or Revit runtime dependencies here.
- Public Revit operation keys and HTTP routes are layer-first: `revit.context.summary`, `revit.context.visible-summary`, `revit.resolve.references`, `revit.catalog.project-browser`, `revit.catalog.schedules`, `revit.catalog.loaded-families`, `revit.matrix.loaded-families`, `revit.detail.elements`.
- Operation metadata is canonical shared language for Pea, CLI output, generated TypeScript, the hand-maintained .NET client, and future frontend views. Do not move the glossary into a docs-only layer.
- Encode the canonical decision tree in metadata: exact host/session freshness -> `pe_status`; current Revit context -> `revit.context.summary`; visible active-view contents -> `revit.context.visible-summary`; broad semantic inventory -> `revit.catalog.project-index`; browser/navigation/provenance -> `revit.catalog.project-browser`; fuzzy reference -> `revit.resolve.references`; noun inventory -> `revit.catalog.*`; known thing rows/details -> `revit.detail.*`; coverage/join/audit/comparison -> `revit.matrix.*`; mutation/custom API gap -> scripting.
- Public request contracts should validate strictly. Unknown or nonsensical fields should fail with actionable diagnostics rather than silently broadening or emptying results.
- High-value operations should include canonical request examples for compact/default, filtered, and explicit-expansion calls when useful. Pea compact/hints output should be example-led; full request/response shapes are for `verbosity=full`.
- Keep compact defaults and budget metadata aligned with collector behavior. If null request budget means a cap in the collector, the operation examples and expansion hints should say how to raise `maxEntries`, `maxRowsPerEntry`, or `maxSamplesPerEntry`.
- `PeHostClient` is hand-maintained by design. Add blessed namespaces/methods for stable high-value operations only; keep `ExecuteAsync<TRequest,TResponse>` as the escape hatch.
- Keep the Project Browser surface compact: one `revit.catalog.project-browser` operation plus shared filter/provenance contracts in browser-owned domains. Do not add separate browser field-options, browser resolvers, or browser UI activation routes until repeated usage proves they earn the surface area.
