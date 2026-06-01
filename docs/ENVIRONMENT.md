# Environment and Repo Workflows

Compact runbook for choosing safe repo commands. This file is the durable home for build/runtime/deployment workflow vocabulary.

## Non-negotiable RRD rule

Keep **compile/package verification** separate from **live Revit runtime freshness**.

- Plain terminal `dotnet build` => **isolated**, `.artifacts/...`, `NoRrdContact`.
- `dotnet run --project .\build\Build.csproj ...` => package/publish orchestration, `NoRrdContact`.
- Rider/IDE build => **interactive**, package-local outputs that Rider hot reload can reason about.
- `pe-dev sync` => explicit bridge from fresh interactive outputs into live RRD validation.
- Do **not** use `/p:PeIsolatedBuild=false` as normal guidance. It forces terminal interactive outputs and can clobber Rider/RRD hot-reload baselines.

## Taxonomy shortcuts

| Question | Taxonomy answer |
| --- | --- |
| What am I doing? | workflow: `Build`, `Verify`, `Package`, `Publish` |
| Which machine lane owns this? | runtime lane: `Dev` or `Install` |
| Can this touch RRD? | execution policy: `NoRrdContact` or `RrdRequired` |
| Where do outputs go? | build mode: `Isolated` or `Interactive` |
| What Revit host verifies it? | verify target: `AttachedRrd` or `FreshRevitProcess` |

## How do I...

### Compile a package safely?

Workflow `Build`; policy `NoRrdContact`; mode `Isolated`.

```powershell
dotnet build .\source\Pe.Revit\Pe.Revit.csproj -c Debug.R25
dotnet build .\source\Pe.Host\Pe.Host.csproj -c Debug.R25
dotnet build .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25
```

This proves compile correctness only. It does not refresh RRD.

### Recover a poisoned sandbox/dotnet environment?

Use the wrapper only as an escape hatch when `dotnet` reports unsafe Windows env vars or `Value cannot be null. (Parameter 'path1')`.

```powershell
.\tools\dotnet-sandbox-safe.ps1 build .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25
```

The script repairs child-process env, shuts down poisoned build servers, and adds `--disable-build-servers` where supported.

### Validate changed runtime code in live RRD?

Workflow `Verify`; lane `Dev`; target `AttachedRrd`; policy `RrdRequired`.

1. Build the affected runtime package from Rider/IDE so package-local outputs and Rider HR baselines stay coherent.
2. Sync runtime explicitly.
3. Run the live probe/test.

```powershell
pe-dev sync
pea script --stdin --name Probe.cs
```

`pe-dev sync --json` reports `runtimeFreshness.verdict` as `fresh`, `stale`, or `unproven`, plus split evidence fields `loadedGraphVerdict` and `sourceDeltaVerdict`. Treat `loadedGraphVerdict=fresh` as loaded-assembly freshness evidence only; overall `fresh` requires no unproven runtime source delta. If source/runtime files changed and `sourceDeltaVerdict=unproven`, do not claim AttachedRrd proof until Rider Apply Changes/restart or FreshRevitProcess proof resolves it.

If HR reports restart-required changes, restart RRD before trusting behavior.

### Run attached Revit tests?

Same lane/policy as live scripting: first Rider/IDE build affected runtime code, then:

```powershell
pe-dev sync
dotnet build .\source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests /p:WarningLevel=0
dotnet test .\source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "Name~SomeFocusedTest" --no-build
```

The `.Tests` build output is isolated, but test execution is Revit-backed. For explicit-year `dotnet test`, the default verify target is `AttachedRrd`, so the run uses assemblies already loaded in RRD. The test build is not the runtime freshness step; `pe-dev sync` is.

### Run Revit-backed tests without touching RRD?

Workflow `Verify`; lane `Dev`; target `FreshRevitProcess`; policy `NoRrdContact`.

```powershell
pe-dev test --filter "Name~AssemblyLoadDiagnostics" --timeout-seconds 900
```

The helper should own and close its fresh Revit process.

### Inspect current env/session/logs?

