# Pe.Revit.Scripting

## Scope

Owns the Revit-side scripting runtime: workspace bootstrap, project regeneration, source normalization, dependency resolution, compile/load/execute, and the internal scripting pipe endpoint used by host and local Revit commands.

## Purpose

`Pe.Revit.Scripting` is the execution engine behind the scripting lane. It should keep the supported single-file workspace flow stable and explicit while staying transport-agnostic from the product surface's point of view.

## Critical Entry Points

- `Execution/RevitScriptExecutionService.cs` - orchestration for normalize -> resolve -> compile -> load -> instantiate -> execute -> complete.
- `Transport/ScriptingPipeServer.cs` - direct named-pipe listener for single-shot scripting requests.
- `Transport/ScriptingPipeMessageHandler.cs` - `ExternalEvent` handoff from pipe thread to the Revit thread.
- `Execution/ScriptOutputSink.cs` - buffered output capture for `WriteLine(...)` and `Console.WriteLine(...)`.
- `Execution/ScriptAssemblyLoadService.cs` - runtime assembly map and metadata-reference construction.
- `References/ScriptReferenceResolver.cs` - direct DLL and `PackageReference` resolution.
- `Bootstrap/ScriptWorkspaceBootstrapService.cs` - generated workspace file/layout policy.
- `Storage/RevitScriptingStorageLocations.cs` - canonical workspace/storage paths.

## Validation

- Prefer resolver and execution tests in `source/Pe.Revit.Tests/RevitScriptingPortTests.cs` before broad Revit test runs.
- If you change the supported authoring contract, update the generated workspace templates in `Bootstrap/ScriptFileTemplates.cs` in the same pass.
- Build validation for this lane is currently `dotnet build Pe.Tools.slnx -c Debug.R25 /p:WarningLevel=0` when builds are allowed.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **inline snippet** | Posted raw source content executed without reading a workspace file | Avoid calling this the primary daily path |
| **workspace path** | A workspace-relative single `.cs` file resolved under `Documents\Pe.Scripting\workspace\<key>` | Prefer this for the product path; avoid implying arbitrary local paths are supported |
| **strict** | Default assembly posture using only explicit refs/packages/runtime defaults | Prefer this as the only supported authoring posture |
| **last inline file** | The persisted inline-snippet source at `.inline\LastInline.cs` under the workspace root | Prefer this over talking about transient in-memory snippets |
| **execution** | One scripting request that returns one final result payload | Avoid using it as a synonym for a bridge session |

## Living Memory

- The supported file lane is workspace-first and single-file only. Multi-file or manifest/package execution is future direction, not current behavior.
- Successful compile in `Strict` mode should imply runnable dependency availability. Do not collapse compile assets and runtime assets back into one flat list.
- `WriteLine(...)` is the preferred output path. `Console.WriteLine(...)` is compatibility only and should stay obviously second-class in docs and samples.
- Inline snippets should be normalized into `.inline\LastInline.cs` before execution so runtime behavior stays file-backed and debuggable.
- Keep host concerns out of this package. HTTP routes, session gating, and host process management belong elsewhere.
- The direct pipe is an internal transport detail. Frontend and CLI callers should go through `Pe.Host`.
