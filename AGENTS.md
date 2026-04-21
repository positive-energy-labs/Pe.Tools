---
alwaysApply: true
---

# Pe.Tools

## Scope

Repo-wide agent guidance for conventions, current paths, validation habits, Revit workflow constraints, and cross-package terminology that repeatedly matters across the codebase.

## Purpose and Philosophy

This repo exists to improve Engineering Designer workflows for MEP firms through strongly typed, debuggable Revit tooling. Optimize for linear execution flow, fail-fast behavior, composable systems, and wrappers around finicky Revit API behavior. This repo is greenfield: move fast, prefer the best long-term shape, and do not preserve compatibility shims unless they are a temporary compile bridge.

## Critical Entry Points

- `source/Pe.App/Application.cs` - desktop Revit add-in startup, host bridge bootstrap, ribbon/task initialization.
- `source/Pe.App/ButtonRegistry.cs` - top-level desktop command and ribbon exposure.
- `source/Pe.Host/Program.cs` - external settings host, HTTP/SSE entrypoint.
- `source/Pe.Dev.Cli/Program.cs` and `source/Pe.Dev.Cli/DevCliProgram.cs` - the single operator CLI surface for local Revit work, scripting, logs, and Design Automation.
- `source/Pe.Dev.RevitAutomation/` - APS auth/bootstrap helpers, appbundle/activity orchestration, workitem submission, status, artifact download, and batch submission.
- `source/Pe.Dev.RevitAutomation.Worker/RevitAutomationShellApp.cs` - the Autodesk Design Automation shell entrypoint. This is the headless peer to `Pe.App`, not a copy of desktop startup.
- `source/Pe.Shared.StorageRuntime/` - schema generation, field options, module registration, storage/document validation.
- `source/Pe.Revit.Global/` - document-owned Revit helpers, APS contracts, and DA-safe collector seams that both shells can share.
- `source/Pe.Revit.Extensions/` - strong primitives such as `FamilyDocument`, value coercion helpers, formula helpers, and parameter lookup helpers.
- `source/Pe.Revit.FamilyFoundry/OperationProcessor.cs` - main Family Foundry execution orchestrator.
- `source/Pe.Revit.Tests/AGENTS.md` - runner-specific Revit test workflow.
- `docs/features/family-foundry/_DEV.md` and `_GOALS.md` - Family Foundry architecture and intent.
- `docs/features/revit-design-automation/_DEV.md` and `_GOALS.md` - DA shell architecture, operator commands, and current workload goals.

## Builds and Env

Protect the current RRD session aggressively. Breaking it can turn a small edit into a multi-minute restart plus document reopen wait.

The biggest rule: do not build `Pe.App` directly unless asked, and do not use the root `Pe.Tools.slnx` as the default compile path during RRD. For compile verification, use `./build`. Building `Pe.Host` is always safe. Building `Pe.Revit.Tests` is encouraged, but remember it is runner prep, not proof that the live Rider-driven add-in is fresh.

### Build System

`Pe.Tools.slnx`, `Directory.build.props`, `./install/Installer.cs`, and `./build/Program.cs` are the main touchpoints for the build system. Revit 2025 remains the default no-config target to keep IDE and `dotnet` behavior predictable.

Prefer these commands:

```ps1
cd .\build

# safe compile verification
dotnet run -c Debug -- --configuration Debug.R25
dotnet run -c Release

# packaging
dotnet run -c Release -- pack
dotnet run -c Release -- pack publish

cd ..\source\Pe.Host
dotnet run

dotnet build ..\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test ..\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~SomeFocusedTest" --no-build
```

`./build pack` is now the shared packaging surface for both shells:

- desktop bundle output such as `output/Pe.App.bundle.zip`
- automation appbundle output such as `output/automation/Pe.Dev.RevitAutomation.Worker.<year>.appbundle.zip`

Avoid these as your default loop:

```ps1
dotnet build
cd .\source\Pe.App
dotnet build -c Debug.R25
```

They are still useful in specific cases, but not the repo-standard validation path during live Revit work.

### CLI First

`pe-dev` is now a fully featured operator surface, not just a thin dev helper. Humans and agents should prefer learning and extending `pe-dev` before inventing one-off scripts or extra executables.

The primary command families are:

- `pe-dev revit session`
- `pe-dev revit logs all --tail 50`
- `pe-dev revit hot-reload`
- `pe-dev revit approve --revit-year 2025`
- `pe-dev revit script --stdin --name Probe.cs`
- `pe-dev revit automation probe-access ...`
- `pe-dev revit automation collect-parameters ...`
- `pe-dev revit automation collect-parameters-batch --manifest <path>`
- `pe-dev revit automation workitem-status --workitem-id <id>`

## Testing, Validation, and Exploration

Prefer this order:

1. For compile verification, use `./build`.
2. For live probing in desktop Revit, use `pe-dev revit script ...`, especially `--stdin`.
3. For APS and Design Automation operator flows, use `pe-dev revit automation ...`.
4. For Revit-backed verification, use focused `dotnet test` in a `.Tests` configuration.