```powershell
pe-dev doctor --json
pe-dev doctor
pe-dev status
pea host logs --target all --tail 50
```

Agent decision flow:

- `pe-dev doctor --json` first when runtime state is unknown; consume `exitCode`, `issues[]`, and `recommendedNextSteps[]`.
- `exitCode=2`: fix shell/runtime setup before Revit debugging.
- `exitCode=3`: attached RRD is unavailable for the requested year; start/sync RRD or switch to fresh verification.
- `exitCode=4`: loaded runtime assemblies look stale; run `pe-dev sync`, restart RRD if still stale, or use `pe-dev test ...`.
- For autonomous hooks, prefer `--json` on the chosen lane: `doctor --json`, `sync --json`, or `test --json`.
- For safe smoke checks or command planning, use `pe-dev test --plan --json ...`; this resolves the fresh lane without building, launching Revit, quarantining add-ins, running tests, or cleaning sessions.
- For real fresh proof runs from agents/hooks, include `--timeout-seconds <seconds>` so Revit launch/test-adapter hangs fail bounded with exit code `124`. Do not use a real fresh run as a cheap CLI smoke test.

Check these before assuming source/runtime divergence.

### Refresh dev `pea`?

Lane `Dev`; policy `NoRrdContact`.

```powershell
pe-dev pea install-dev
pea --help
```

