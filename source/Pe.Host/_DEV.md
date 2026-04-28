# Pe.Host

## Mental Model

`Pe.Host` is the external transport boundary for browser/tool callers. It owns HTTP, settings SSE, route registration,
and the decision about whether work stays local, crosses the Revit bridge, or proxies to another local transport.

## Architecture

- `Program.cs` boots the HTTP/SSE host and DI graph.
- `HostOperationRegistry` is the host contract surface.
- host-local settings/document work stays in-process.
- live document queries go through `BridgeServer`.
- scripting is public through host HTTP, but the implementation currently proxies to `Pe.Scripting.Revit` over a local
  named pipe.
- `/api/settings/events` is the host/document freshness stream and is not part of the scripting lane.

## Key Flows

- structural settings work:
    - schema, workspaces, tree, open, validate, save
    - workspaces, tree, open, validate, and save stay host-local
    - Revit-authored schema and field option routes are bridge-backed
- bridge-backed live data:
    - host requires exactly one connected Revit session
    - host forwards requests into Revit without target-selection semantics
    - the active document is the only live-document target
    - success returns the raw DTO payload
    - expected user-actionable failures return `409 ProblemDetails`
- scripting v1:
    - host requires exactly one connected Revit bridge session
    - host sends one pipe request to `Pe.Scripting.Revit`
    - host returns one final result payload

## Open Questions

- whether scripting should eventually move from host-to-pipe proxying to first-class bridge operations
- whether a future progressive scripting UX should use polling before SSE
