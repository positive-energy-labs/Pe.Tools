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

`docs/ENVIRONMENT.md` is the canonical human/operator runbook for build, verify, test, package, install, publish, and environment recovery commands. Keep detailed command menus there; keep this file focused on agent cautions and durable invariants.

Protect the current RRD session aggressively. Breaking it can turn a small edit into a multi-minute restart plus document reopen wait.

The biggest rule: keep terminal compile checks and live-runtime refreshes separate. Plain terminal `dotnet build` is safe by default because it builds into isolated `.artifacts/...` outputs. Rider builds remain interactive and package-local.

### Build System

`Pe.Tools.slnx`, `Directory.build.props`, `./install/Installer.cs`, and `./build/Program.cs` are the main touchpoints for the build system. Revit 2025 remains the default no-config target to keep IDE and `dotnet` behavior predictable in weaker IDEs and no-config `dotnet` usage.

Keep four concepts separate when reasoning about build orchestration:

- module taxonomy:
  what a package is
- product taxonomy:
  what durable output or deployed shape a workflow is producing
- workflow taxonomy:
  build, verify, package, or publish
- execution policy:
  whether the workflow is allowed to touch `RRD`

Current repo-wide execution policies:

- `NoRrdContact`:
  the workflow must not inspect, mutate, depend on, or refresh `RRD`
- `RrdRequired`:
  the workflow is explicitly about the live Rider-driven desktop session

The repo currently has two build modes:

- interactive build mode:
  package-local `bin/obj` outputs owned by Rider/IDE for hot reload into the live `RRD` session
- terminal interactive override:
  `/p:PeIsolatedBuild=false` forces package-local outputs from the shell and is an escape hatch, not normal runbook guidance, because it can clobber Rider/RRD hot-reload baselines
- isolated build mode:
  plain terminal `dotnet build`, `./build`, and CI outputs under `.artifacts/...`; this is the safe compile/package path and does not refresh the live Revit runtime

Critical consequence:

- plain terminal `dotnet build` is the default compile-verification path
- `./build` is for orchestration, packaging, and CI parity
- isolated builds are not proof that the live runtime DLLs loaded by Revit are fresh
- `.Tests` build outputs are isolated artifacts, but `Pe.Revit.Tests` execution is Revit-backed; explicit-year `dotnet test -c Debug.R25.Tests ...` defaults to `AttachedRrd` unless you use the fresh helper
- if you intend to validate through `pea script ...` or attached `dotnet test source/Pe.Revit.Tests/...`, build the affected runtime package from Rider/IDE, then run `pe-dev sync`
- do not assume scripting or `.Tests` runs are seeing fresh loaded assemblies just because an isolated build passed

Prefer these commands:

```ps1
# safe single-package compile verification
dotnet build .\source\Pe.Revit\Pe.Revit.csproj -c Debug.R25
dotnet build .\source\Pe.Host\Pe.Host.csproj -c Debug.R25
dotnet build .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25

# orchestration / packaging
dotnet run --project .\build\Build.csproj -c Release -- pack
dotnet run --project .\build\Build.csproj -c Release -- pack --configuration Release.R25
dotnet run --project .\build\Build.csproj -c Release -- pack publish

cd .\source\Pe.Host
dotnet run

# live test loop after Rider/IDE build + sync
cd ..\..
pe-dev sync
dotnet build .\source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test .\source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~SomeFocusedTest" --no-build
```

`dotnet run --project build/Build.csproj ...` is now the shared packaging surface for both shells:

- desktop bundle output such as `.artifacts/packages/bundles/Pe.App.bundle.zip`
- automation appbundle output such as `.artifacts/packages/automation/Pe.Dev.RevitAutomation.Worker.<year>.appbundle.zip`
- installer output such as `.artifacts/packages/installers/*.msi`

Avoid terminal interactive builds as your default live-validation loop. They force package-local outputs from the shell and can clobber Rider/RRD hot-reload baselines. Prefer Rider/IDE build plus `pe-dev sync`; use the override only as an explicit escape hatch.

