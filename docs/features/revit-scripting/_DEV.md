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

## Current Non-Goals

- no scripting SSE
- no async execution sessions
- no cancellation
- no multi-session scripting
- no multi-file execution
- no package/source-bundle execution
- no arbitrary external local file execution