Dev `pea` is PATH-visible from `%LocalAppData%\Positive Energy\Pe.Tools\bin\pea\`.

### Work on generated contracts?

```powershell
pe-dev codegen check
pe-dev codegen sync --target host-client
pe-dev codegen sync --target host-types
```

`check` is for verification/CI-style flows. `sync` updates generated projections. Host DTO TypeScript is generated through `pe-dev`/TypeGen and normalized for NodeNext `.js` imports; do not run `dotnet-typegen` or maintain `tgconfig.json` by hand.

### Package bundles, appbundles, and MSI?

Workflow `Package`; policy `NoRrdContact`.

```powershell
dotnet run --project .\build\Build.csproj -c Release -- pack
dotnet run --project .\build\Build.csproj -c Release -- pack --configuration Release.R25
```

Use pack targets when you only need one artifact family:

```powershell
dotnet run --project .\build\Build.csproj -c Release -- pack desktop --configuration Release.R25
dotnet run --project .\build\Build.csproj -c Release -- pack installer --configuration Release.R25
dotnet run --project .\build\Build.csproj -c Release -- pack automation
dotnet run --project .\build\Build.csproj -c Release -- pack all
```

`pack` with no explicit target is equivalent to `pack all`. `pack installer` also creates the pea payload because the MSI embeds it.

Outputs:

- desktop bundle: `.artifacts/packages/bundles/Pe.App.bundle.zip`
- DA appbundle: `.artifacts/packages/automation/Pe.Dev.RevitAutomation.Worker.<year>.appbundle.zip`
- installer: `.artifacts/packages/installers/*.msi`

### Validate the installed product lane?

Workflow `Verify`; lane `Install`.

```powershell
dotnet run --project .\build\Build.csproj -c Release -- pack --configuration Release.R25
```

Then install `.artifacts/packages/installers/*.msi`.

Installed roots are product-shaped and MSI-owned:

```text
%LocalAppData%\Positive Energy\Pe.Tools\bin\host\
%LocalAppData%\Positive Energy\Pe.Tools\bin\pea\
%LocalAppData%\Positive Energy\Pe.Tools\bin\pe-dev\  # optional installer feature
```

Do not validate installed behavior against the dev host root.

### Publish release artifacts?

Workflow `Publish`; policy `NoRrdContact`.

```powershell
dotnet run --project .\build\Build.csproj -c Release -- pack publish
```

### Run APS / Design Automation operator flows?

Lane `Dev`; policy normally `NoRrdContact`.

```powershell
pe-dev automation auth login
pe-dev automation browse hubs
pe-dev automation manifest create --path docs/context/my-run/schedules.json
pe-dev automation submit schedules --manifest docs/context/my-run/schedules.json
pe-dev automation inspect receipt --receipt latest --download-artifacts true
```

Start DA audits with one or two models before widening the manifest.

## Build/runtime/deployment vocabulary

| Term | Meaning |
| --- | --- |
| **module taxonomy** | What kind of repo package this is, such as `BuildTool`, `InstallerTool`, `DesktopShell`, `RevitRuntime`, `TestHarness`, `AutomationShell`, `OperatorSurface`, `HostService`, `SharedNeutral`, or `ExternalIntegration`. |
| **product taxonomy** | What durable output/runtime shape a workflow produces, such as `DesktopAddin`, `HostRuntime`, `DevTooling`, `AutomationRuntime`, `RevitRuntime`, `TestHarness`, `SharedLibrary`, or `ExternalIntegration`. Product classes are build/runtime output categories, not MSI features. |
| **installer component taxonomy** | MSI-visible/install-owned slices such as `RevitAddin`, `HostRuntime`, `PeaCli`, `PeDevCli`, `RuntimeState`, `UserContent`, and `AutomationBundle`. Installer components capture ownership, uninstall behavior, and materialization boundaries. |
| **workflow taxonomy** | Operator intent: `Build`, `Verify`, `Package`, or `Publish`. |
| **runtime lane** | Which local machine lane owns running binaries/state: `Dev` or `Install`. |
| **execution policy** | Whether a workflow may touch the live Rider-driven Revit session: `NoRrdContact` or `RrdRequired`. |
| **build mode** | Where compiler outputs go: `Isolated` under `.artifacts/...` or `Interactive` package-local `bin/obj`. |
| **verify target** | What Revit process verifies behavior: `AttachedRrd` or `FreshRevitProcess`. |

Key authorities:

- `build/authored/BuildTaxonomy.props` owns package taxonomy and Revit-awareness metadata.
- `build/generated/*.props` and `*.targets` are generated MSBuild projections, not source-of-truth vocabulary.
- `Pe.Shared.Product` owns product identity, executable names, and install/user/runtime relative paths.
- `build/BuildArtifactLayout.cs` owns `.artifacts/...` package topology.
- `build/ProductLayoutAuthority.cs` owns build/install composition and manifest writing.
- `Pe.Shared.HostContracts` owns host operations, routes, bridge/script contracts, and generated host-client contracts.

## Avoid as defaults

Do not make terminal interactive builds part of the normal loop. They force package-local outputs from the shell. For live RRD work, prefer Rider/IDE build + `pe-dev sync`. Use terminal interactive builds only as an explicit escape hatch when you have accepted the RRD/HR baseline risk.

Do not run `install/Installer.csproj` directly unless you already have a generated `InstallerPayloadManifest`. Normal installer path is `pack`.

## One-line decision table

| Goal | Command |
| --- | --- |
| safe compile | `dotnet build .\source\<Package>\<Package>.csproj -c Debug.R25` |
| sandbox recovery | `.\tools\dotnet-sandbox-safe.ps1 <dotnet args>` |
| live RRD refresh | Rider build, then `pe-dev sync` |
| live script | `pea script --stdin --name Probe.cs` after sync |
| attached tests | Rider build + sync + explicit-year `dotnet test` |
| fresh Revit tests | `pe-dev test --filter "Name~..." --timeout-seconds 900` |
| package artifacts/MSI | `dotnet run --project .\build\Build.csproj -c Release -- pack` |
| package one year | `dotnet run --project .\build\Build.csproj -c Release -- pack --configuration Release.R25` |
| package desktop bundle only | `dotnet run --project .\build\Build.csproj -c Release -- pack desktop --configuration Release.R25` |
| package installer only | `dotnet run --project .\build\Build.csproj -c Release -- pack installer --configuration Release.R25` |
| package automation appbundle only | `dotnet run --project .\build\Build.csproj -c Release -- pack automation` |
| publish release | `dotnet run --project .\build\Build.csproj -c Release -- pack publish` |
| refresh `pea` dev payload | `pe-dev pea install-dev` |
| inspect env/session/logs | `pe-dev status`, `pea host logs --target all --tail 50` |