### Live Runtime Validation

If you are validating live Revit behavior through scripting or `Pe.Revit.Tests`, use this posture:

1. build the affected runtime package from Rider/IDE
2. run `pe-dev sync`
3. verify runtime sync actually succeeded
4. then run `pea script ...` or `dotnet test ...`

Important details:

- `pea script` no longer auto-runs hot reload beforehand
- `pe-dev sync` is the preferred explicit wrapper around session-health checks plus `revit hot-reload`
- `pe-dev revit hot-reload` is still the lower-level command when you want just HR with no extra status framing
- the pre-`VSTest` `.Tests` hook is best-effort only and must not be treated as the primary refresh step
- the recent HR break came from interactive non-release builds mutating generated assembly metadata under `*.AssemblyInfo.cs`; non-release builds now pin `AssemblyInformationalVersion` to a stable `dev` value, so recurring `ENC0003` on generated assembly-info files means that drift regressed
- a common `ENC2014`/missing-MVID failure means Rider lost the baseline assembly for the running module; in this repo that usually means the interactive build graph got clobbered by the wrong build mode or a replaced output
- if HR reports restart-required changes, or runtime behavior still diverges after a successful HR, restart RRD before debugging deeper

### CLI First

`pe-dev` is now a fully featured operator surface, not just a thin dev helper. Humans and agents should prefer learning and extending `pe-dev` before inventing one-off scripts or extra executables.

Do not grow a custom build CLI for ordinary compilation. `dotnet build` must remain the standard safe default surface.

The primary command families are:

- `pe-dev doctor --json`
- `pe-dev doctor`
- `pe-dev status`
- `pe-dev env logs all --tail 50`
- `pe-dev status`
- `pe-dev sync`
- `pe-dev test --filter "Name~SomeFocusedTest" --timeout-seconds 900`
- `pea script --stdin --name Probe.cs`
- `pe-dev pea install-dev`
- `pe-dev automation auth login`
- `pe-dev automation browse hubs`
- `pe-dev automation manifest create --path <path>`
- `pe-dev automation submit schedules --manifest <path>`
- `pe-dev automation inspect receipt --receipt latest`
- `pe-dev automation inspect workitem --workitem-id <id>`
- `pe-dev codegen check`
- `pe-dev codegen sync --target host-client`

## Testing, Validation, and Exploration

Prefer this order:

1. For compile verification, use plain terminal `dotnet build`.
2. For live probing in desktop Revit, build the affected runtime package from Rider/IDE, run `pe-dev sync`, then use `pea script ...`, especially `--stdin`.
3. For `AttachedRrd` verification, build the affected runtime package from Rider/IDE, run `pe-dev sync`, then run focused explicit-year `dotnet test` commands from terminal.
4. For `FreshRevitProcess` verification, prefer the explicit helper that avoids `RRD` and creates a dedicated fresh test host for the chosen Revit year. Today that helper is `pe-dev test ...`; use `--plan --json` for no-launch command planning/smoke checks and `--timeout-seconds <seconds>` for real agent proof runs.
5. `pe-dev test` should close the fresh owned Revit process after each run. If a stale owned process survives a failure or timeout, the next helper run should recycle it before launching again.
6. For APS and Design Automation operator flows, use `pe-dev automation ...`.

Before assuming source/runtime divergence during desktop work, check:

- `pe-dev status`
- `pe-dev env logs all --tail 50`

The default focused `AttachedRrd` loop is:

```powershell
pe-dev sync
dotnet build source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "FullyQualifiedName~Can_create_generic_model_family_document_from_rft"
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~FFManager_round_duct_connector_roundtrips" --no-build
```

For the current `FreshRevitProcess` helper, prefer:

```powershell
pe-dev test --filter "Name~AssemblyLoadDiagnostics" --timeout-seconds 900
```

