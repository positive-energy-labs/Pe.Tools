# Pe.Host

## Mental Model

`Pe.Host` is the external transport boundary for browser/tool callers. It owns HTTP, settings SSE, route registration, and the decision about whether work stays local, crosses the Revit bridge, or proxies to another local transport.

## Architecture

- `Program.cs` boots the HTTP/SSE host and DI graph.
- `HostOperationRegistry` is the host contract surface.
- host-local settings/document work stays in-process.
- live document queries go through `BridgeServer`.
- scripting is public through host HTTP, but the implementation currently proxies to `Pe.Scripting.Revit` over a local named pipe.
- `/api/settings/events` remains invalidation-only and is not part of the scripting lane.

## Key Flows

- structural settings work:
  - schema, workspaces, tree, open, validate, save
  - no live Revit dependency
- bridge-backed live data:
  - host selects a bridge session and forwards the request into Revit
- scripting v1:
  - host requires exactly one connected Revit bridge session
  - host sends one pipe request to `Pe.Scripting.Revit`
  - host returns one final result payload

## Open Questions

- whether scripting should eventually move from host-to-pipe proxying to first-class bridge operations
- whether a future progressive scripting UX should use polling before SSE
