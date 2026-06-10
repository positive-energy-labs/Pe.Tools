# Pe.Shared.Scripting

## Scope

Owns Revit-neutral scripting primitives shared by Revit-hosted execution and future host-composition runners: source sets, compilation helpers, entry-point syntax discovery, diagnostics helpers, and syntax-based policy rules.

## Purpose

`Pe.Shared.Scripting` is the reusable scripting core. It must stay free of Revit API, UI, bridge, host implementation, and filesystem-runtime assumptions so `Pe.Revit.Scripting` can remain a thin Revit adapter over shared authoring and safety rules.

## Critical Entry Points

- `Execution/ScriptSourceSet.cs` - shared source-file/source-set and compilation result models.
- `Execution/ScriptCompilationService.cs` - Roslyn compile helper with caller-supplied default usings and metadata references.
- `Analysis/ScriptEntryPointResolver.cs` - syntax-only container entry-point discovery.
- `Policy/ScriptPolicyAnalyzer.cs` - policy pipeline and default rule composition.
- `Policy/IScriptPolicyRule.cs` - extension point for future semantic/Revit-type-oriented safety rules.
- `Policy/ProcessShellPolicyRule.cs` and `Policy/RevitTransactionPolicyRule.cs` - current minimum viable syntax rules.
- `Pods/*` - Revit-neutral Pod manifest models and validation rules.

## Validation

- `dotnet build .\source\Pe.Shared.Scripting\Pe.Shared.Scripting.csproj -c Debug.R25`
- Also build the consuming adapter after changes: `dotnet build .\source\Pe.Revit.Scripting\Pe.Revit.Scripting.csproj -c Debug.R25`

## Shared Language

| Term                         | Meaning                                                                            | Prefer / Avoid                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **policy rule**              | One syntax/analysis check that returns `ScriptDiagnostic` values                   | Prefer additive rules over hardcoded checks in the Revit adapter |
| **host-owned transaction**   | The Revit transaction opened by the scripting host for `WriteTransaction` requests | Scripts must not create their own Revit transactions             |
| **read-only script**         | Default permission mode; no host transaction is opened                             | Prefer this for host-client joins, inspection, and artifacts     |
| **write-transaction script** | Explicit opt-in mode where the host opens one transaction                          | Use only for intentional document mutations                      |

## Living Memory

- Keep this package Revit-neutral. Do not reference `Autodesk.Revit.*`, WPF, bridge transport, `UIApplication`, or Revit document/session helpers here.
- Static policy is minimum viable safety, not a security proof. Return diagnostics instead of throwing so callers can surface actionable rejection messages.
- Add future Revit-type-aware rules behind `IScriptPolicyRule`; do not couple those rules into `RevitScriptExecutionService` unless they need live Revit state.
- `ReadOnly` is the default public contract. `WriteTransaction` is explicit and still rejects script-created `Transaction`, `SubTransaction`, and `TransactionGroup` instances.
- `pod.json` validation belongs here because it is Revit-neutral. Keep the v1 manifest strict: known fields only, slug ids, non-empty entrypoints, and safe `src/**/*.cs` paths.
- Pod manifests describe shareable source entrypoints; they do not choose sandbox, transaction, or model-mutation permission. Execution requests still own `ScriptPermissionMode`.
