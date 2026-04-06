# Pe.Host

## Mental Model

`Pe.Host` is the external orchestration layer for settings authoring, structural document workflows, live Revit-backed queries, and agent-visible document access. It is the browser-facing and tool-facing surface; it is not a second in-process Revit runtime.

## Architecture

- `Program.cs` boots the HTTP/SSE host.
- HTTP is the main workflow surface for schema, discovery, open, validate, save, and bridged data requests.
- SSE is invalidation-only.
- settings modules come from the registry/catalog, not hardcoded host lists.
- structural schema/document work stays host-local.
- live document work crosses the Revit bridge and should stay visibly bridge-backed.

## Key Flows

- **Structural authoring**: host resolves a registered module, serves schema, opens/saves documents, and returns structural validation results.
- **Live Revit data**: frontend or tools still call the host; the host forwards live-document work through the bridge when connected.
- **Invalidation**: bridge emits document/host-status changes; host fans them out through SSE so clients invalidate queries and stale state.

## Open Questions

- How far the host should go in exposing agent-oriented Revit capabilities beyond transparent read/query access.
- Which document entities should become first-class host surfaces instead of remaining generic schema-driven shapes.