Before assuming source/runtime divergence during desktop work, check:

- `pe-dev revit session`
- `pe-dev revit logs all --tail 50`

The default focused Revit test loop is:

```powershell
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "FullyQualifiedName~Can_create_generic_model_family_document_from_rft"
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~FFManager_round_duct_connector_roundtrips" --no-build
```

When validating DA-backed parameter collection, keep test scope intentionally small. Full family matrix collection can take multiple minutes. Prefer a narrow category such as `Duct Accessories` before broadening scope.

`dotnet test` triggers the pre-`VSTest` approval + hot-reload hook automatically. That hook is best-effort. If it warns that restart is likely or hot reload failed, treat the live runtime as suspect even though the `.Tests` assembly is fresh.

## Shared Language

### Runtime / iteration language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **RRD** | The live Rider-driven Revit debug session for `Pe.App`. Treat it as expensive state. | Prefer this over vague phrases like `live debug`; avoid implying hot reload exists outside RRD |
| **HR** | Rider hot reload into the already-running RRD session. Useful, but not fully trustworthy. | Avoid treating HR as proof that Revit is running fresh code |

### Repo-wide language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **FF** | Family Foundry | Prefer `Family Foundry` on first mention in prose |
| **package** | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry` | Prefer this over `project` when discussing one code area |
| **app** | `Pe.App`, the in-proc desktop Revit add-in runtime | Avoid using `app` to mean the whole repo or product |
| **automation shell** | The headless DA runtime rooted in `Pe.Dev.RevitAutomation.Worker` | Prefer this over implying `Pe.App` itself runs in DA |
| **host** | `Pe.Host`, the out-of-proc HTTP/SSE settings backend | Avoid using `host` for the Revit add-in bridge |
| **bridge** | The Revit-side named-pipe connection to `Pe.Host` | Avoid calling HTTP endpoints the bridge |
| **document-owned** | Behavior that can be derived from a specific `Document` without needing UI session state | Prefer `Document` extensions for this |
| **document session** | Open/active/UI-tab state for documents in the current Revit process | Keep this in `UIApplication` or session-aware helpers |
| **artifact** | A durable machine-readable output produced by a command or DA workitem | Prefer this over vague `report` when the file is the actual output contract |
| **workitem** | One APS Design Automation job submission | Prefer one workitem per cloud model for batch collection |

### Portable Revit state language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **collect** | Read live Revit state into a transient catalog, list, or query result | Prefer this for live-document queries |
| **capture** | Convert live Revit state into a durable snapshot or spec | Prefer this when the output survives document/session/version boundaries |
| **snapshot** | Durable captured point-in-time state with provenance when needed | Avoid using it as the umbrella term for every derived output |
| **projection** | A target-shaped derived output such as a matrix, dataset, CSV, or profile fragment | Prefer this for derived output shapes |
| **apply** | Write compatible authored or captured state back into live Revit | Prefer this over `replay` for patch/merge oriented behavior |
| **profile** | The top-level authored settings document that drives a command or workflow | Avoid using it as a synonym for snapshot output |

## Living Memory

- Minimize API surface area. Favor type-safety, nullability correctness, generics, `nameof`, pattern matching, and small explicit contracts.
- Prefer `Result<T>` / `Try...` patterns on public or user-facing flows instead of exceptions when failure is expected.
- Use Serilog `Log.*` instead of `Console.WriteLine` or `Debug.WriteLine` in runtime code.
- Prefer LINQ, fluent APIs, and extracted helpers over deep nesting. Keep execution flow easy to debug.
- Delete dead code and rename-era leftovers instead of preserving compatibility shims.
- Keep docs local and current. Remove stale goals, stale paths, and rename-era references rather than preserving history.
- For docs reshaping or consolidation work, use the `document-project-docs` skill in `C:\Users\kaitp\.agents\skills\document-project-docs`.
- `Pe.Dev.Cli` is the first operator surface to check before adding ad hoc scripts, temporary console apps, or duplicate automation entrypoints.
- Treat desktop and DA as sibling shells over shared DA-safe runtime packages. Do not route DA through `Pe.App` startup.
- DA-safe collector paths must not depend on `UIApplication`, WPF, ribbon helpers, or interactive session services. Keep those in UI-specific packages and helpers.
- Put document-owned identity, path, binding, and collection helpers on `Document` extensions as close to `Pe.Revit.Global` as possible. Keep open/active/navigation behavior in session-aware services or `UIApplication` extensions.
- Prefer `Document` / `FamilyDocument` as the public entrypoints for document-owned collect/capture/apply flows, even when the returned models still live in a feature package.
- When validating DA collection performance, start narrow and bounded. Category filters are a verification tool, not just a product feature.

## Outstanding Guidance to Add

- WPF BAML resolution errors that occasionally happen. This remains a major blocker, but cause and durable mitigation are still unknown.
