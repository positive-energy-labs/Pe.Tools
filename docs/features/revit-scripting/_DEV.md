# Revit Scripting

`Pe.Tools` scripting is a workspace-first single-file lane with one public transport and one internal transport.

## Mental Model

- `Pe.Host` is the public scripting surface.
- `Pe.Scripting.Cli` and the frontend both call host HTTP.
- `Pe.Revit.Scripting` stays the execution engine.
- the direct `Pe.Scripting.Revit` named pipe still exists, but only as host-to-Revit transport.

## Cross-Package Shape

- `Pe.Shared.HostContracts`
  - DTOs, route constants, and scripting operation contracts
- `Pe.Host`
  - `POST /api/scripting/workspace/bootstrap`
  - `POST /api/scripting/execute`
  - single-session gate based on connected bridge sessions
  - sync proxy over the internal scripting pipe
- `Pe.Revit.Scripting`
  - workspace bootstrap
  - source normalization
  - dependency resolution
  - compile/load/execute
  - direct named-pipe server and `ExternalEvent` handoff
- `Pe.Scripting.Cli`
  - run-first terminal flow over host HTTP

## Supported Source Shapes

- `InlineSnippet`
- `WorkspacePath`

Default workspace root:

- `Documents\Pe.Scripting\workspace\<key>`

## Runtime Flow

1. caller posts to `Pe.Host`
2. host requires exactly one connected Revit bridge session
3. host forwards the request to `Pe.Scripting.Revit` over the local named pipe
4. `ScriptingPipeMessageHandler` raises an `ExternalEvent`
5. `RevitScriptExecutionService` resolves refs, compiles, loads, and runs
6. host returns final buffered output plus structured diagnostics

## First Probe Posture

- Start with `GET /api/settings/host-status`.
- Confirm `hostRunning=true` and exactly one connected bridge session before debugging script content.
- Use `POST /api/scripting/execute` first; it is the shortest live-document probe loop.
- Treat transport/session failures as more likely than compile failures on first contact.

## Execution Shape

- One request executes one non-abstract `PeScriptContainer`.
- Supported inputs are still just `InlineSnippet` and `WorkspacePath`.
- Inline snippets are persisted to `.inline\\LastInline.cs` before execution.
- `RevitScriptExecutionService` owns normalize -> resolve -> compile -> load -> instantiate -> execute.
- When a live document exists, execution is transaction-backed by the Revit-side runtime.

## Common Failure Modes

- host not running
- bridge disconnected
- zero connected bridge sessions
- more than one connected bridge session
- internal scripting pipe unavailable
- script compiled, but the wrong Revit/document context was inspected

## Useful Probe Facts

- The default generated script templates already include `Autodesk.Revit.DB.Electrical`.
- In R25, `PanelScheduleView.GetPanel()` and `GetTemplate()` return `ElementId`; callers must `doc.GetElement(...)`.
- A live probe can look wrong because of document/view state, not API failure. Panel-template edit mode was one real example.

## Current Non-Goals

- no scripting SSE
- no async execution sessions
- no cancellation
- no multi-session scripting
- no multi-file execution
- no package/source-bundle execution
- no arbitrary external local file execution
