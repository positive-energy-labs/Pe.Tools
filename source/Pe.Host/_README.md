# Pe.Host

## Mental Model

`Pe.Host` is the local external boundary for browser, CLI, and agent callers. It owns HTTP, settings SSE, route registration,
local structural workflows, and the decision about whether a request can complete in-process or must cross the private
Host/Revit bridge.

The host is not a second Revit runtime. Anything that needs the active document, Revit thread, Revit-authored schema, or
script execution is a bridge-backed operation. Anything that is pure storage, process status, logs, auth, or structural
settings document work should stay host-local.

`Pe.Shared.HostContracts` is the contract authority. `Pe.Host` implements the catalog; `PeHostClient`, `pe-dev`, and
`pea` consume the same definitions instead of maintaining parallel route maps.

## Architecture

- `Program.cs` boots the HTTP/SSE host and DI graph.
- `HostOperationRegistry` composes local operations with shared bridge operation definitions and rejects contract drift.
- `HostEndpointMapper` maps every public HTTP operation from the registry; routes should not be hand-mapped elsewhere.
- `HostOperationExecutor` returns raw DTO payloads on success, `204` for null responses, and `ProblemDetails` for failures.
- `BridgeServer` owns the private WebSocket bridge, the single connected session snapshot, request admission, and bridge
  response correlation.
- `HostEventStreamService` owns `/api/settings/events`, which is only a host/document freshness stream.

## Public HTTP Areas

- host/runtime facts:
  - `GET /api/settings/host-probe`
  - `GET /api/settings/session-summary`
  - `GET /api/settings/logs`
- APS auth:
  - host-local status, login, logout, and access-token acquisition operations
- settings storage:
  - workspaces, tree discovery, document open, validate, save
- bridge-backed settings/Revit data:
  - schema and field options that require Revit-authored metadata
  - parameter, schedule, loaded-family, project-parameter-binding, element-context, document-session, and electrical
    inspection operations
- scripting:
  - script workspace bootstrap
  - synchronous script execution through Revit

## Key Flows

- structural settings work:
  - workspaces, tree, open, validate, and save stay host-local
  - structural validation is host-only; live-document or feature-semantic validation belongs in Revit-side bridge handlers
- bridge-backed live data:
  - host requires exactly one connected Revit session
  - host forwards requests into Revit without target-selection semantics
  - the active document is the only live-document target
  - bridge-backed requests are admitted one at a time; do not rely on host-side queuing for concurrent Revit work
- scripting v1:
  - callers hit `Pe.Host` HTTP, never a dedicated scripting IPC listener
  - host forwards one scripting operation over the private Host/Revit bridge
  - `Pe.Revit.Scripting` raises an `ExternalEvent`, executes on the Revit thread, and returns one final result payload
  - no scripting SSE, start/poll/cancel, or progressive-output contract exists yet
- agent/deployed client flow:
  - `pea` first asks host for status/session facts and host-owned paths
  - `pea` uses the generated TypeScript client slice for selected public operations
  - repo-local validation and runtime sync stay in `pe-dev`, not in the deployed agent model

## Response and Failure Shape

- Successful operations return the concrete DTO payload directly.
- Null operation responses return `204 No Content`.
- Expected user-actionable failures return `ProblemDetails`; validation-style failures can include `extensions.issues`.
- Unexpected host/runtime faults return `500 ProblemDetails`.
- Transport failures in clients should read as host reachability problems before compile/runtime failures.

## Contract Promotion Posture

New host endpoints are part of the effective tool budget for agents and frontends. Promote a host operation when it is a
stable repeated job concept, hides meaningful Revit awkwardness, or materially shrinks caller context. Prefer scripting or
internal Revit-side helpers for exploratory, one-off, or still-emerging shapes.

Initial durable live-document surfaces should favor broad context before narrow proliferation: host status/session facts,
document-session context, generic element-context queries, schedule projections, loaded-family/parameter inventories, and
small electrical contract families where the domain semantics are richer than raw Revit elements.

## Open Questions

- whether a future progressive scripting UX should use polling before SSE
- which live-document discoveries graduate from scripting into stable host operations after repeated use