When validating the current DA audit workflow, keep the manifest intentionally small. One or two models is the right first pass before broadening to a larger scrape.

Explicit-year `dotnet test` for `Pe.Revit.Tests` is Revit-backed. The `.Tests` output build is isolated, but VSTest execution defaults to `AttachedRrd` and runs against assemblies already loaded in RRD. The pre-`VSTest` check is not a freshness mechanism; the required posture is still explicit `pe-dev sync` before live scripting or attached `.Tests` validation.

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
| **workflow** | The operator intent such as build, verify, package, or publish | Prefer this over overloading `Configuration` strings to carry every concern |
| **execution policy** | Whether a workflow is allowed to touch `RRD` | Prefer explicit `NoRrdContact` / `RrdRequired` language over vague safety assumptions |
| **AttachedRrd** | Verification against the already-running Rider-driven desktop Revit session | Prefer this over vague `live tests` phrasing when the running session itself matters |
| **FreshRevitProcess** | Verification in a new dedicated Revit process that must not reuse `RRD` | Prefer this over vague `isolated tests` phrasing when freshness and process ownership matter |
| **package** | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry` | Prefer this over `project` when discussing one code area |
| **app** | `Pe.App`, the in-proc desktop Revit add-in runtime | Avoid using `app` to mean the whole repo or product |
| **automation shell** | The headless DA runtime rooted in `Pe.Dev.RevitAutomation.Worker` | Prefer this over implying `Pe.App` itself runs in DA |
| **host** | `Pe.Host`, the out-of-proc HTTP/SSE backend | Avoid using `host` for the Revit add-in bridge or product identity |
| **bridge** | The private Host/Revit WebSocket connection | Avoid calling HTTP endpoints the bridge |
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
- Local `Pe.Dev.Cli` builds now mirror the runnable CLI output to `%LocalAppData%\Positive Energy\Pe.Tools\bin\pe-dev\`. That is the intended PATH-friendly dev bin for repo work. `pea` remains PATH-visible from `%LocalAppData%\Positive Energy\Pe.Tools\bin\pea\`, while the dev-only `Pe.Host` runtime lives separately under `%LocalAppData%\Positive Energy\Pe.Tools\dev\bin\host\`.
- Explicit runtime sync is part of the live-validation contract now. After editing runtime packages, do not validate through scripting or `Pe.Revit.Tests` until `pe-dev sync` or manual `pe-dev revit hot-reload` has been run and checked.
- Plain terminal `dotnet build` now defaults to the isolated build mode and `NoRrdContact`. Use Rider/IDE for normal interactive outputs; `/p:PeIsolatedBuild=false` is only an explicit shell escape hatch because it can disrupt Rider/RRD hot-reload baselines.
- `./build` only proves the isolated build mode. It does not update the package-local outputs or deployed in-memory DLLs Rider hot reload works against.
- Treat desktop and DA as sibling shells over shared DA-safe runtime packages. Do not route DA through `Pe.App` startup.
- Runtime path, install ownership, and assembly-authority-by-workflow now live in `docs/features/deployment-runtime/_DEV.md` and `_GOALS.md`. Treat those files as the source of truth for deployed install roots, authored content roots, runtime state/log roots, and the intended execution-policy model around loaded assemblies.
- DA-safe collector paths must not depend on `UIApplication`, WPF, ribbon helpers, or interactive session services. Keep those in UI-specific packages and helpers.
- Put document-owned identity, path, binding, and collection helpers on `Document` extensions as close to `Pe.Revit.Global` as possible. Keep open/active/navigation behavior in session-aware services or `UIApplication` extensions.
- Prefer `Document` / `FamilyDocument` as the public entrypoints for document-owned collect/capture/apply flows, even when the returned models still live in a feature package.
- When validating DA collection performance, start narrow and bounded. Category filters are a verification tool, not just a product feature.

## Outstanding Guidance to Add

- WPF BAML resolution errors that occasionally happen. This remains a major blocker, but cause and durable mitigation are still unknown.
