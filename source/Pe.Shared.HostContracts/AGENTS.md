# Pe.Shared.HostContracts

## Scope

Owns durable host-facing contracts: route constants, operation definitions, request/response/problem DTOs, the hand-maintained .NET client, the generated TypeScript client slice, scripting contracts, settings DTOs, and protocol versions.

## Purpose

`Pe.Shared.HostContracts` is the public contract package for callers that talk to `Pe.Host`. It defines stable HTTP, operation, scripting, settings, and bridge contract shapes without depending on host implementation or Revit runtime assemblies.

## Critical Entry Points

- `Protocol/HostProtocolContracts.cs` and `Operations/` - route and contract-version authority.
- `Operations/HostOperationsCatalog.cs` - public operation list plus the small TypeScript client catalog slice.
- `Operations/HostOperationContracts.cs` - operation metadata vocabulary used by Pea, CLI output, and future UI surfaces.
- `Scripting/` - scripting HTTP and bridge operation DTOs.
- `SettingsStorage/` - settings storage DTO contracts.
- `PeHostClient.cs` - hand-maintained .NET host client used by repo callers and scripts.
- `HostRuntimeDefaults.cs` and `HostReachability.cs` - shared host defaults and reachability helpers.
- `Bridge/` - private Host/Revit transport contracts and compatibility checks.

## Shared Language

| Term | Meaning |
| --- | --- |
| **operation family** | Top-level public operation area: `host`, `settings`, `script`, `revit`, `aps`. |
| **Revit layer** | Layer-first Revit operation segment such as `context`, `catalog`, `matrix`, `detail`, `resolve`, or reserved `apply`. |
| **domain noun** | User-facing Revit noun after the layer. |
| **cost tier** | Cheap/bounded/expensive/mutation operation metadata. |
| **single-flight group** | Metadata telling callers that operations share a serialized execution lane. |
| **supported active document kind** | Operation metadata/gating for whether a bridge-backed Revit operation supports project documents, family documents, or both. Keep this separate from request scopes such as selection, active view, explicit handles, or parameter presence. |
| **related operation** | Sparse practical adjacency to another operation: preflight, drill-down, fallback, or alternative. It is not a workflow graph. |

## Living Memory

- Keep contracts stable and explicit. Avoid host implementation services, caller-local route aliases, and Revit runtime dependencies here.
- Product names, executable names, env var names, default local URLs, and filesystem roots come from `Pe.Shared.Product`.
- Operation metadata is a compact routing/callability surface for Pea, CLI output, generated TypeScript, the hand-maintained .NET client, and future frontend views. It is not a workflow planner.
- Keys carry primary taxonomy. Keep Revit public keys layer-first as `revit.<layer>.<noun>[.<variant>]`; do not encode document kind as `rvt.*`, `rfa.*`, or `rvtrfa.*` route families.
- Keep taxonomy helpers such as family, domain noun, Revit layer, and derived read/mutate intent internal to scoring, filtering, codegen grouping, and validation. Do not echo them as public search-result fields when the key and safety summary already carry the signal.
- Metadata exists for search, safety gates, call formation, result expectation, and sparse practical related operations. Collapse search words into `SearchTerms`; do not grow overlapping tags/capabilities/question prose fields or repeated preflight prose. Keep the generated capability map as a table of contents for choosing a capability ladder: coarse row fields only, no DTO-shaped field summaries, examples, or related-operation prose. Generic bridge, active-document, validation, cost, and mutation rules belong in tool descriptions, deterministic failure handling, or harness validation.
- Public request contracts should validate strictly. Unknown or nonsensical fields should fail with actionable diagnostics rather than silently broadening or emptying results.
- Keep `CallGuidance` to at most 2 bullets and request examples to at most 2 unless an explicit gateway exception is validated. If an operation needs more prose to be usable, fix the operation/request shape.
- When project-standard parameter identity is uncertain, expose ranked parameter evidence with reasons; callers should pass observed `ParameterIdentity` values or `ParameterReference` objects into downstream detail or matrix requests.
- `PeHostClient` is hand-maintained by design. Add blessed namespaces/methods for stable high-value operations only; keep generic execution as the escape hatch.
- Host-client XML docs are an agent-facing contract. Keep docs concise and capability-oriented so normal C# hover can orient callers without a custom LSP proxy.
- Scripting requests default to `ReadOnly`; `WriteTransaction` is explicit mutation intent. Policy/rule implementation stays in `Pe.Shared.Scripting` or Revit adapters.
