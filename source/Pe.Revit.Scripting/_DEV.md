# Pe.Revit.Scripting

## Mental Model

Think of this package as the Revit-side execution pipeline for inline snippets or a selected workspace source file plus one dependency declaration
surface. `Pe.Host`, the CLI, or a local Revit command may decide when execution happens; `Pe.Revit.Scripting` owns how
source becomes a running `PeScriptContainer`.

## Architecture

- bootstrap:
    - `ScriptWorkspaceBootstrapService` and `ScriptProjectGenerator` own the generated workspace shape and preserved
      `PeScripts.csproj` contract
- source normalization:
    - `RevitScriptExecutionService` turns either an inline snippet or a workspace-relative `.cs` path into a
      `ScriptExecutionPlan`
    - inline snippets stay isolated from workspace `src/` files but still persist shared trace files under `Documents\Pe.Tools\inline-scripts` for visibility/debugging/education
- dependency resolution:
    - `ScriptReferenceResolver` reads `PeScripts.csproj` and produces separate compile-reference and runtime-reference
      sets plus project-level ambient `Using` directives
- compile/load:
    - `ScriptCompilationService` compiles the normalized source set: submitted source for inline snippets, or the whole `src/` tree for workspace execution
    - `ScriptAssemblyLoadService` prepares metadata references and exact-name runtime assembly resolution
- bridge handoff:
    - `ScriptingBridgeMessageHandler` raises an `ExternalEvent` for bridge-dispatched scripting requests
- execution:
    - the engine finds exactly one non-abstract `PeScriptContainer`, assigns `RevitScriptContext`, and emits buffered
      output through `ScriptOutputSink`

## Key Flows

- workspace bootstrap:
    - resolve active Revit version and target framework
    - ensure product-home guidance files exist under `Documents\Pe.Tools`
    - create or refresh `Documents\Pe.Tools\workspaces\<key>`
    - regenerate `PeScripts.csproj`
    - preserve user DLL and package references
    - regenerate supported ambient `Using` entries and repo-runtime references such as `Pe.Revit.Scripting` and
      `Pe.Revit` when available
    - ensure `README.md`, `AGENTS.md`, `.vscode/settings.json`, and sample source
- host-backed execute:
    - caller hits `Pe.Host`
    - host forwards one scripting operation over the private Host/Revit bridge
    - `ScriptingBridgeMessageHandler` hands work to the Revit thread
    - the Revit thread returns one final result payload
- local Revit bootstrap/open:
    - Revit commands can still use the bootstrap/runtime pieces directly without going through host

## Validation Posture

- Plain terminal `dotnet build` now proves the isolated compile lane by default. It does not refresh the live Revit runtime assemblies.
- AGENT GUIDANCE: AttachedRrd scripting uses assemblies already loaded in RRD. If you edit runtime packages and want to validate through `pea script ...`, build the package-local interactive outputs first and run `pe-dev sync`; an isolated `dotnet build` is not runtime freshness proof.
- `pea script` no longer hides that runtime-sync step for you.

## Open Questions

- whether transaction policy needs to become a first-class authoring input instead of a runtime default
- how source-package sharing should reuse this pipeline without weakening the stable single-file lane
