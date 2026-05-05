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
- `source/Pe.Dev.RevitAutomation/` - Design Automation appbundle/activity orchestration, workitem submission, status, artifact download, and batch submission over `Pe.Aps` clients.
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

The biggest rule: keep terminal compile checks and live-runtime refreshes separate. Plain terminal `dotnet build` is safe by default because it builds into isolated `.artifacts/...` outputs. Rider builds remain interactive and package-local.

### Build System

`Pe.Tools.slnx`, `Directory.build.props`, `./install/Installer.cs`, and `./build/Program.cs` are the main touchpoints for the build system. Revit 2025 remains the default no-config target to keep IDE and `dotnet` behavior predictable.

The repo now has two build lanes:

- interactive lane:
  package-local `bin/obj` outputs for Rider, explicit `/p:PeIsolatedBuild=false` terminal builds, and anything you expect Rider hot reload to patch into the live RRD session
- isolated lane:
  plain terminal `dotnet build`, `./build`, and CI outputs under `.artifacts/...`; this is the safe compile/package lane and does not refresh the live Revit runtime

Critical consequence:

- plain terminal `dotnet build` is the default compile-verification path
- `./build` is for orchestration, packaging, and CI parity
- isolated builds are not proof that the live runtime DLLs loaded by Revit are fresh
- if you intend to validate through `pe-dev revit script ...` or `dotnet test source/Pe.Revit.Tests/...`, build the affected runtime package in the interactive lane and then run `pe-dev revit sync-runtime`
- do not assume scripting or `.Tests` runs are seeing fresh code just because an isolated build passed

Prefer these commands:

```ps1
# safe single-package compile verification
dotnet build .\source\Pe.Revit\Pe.Revit.csproj -c Debug.R25
dotnet build .\source\Pe.Host\Pe.Host.csproj -c Debug.R25
dotnet build .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25

# orchestration / packaging
cd .\build

dotnet run -c Release -- pack
dotnet run -c Release -- pack publish

cd ..\source\Pe.Host
dotnet run

# live test loop after interactive build + sync
cd ..\..
pe-dev revit sync-runtime
dotnet build .\source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test .\source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~SomeFocusedTest" --no-build
```

`./build pack` is now the shared packaging surface for both shells:

- desktop bundle output such as `.artifacts/packages/bundles/Pe.App.bundle.zip`
- automation appbundle output such as `.artifacts/packages/automation/Pe.Dev.RevitAutomation.Worker.<year>.appbundle.zip`
- installer output such as `.artifacts/packages/installers/*.msi`

Avoid these as your default loop:

```ps1
dotnet build .\source\Pe.Revit\Pe.Revit.csproj -c Debug.R25 /p:PeIsolatedBuild=false
dotnet build .\source\Pe.App\Pe.App.csproj -c Debug.R25 /p:PeIsolatedBuild=false
```

They still have niche use, but they are not the default validation path during live Revit work.

### Live Runtime Validation

If you are validating live Revit behavior through scripting or `Pe.Revit.Tests`, use this posture:

1. build the affected runtime package in the interactive lane
2. run `pe-dev revit sync-runtime`
3. verify runtime sync actually succeeded
4. then run `pe-dev revit script ...` or `dotnet test ...`

Important details:

- `pe-dev revit script` no longer auto-runs hot reload beforehand
- `pe-dev revit sync-runtime` is the preferred explicit wrapper around session-health checks plus `revit hot-reload`
- `pe-dev revit hot-reload` is still the lower-level command when you want just HR with no extra status framing
- the pre-`VSTest` `.Tests` hook is best-effort only and must not be treated as the primary refresh step
- the recent HR break came from interactive non-release builds mutating generated assembly metadata under `*.AssemblyInfo.cs`; non-release builds now pin `AssemblyInformationalVersion` to a stable `dev` value, so recurring `ENC0003` on generated assembly-info files means that drift regressed
- a common `ENC2014`/missing-MVID failure means Rider lost the baseline assembly for the running module; in this repo that usually means the interactive build graph got clobbered by the wrong build lane or a replaced output
- if HR reports restart-required changes, or runtime behavior still diverges after a successful HR, restart RRD before debugging deeper

### CLI First

`pe-dev` is now a fully featured operator surface, not just a thin dev helper. Humans and agents should prefer learning and extending `pe-dev` before inventing one-off scripts or extra executables.

The primary command families are:

- `pe-dev revit session`
- `pe-dev revit logs all --tail 50`
- `pe-dev revit sync-runtime`
- `pe-dev revit hot-reload`
- `pe-dev revit test --filter "Name~SomeFocusedTest"`
- `pe-dev revit approve --revit-year 2025`
- `pe-dev revit script --stdin --name Probe.cs`
- `pe-dev revit automation auth login`
- `pe-dev revit automation browse hubs`
- `pe-dev revit automation manifest create --path <path>`
- `pe-dev revit automation submit schedules --manifest <path>`
- `pe-dev revit automation inspect receipt --receipt latest`
- `pe-dev revit automation workitem-status --workitem-id <id>`

## Testing, Validation, and Exploration

Prefer this order:

1. For compile verification, use plain terminal `dotnet build`.
2. For live probing in desktop Revit, build the affected runtime package in the interactive lane, run `pe-dev revit sync-runtime`, then use `pe-dev revit script ...`, especially `--stdin`.
3. For APS and Design Automation operator flows, use `pe-dev revit automation ...`.
4. For Revit-backed verification that depends on fresh runtime graphs, prefer `pe-dev revit test ...`. It auto-selects a safe Revit year in the same runtime family that is not already running, then forces a dedicated test Revit process and temporarily hides the deployed `Pe.App` add-in for that year so the runner is not accidentally bootstrapping the normal desktop deployment.
5. Treat the open Revit window left behind by `pe-dev revit test` as an inspectable owned test session, not a freshness-safe reusable runtime. The next `pe-dev revit test` run should recycle that owned session before running again because `ricaun.RevitTest` attach-mode reuse was empirically stale for `Pe.App` graph work.
6. For expert/raw loops, you can still use focused `dotnet test` in a `.Tests` configuration, but treat runner-opened Revit freshness as suspect unless you explicitly controlled the loaded add-ins.

Before assuming source/runtime divergence during desktop work, check:

- `pe-dev revit session`
- `pe-dev revit logs all --tail 50`

The default focused Revit test loop is:

```powershell
pe-dev revit sync-runtime
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "FullyQualifiedName~Can_create_generic_model_family_document_from_rft"
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~FFManager_round_duct_connector_roundtrips" --no-build
```

When validating the current DA audit lane, keep the manifest intentionally small. One or two models is the right first pass before broadening to a larger scrape.

`dotnet test` still triggers the pre-`VSTest` approval + hot-reload hook automatically, but that hook is best-effort only. The required posture is still an explicit `pe-dev revit sync-runtime` or manual `pe-dev revit hot-reload` before live scripting or `.Tests` validation. If the hook warns that restart is likely or hot reload failed, treat the live runtime as suspect even though the `.Tests` assembly is fresh.

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
- Local `Pe.Dev.Cli` builds now mirror the runnable CLI output to `%LocalAppData%\Positive Energy\Pe.Tools\Bin\pe-dev\`. That is the intended PATH-friendly dev bin, distinct from the deployed host-side install root.
- Explicit runtime sync is part of the live-validation contract now. After editing runtime packages, do not validate through scripting or `Pe.Revit.Tests` until `pe-dev revit sync-runtime` or manual `pe-dev revit hot-reload` has been run and checked.
- Plain terminal `dotnet build` now defaults to the isolated lane. Use `/p:PeIsolatedBuild=false` only when you intentionally want package-local interactive outputs from the shell.
- `./build` only proves the isolated lane. It does not update the package-local outputs or deployed in-memory DLLs Rider hot reload works against.
- Treat desktop and DA as sibling shells over shared DA-safe runtime packages. Do not route DA through `Pe.App` startup.
- Runtime path, install ownership, and assembly-authority-by-lane now live in `docs/features/deployment-runtime/_DEV.md`. Treat that file as the source of truth for deployed install roots, authored content roots, runtime state/log roots, and which workflow actually controls a given Revit process's loaded assemblies.
- DA-safe collector paths must not depend on `UIApplication`, WPF, ribbon helpers, or interactive session services. Keep those in UI-specific packages and helpers.
- Put document-owned identity, path, binding, and collection helpers on `Document` extensions as close to `Pe.Revit.Global` as possible. Keep open/active/navigation behavior in session-aware services or `UIApplication` extensions.
- Prefer `Document` / `FamilyDocument` as the public entrypoints for document-owned collect/capture/apply flows, even when the returned models still live in a feature package.
- When validating DA collection performance, start narrow and bounded. Category filters are a verification tool, not just a product feature.

## Outstanding Guidance to Add

- WPF BAML resolution errors that occasionally happen. This remains a major blocker, but cause and durable mitigation are still unknown.
