# Pe.Revit.Scripting

## Scope

Owns the Revit-side scripting runtime: workspace bootstrap, source normalization, dependency resolution, compile/load/execute, artifact output, and the bridge-dispatched `ExternalEvent` handoff.

## Purpose

`Pe.Revit.Scripting` turns inline snippets or workspace source files into a running `PeScriptContainer` inside Revit. Keep this package focused on execution mechanics; host HTTP, session management, and product prompting belong elsewhere.

## Critical Entry Points

- `Execution/RevitScriptExecutionService.cs` - normalize -> policy -> resolve -> compile -> load -> instantiate -> execute -> complete.
- `Pods/ScriptPodPreparationService.cs` - pod capture gated on manifest and entrypoints only; member list, read, create, per-member `Compose`, and `@<id>` resolution by installed manifest id.
- `Pods/ScriptPodArchiveService.cs` - archive export (vendors foreign fragments into `settings/_vendor/<id>/`) and byte-exact import with `imported.json` provenance.
- `Pods/PodRuns.cs` - the one run shape: `<state root>\state\Runs\<pod-id>\<runId>\` with `receipt.json`, for every apply and every execution. A pod may sit in a shared home (ADR 0037), so a run writes no byte into it.
- `Transport/ScriptingBridgeMessageHandler.cs` - `ExternalEvent` handoff to the Revit thread.
- `Bootstrap/ScriptWorkspaceBootstrapService.cs` and `Bootstrap/ScriptFileTemplates.cs` - a pod's create-exclusive authored seeds, and the two per-machine files outside every home: `ProductPathing.MachinePropsPath` (the Revit and Pe references every pod's `PeScripts.csproj` imports) and the agent guide under `state\Agent`.
- `References/ScriptReferenceResolver.cs` - script project reference/package resolution.
- `Execution/ScriptAssemblyLoadService.cs` - runtime assembly map and load context.
- `Storage/ScriptArtifactWriter.cs` - path-safe CSV/JSON/text artifacts into the run `PodRuns` opens, beside that run's `receipt.json`.
- `Context/RevitScriptContext.cs` and `Context/PeScriptContainer.cs` - script authoring surface.

## Validation

- Prefer focused scripting tests in `dotnet/Pe.Revit.Tests/RevitScriptingPortTests.cs` before broad Revit runs.
- If the authoring contract changes, update `Bootstrap/ScriptFileTemplates.cs` in the same pass.
- Attached scripting uses assemblies already loaded in the dev session. After runtime package edits, restart the session through the SDK before attached `pea script ...` validation; isolated `dotnet build` is not runtime freshness proof.

## Shared Language

| Term                     | Meaning                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **inline snippet**       | Submitted source content compiled for one request outside workspace `src/`.                                       |
| **workspace path**       | A workspace-relative `.cs` file resolved under the host-created workspace.                                        |
| **Pod mode**             | The only workspace execution mode: validate root `pod.json`, compile all `src/**/*.cs`, and execute a captured src file. Workspaces without `pod.json` are rejected with bootstrap guidance. |
| **execution**            | One scripting request returning one final result payload.                                                         |
| **ReadOnly**             | Default permission mode; runs inside a rollback guard, so document changes are discarded and reported as a warning. |
| **WriteTransaction**     | Explicit mutation mode; this package opens one host-owned Revit transaction.                                      |
| **NoTransaction**        | Explicit mode where the script or called library owns its Revit transaction boundaries; the run is one unit, kept when the script returns and rolled back whole when it does not finish. |

## Living Memory

- Workspace execution is Pod-only: one captured snapshot is gated (manifest and entrypoints) before admission, the requested source must exist in the captured src tree, and the whole captured `src/` tree compiles together. Never re-read mutable workspace inputs after preparation.
- Each request must resolve to exactly one non-abstract `PeScriptContainer`.
- `ReadOnly` execution runs inside a document rollback guard: in-guard document changes are rolled back, discarded, and surfaced as a `readonly`-stage warning; only mutations that persist outside the guard fail the run at the `mutation-monitor` stage. `WriteTransaction` requires a writable active document and opens one host-owned transaction. Pod manifests never grant write permission; permission is request-owned.
- Static policy always rejects process/shell and unmanaged interop. It rejects script-owned transactions in `ReadOnly` and `WriteTransaction`; `NoTransaction` permits script/library-owned transaction boundaries. There is no ReadOnly semantic mutation blacklist. The rollback guard and document-bound mutation monitor are the ReadOnly guardrails.
- Every run that starts answers `changes` (element ids added, modified and deleted in its document, net over its commits, each list bounded to 2,000 with a total) and `failures` (every failure Revit raised, in Revit's words, with what became of its transaction). In `ReadOnly` the ids are what the run would have changed. The words come from `Pe.Shared.Scripting` `ScriptChangeLedger`, tested without Revit.
- A write run is one undo entry named `Pe script: <entrypoint>`: `WriteTransaction` is one transaction of that name, and `NoTransaction` runs inside a transaction group. The group is assimilated when the script returns, so what it committed stays. It is rolled back when the script throws, times out or is cancelled, so nothing it committed stays (owner ruling 2026-11-18): `changes.kept` is false, the lists are what it had committed, and the op's `touched` is `rolledBack`, because the runner tells every monitor window through `OperationMonitor.RolledBack` (Revit's rollback event names no commit). A script that keeps partial work catches its own errors and returns. Revit allows `EditFamily`, `LoadFamily` and saving another document inside that group, and refuses `Save` and `SaveAs` on the grouped document (fresh Revit 2025, 2026-11-14); a script whose own source calls one runs ungrouped and `changes.ungrouped` says why. A run Revit cannot roll back (ungrouped, or ended with a transaction open) keeps its commits when it fails, and `changes.summary` then starts "The script did not finish, and what it had committed is still in the model".
- When the run's caller is an agent (`ScriptRunScope.IsAgentRun`, the same reading the save hold uses), a Revit dialog or `TaskDialog` the script raises goes through the one dialog lane (`RevitDialogs.NoModal` in `Pe.Revit`, called in `ExecuteContainer`): it is answered, an unknown one with Cancel, the script goes on, and the result names the dialog id and the answer in a `dialog` warning. So a script Pea runs must not branch on a dialog's answer. A person's run (the palette runner, a human caller through the bridge) is not wrapped and shows its dialogs. The lane hooks `DialogBoxShowing` only: a window the script builds itself (WPF, WinForms) is not covered in any run.
- A script that ends with one of its own transactions still open fails the run, whether it threw or returned. Revit gives the run no way to end that transaction (FOOTGUN at `LeakedTransactionWords`), so the result says the document was left with a transaction open and names it from the source (`ScriptChangeLedger.LeakedWords`). Revit discards the open transaction when the run returns; what the script committed before it stays, and the journal holds the action as incomplete.
- A run is fenced to its target document: `SiblingFence` holds a transaction group on every other document that was open when the run started and rolls it back when the run ends, in every mode (fresh Revit 2025, 2026-11-14). What a script commits in such a sibling is discarded and reported in `changes.summary` and `failures`; a document the script opens itself stays writable. Revit refuses `Save` and `SaveAs` on a fenced sibling, and a refused save is explained by one sentence that names every hold of the run. A person's Redo in a sibling survives a run. A sibling Revit will not open a group on refuses the run by name. The host therefore asks for authority over the target alone (`admitScript`).
- Scripts are trusted in-process C# inside Revit, not an OS/process security sandbox. Keep the single Pea scripting surface autonomous; enforce document safety and resource bounds inside this runtime.
- Script-authored `new Transaction(...)`, `new SubTransaction(...)`, and `new TransactionGroup(...)` are rejected by policy in `ReadOnly` and `WriteTransaction`, and permitted only in explicit `NoTransaction` mode.
- `WriteLine(...)` is the short diagnostic path. `Artifacts.WriteJson(...)`, `WriteCsv(...)`, and `WriteText(...)` are for durable output.
- One output convention: an execution writes `state\Runs\<pod-id>\<runId>\` under the machine state root, keyed on the pod's manifest id, with `receipt.json` beside its artifacts, through the same `PodRuns` shape every apply uses. An inline snippet acts from no pod, so its run lands in `Runs\_no-pod`. The run owns `receipt.json`; a script artifact may not take that name.
- The host names a pod's absolute folder (`pod.capture` `directory`, by manifest id). Native code never joins a folder name onto the user's Pods to find one; only a pod that does not exist yet is placed by name, in the user home.
- Inline snippets should stay isolated from broken workspace files and keep writing trace files for visibility.
- Keep generated workspace docs orienting. Specific operation guidance should come from operation metadata, diagnostics, and examples.
- Keep host concerns out of this package. HTTP routes, session gating, and host process management belong elsewhere.
