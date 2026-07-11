# Pe.Revit.Scripting

## Scope

Owns the Revit-side scripting runtime: workspace bootstrap, source normalization, dependency resolution, compile/load/execute, artifact output, and the bridge-dispatched `ExternalEvent` handoff.

## Purpose

`Pe.Revit.Scripting` turns inline snippets or workspace source files into a running `PeScriptContainer` inside Revit. Keep this package focused on execution mechanics; host HTTP, session management, and product prompting belong elsewhere.

## Critical Entry Points

- `Execution/RevitScriptExecutionService.cs` - normalize -> policy -> resolve -> compile -> load -> instantiate -> execute -> complete.
- `Transport/ScriptingBridgeMessageHandler.cs` - `ExternalEvent` handoff to the Revit thread.
- `Bootstrap/ScriptWorkspaceBootstrapService.cs` and `Bootstrap/ScriptFileTemplates.cs` - generated workspace shape and guidance.
- `References/ScriptReferenceResolver.cs` - script project reference/package resolution.
- `Execution/ScriptAssemblyLoadService.cs` - runtime assembly map and load context.
- `Storage/ScriptArtifactWriter.cs` - path-safe CSV/JSON/text artifacts under product output.
- `Context/RevitScriptContext.cs` and `Context/PeScriptContainer.cs` - script authoring surface.

## Validation

- Prefer focused scripting tests in `source/Pe.Revit.Tests/RevitScriptingPortTests.cs` before broad Revit runs.
- If the authoring contract changes, update `Bootstrap/ScriptFileTemplates.cs` in the same pass.
- AttachedRrd scripting uses assemblies already loaded in RRD. After runtime package edits, use SDK `pe-revit live` before live `pea script ...` validation; isolated `dotnet build` is not runtime freshness proof. Use Peco wrappers when Pea status/log hooks should accompany the proof.

## Shared Language

| Term                     | Meaning                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **inline snippet**       | Submitted source content compiled for one request outside workspace `src/`.                                       |
| **workspace path**       | A workspace-relative `.cs` file resolved under the host-created workspace.                                        |
| **Pod mode**             | The only workspace execution mode: validate root `pod.json`, compile all `src/**/*.cs`, and execute only a declared entrypoint. Workspaces without `pod.json` are rejected with bootstrap guidance. |
| **execution**            | One scripting request returning one final result payload.                                                         |
| **ReadOnly**             | Default permission mode; runs inside a rollback guard, so document changes are discarded and reported as a warning. |
| **WriteTransaction**     | Explicit mutation mode; this package opens one host-owned Revit transaction.                                      |

## Living Memory

- Workspace execution is Pod-only: `pod.json` is validated, the requested source must be a declared entrypoint, and the whole `src/` tree compiles together. A workspace without `pod.json` is rejected with guidance to run `scripting.workspace.bootstrap`.
- Each request must resolve to exactly one non-abstract `PeScriptContainer`.
- `ReadOnly` execution runs inside a document rollback guard: in-guard document changes are rolled back, discarded, and surfaced as a `readonly`-stage warning; only mutations that persist outside the guard fail the run at the `mutation-monitor` stage. `WriteTransaction` requires a writable active document and opens one host-owned transaction. Pod manifests never grant write permission; permission is request-owned.
- Static policy is now only the shared transaction rule; there is no ReadOnly semantic mutation analyzer. The rollback guard and mutation monitor are the ReadOnly guardrails.
- Script-authored `new Transaction(...)`, `new SubTransaction(...)`, and `new TransactionGroup(...)` are rejected by policy in both permission modes.
- `WriteLine(...)` is the short diagnostic path. `Artifacts.WriteJson(...)`, `WriteCsv(...)`, and `WriteText(...)` are for durable output.
- Inline snippets should stay isolated from broken workspace files and keep writing trace files for visibility.
- Keep generated workspace docs orienting. Specific operation guidance should come from operation metadata, diagnostics, and examples.
- Keep host concerns out of this package. HTTP routes, session gating, and host process management belong elsewhere.
