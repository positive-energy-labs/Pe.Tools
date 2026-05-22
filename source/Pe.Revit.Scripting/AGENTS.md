# Pe.Revit.Scripting

## Scope

Owns the Revit-side scripting runtime: workspace bootstrap, project regeneration, source normalization, dependency
resolution, compile/load/execute, and the bridge-dispatched `ExternalEvent` handoff used by host and local Revit commands.

## Purpose

`Pe.Revit.Scripting` is the execution engine behind the scripting workflow. It should keep inline snippets and workspace-path execution stable and explicit while staying independent from host HTTP concerns.

## Critical Entry Points

- `Execution/RevitScriptExecutionService.cs` - orchestration for normalize -> resolve -> compile -> load ->
  instantiate -> execute -> complete.
- `Transport/ScriptingBridgeMessageHandler.cs` - `ExternalEvent` handoff from bridge request handling to the Revit thread.
- `Execution/ScriptOutputSink.cs` - buffered output capture for `WriteLine(...)` and `Console.WriteLine(...)`.
- `Execution/ScriptAssemblyLoadService.cs` - runtime assembly map and metadata-reference construction.
- `References/ScriptReferenceResolver.cs` - direct DLL and `PackageReference` resolution.
- `Bootstrap/ScriptWorkspaceBootstrapService.cs` - generated workspace file/layout policy.
- `Storage/RevitScriptingStorageLocations.cs` - canonical workspace/storage paths.

## Validation

- Prefer resolver and execution tests in `source/Pe.Revit.Tests/RevitScriptingPortTests.cs` before broad Revit test
  runs.
- If you change the supported authoring contract, update the generated workspace templates in
  `Bootstrap/ScriptFileTemplates.cs` in the same pass.
- AGENT GUIDANCE: AttachedRrd scripting uses assemblies already loaded in RRD. If runtime code changed, build the affected package-local outputs, then run `pe-dev sync` before `pea script ...`; an isolated `dotnet build` is not runtime freshness proof.

## Shared Language

| Term                 | Meaning                                                                                        | Prefer / Avoid                                                                       |
|----------------------|------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| **inline snippet**   | Submitted source content compiled for one request without touching workspace files             | Prefer this for fast probes; avoid relying on workspace state                        |
| **workspace path**   | A workspace-relative `.cs` file resolved under `Documents\Pe.Tools\scripting\workspace\<key>`                | Prefer this for the product path; avoid implying arbitrary local paths are supported |
| **strict**           | Default assembly posture using only explicit refs/packages/runtime defaults                    | Prefer this as the only supported authoring posture                                  |
| **execution**        | One scripting request that returns one final result payload                                    | Avoid using it as a synonym for a bridge session                                     |

## Living Memory

- Workspace execution compiles the whole `src/` tree and executes the selected file's single concrete `PeScriptContainer`. Bundle/package execution is future direction, not current behavior.
- Repo-local callers no longer implicitly prepare hot reload before script execution. Explicit runtime sync is required before live script validation after runtime package edits.
- Successful compile in `Strict` mode should imply runnable dependency availability. Do not collapse compile assets and
  runtime assets back into one flat list.
- `WriteLine(...)` is the preferred output path. `Console.WriteLine(...)` is compatibility only and should stay
  obviously second-class in docs and samples.
- Inline snippets should compile submitted source only, stay isolated from broken workspace files, and keep writing shared trace files for visibility/debugging/education.
- Each request must resolve to exactly one non-abstract `PeScriptContainer`. If discovery finds none or many, the
  request shape is wrong before the Revit API is.
- Live-document execution is transaction-backed here. Debug Revit-side mutation/rollback behavior in this package, not
  in host callers.
- The generated script workspace now needs both the scripting runtime surface and selected repo runtime assemblies. Keep the generated ambient usings and generated runtime references aligned with the actual supported script contract.
- Default script templates already include `Autodesk.Revit.DB.Electrical`; do not make first-pass probes add redundant
  usings unless the template changed.
- When probing panel schedules in R25, remember `PanelScheduleView.GetPanel()` and `GetTemplate()` return `ElementId`,
  not the element itself.
- Keep host concerns out of this package. HTTP routes, session gating, and host process management belong elsewhere.
- Scripting has no dedicated IPC listener. Frontend and CLI callers go through `Pe.Host`, which forwards scripting operations over the private Host/Revit bridge.
