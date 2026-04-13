# Pe.Revit.Scripting

## Mental Model

Think of this package as the Revit-side execution pipeline for one supported source file plus one dependency declaration surface. `Pe.Host`, the CLI, or a local Revit command may decide when execution happens; `Pe.Revit.Scripting` owns how source becomes a running `PeScriptContainer`.

## Architecture

- bootstrap:
  - `ScriptWorkspaceBootstrapService` and `ScriptProjectGenerator` own the generated workspace shape and preserved `PeScripts.csproj` contract
- source normalization:
  - `RevitScriptExecutionService` turns either an inline snippet or a workspace-relative `.cs` path into a `ScriptExecutionPlan`
- dependency resolution:
  - `ScriptReferenceResolver` reads `PeScripts.csproj` and produces separate compile-reference and runtime-reference sets
- compile/load:
  - `ScriptCompilationService` compiles the normalized source set
  - `ScriptAssemblyLoadService` prepares metadata references and exact-name runtime assembly resolution
- transport:
  - `ScriptingPipeServer` accepts one local request
  - `ScriptingPipeMessageHandler` raises an `ExternalEvent`
- execution:
  - the engine finds exactly one non-abstract `PeScriptContainer`, assigns `RevitScriptContext`, and emits buffered output through `ScriptOutputSink`

## Key Flows

- workspace bootstrap:
  - resolve active Revit version and target framework
  - create or refresh `Documents\Pe.Scripting\workspace\<key>`
  - regenerate `PeScripts.csproj`
  - preserve user DLL and package references
  - ensure `README.md`, `AGENTS.md`, `.vscode/settings.json`, and sample source
- host-backed execute:
  - caller hits `Pe.Host`
  - host proxies one request over the internal scripting pipe
  - `ScriptingPipeMessageHandler` hands work to the Revit thread
  - the Revit thread returns one final result payload
- local Revit bootstrap/open:
  - Revit commands can still use the bootstrap/runtime pieces directly without going through host

## Open Questions

- whether scripting should eventually move from host-to-pipe proxying to first-class bridge operations
- whether transaction policy needs to become a first-class authoring input instead of a runtime default
- how source-package sharing should reuse this pipeline without weakening the stable single-file lane
