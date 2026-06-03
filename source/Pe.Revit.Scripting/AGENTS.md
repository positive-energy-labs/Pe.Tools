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
- `Policy/RevitReadOnlyMutationPolicyAnalyzer.cs` - Revit-semantic read-only mutation guardrails.
- `Execution/ScriptAssemblyLoadService.cs` - runtime assembly map and load context.
- `Storage/ScriptArtifactWriter.cs` - path-safe CSV/JSON/text artifacts under product output.
- `Context/RevitScriptContext.cs` and `Context/PeScriptContainer.cs` - script authoring surface.

## Validation

- Prefer focused scripting tests in `source/Pe.Revit.Tests/RevitScriptingPortTests.cs` before broad Revit runs.
- If the authoring contract changes, update `Bootstrap/ScriptFileTemplates.cs` in the same pass.
- AttachedRrd scripting uses assemblies already loaded in RRD. After runtime package edits, build package-local outputs from Rider/IDE and use dev-agent live-loop tooling before live `pea script ...` validation; isolated `dotnet build` is not runtime freshness proof.

## Shared Language

| Term | Meaning |
| --- | --- |
| **inline snippet** | Submitted source content compiled for one request outside workspace `src/`. |
| **workspace path** | A workspace-relative `.cs` file resolved under the host-created workspace. |
| **execution** | One scripting request returning one final result payload. |
| **ReadOnly** | Default permission mode; no host transaction is opened. |
| **WriteTransaction** | Explicit mutation mode; this package opens one host-owned Revit transaction. |

## Living Memory

- Workspace execution compiles the whole `src/` tree and executes the selected file's single concrete `PeScriptContainer`.
- Each request must resolve to exactly one non-abstract `PeScriptContainer`.
- `ReadOnly` execution does not open a Revit transaction. `WriteTransaction` requires a writable active document and opens one host-owned transaction.
- `ReadOnly` also runs Revit-specific semantic mutation policy before compile and subscribes to `Application.DocumentChanged` during execution. Treat the static policy as a curated first-pass blacklist and the event monitor as a loud dirty-document tripwire, not a rollback mechanism.
- Script-authored `new Transaction(...)`, `new SubTransaction(...)`, and `new TransactionGroup(...)` are rejected by policy in both permission modes.
- `WriteLine(...)` is the short diagnostic path. `Artifacts.WriteJson(...)`, `WriteCsv(...)`, and `WriteText(...)` are for durable output.
- Inline snippets should stay isolated from broken workspace files and keep writing trace files for visibility.
- Keep generated workspace docs orienting. Specific operation guidance should come from `PeHostClient` XML docs, operation metadata, diagnostics, and examples.
- Keep host concerns out of this package. HTTP routes, session gating, and host process management belong elsewhere.
