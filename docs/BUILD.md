# Pe.Tools Build and Runtime Decisions

This document is the repo-level decision record for build, package, runtime, and Revit proof lanes. It intentionally explains why the lanes are separate more than it tries to be a complete runbook.

Keep detailed workflow behavior in the owning package docs, Peco skills, or the tooling itself. `BUILD.md` should preserve the durable mental model future agents need before they choose a command.

## Core decision

A terminal build, a packaged artifact, a running Rider debug session, and an installed product are different authorities. Do not let one claim stand in for another.

The practical rule is:

> A successful `dotnet build` proves source compilation. It does not prove that the live Rider-driven Revit debug session (**RRD**) is running fresh code.

This separation exists because Revit, Rider hot reload, package-local outputs, isolated build outputs, installed roots, and test-controlled Revit processes all have different ownership and failure modes. Collapsing them into one “build succeeded” claim creates stale-runtime bugs that are expensive to diagnose.

## Why the lanes exist

| Lane                  | Decision                                                                                   | Why it exists                                                                                             | What it proves                                                           |
| --------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Source compile**    | Ordinary terminal `dotnet build` is the safe default.                                      | Most source work should not touch Rider, Revit, installed files, or package-local hot-reload state.       | The selected package compiles into isolated `.artifacts/...` outputs.    |
| **Package/artifact**  | `./build` owns bundle, appbundle, MSI, payload, and release artifact shape.                | Packaging needs consistent repo-local topology and generated manifests, not ad hoc project builds.        | Durable artifacts were staged under `.artifacts/packages/...`.           |
| **FreshRevitProcess** | Fresh Revit-backed proof should use the test helper, not the active UI session.            | The current RRD session is user-owned, slow to recover, likely stale, and often not the thing under test. | Revit-backed behavior ran in a fresh test-owned process.                 |
| **AttachedRrd**       | Live-session proof must be treated as an attached runtime loop, not as normal compilation. | Rider/Revit/Host/session/document state is fragile and cannot be inferred from MSBuild success.           | A targeted probe behaved correctly in the currently running RRD session. |
| **Installed lane**    | Installed behavior must be validated from installed roots.                                 | MSI/product roots and dev/runtime roots intentionally differ.                                             | Installed bootstrap/runtime behavior, not source or RRD behavior.        |

## Peco wrapper decision

The Peco has narrow repo verification wrappers because this environment is unusually easy to misread:

- Rider and Revit are long-lived user processes.
- Hot reload can report success without proving the loaded Revit assembly graph is behaviorally fresh.
- Host reachability, Revit bridge connectivity, active documents, and log deltas are separate facts.
- Revit-backed tests can either own a fresh process or attach to an existing one; those are not interchangeable.
- Source-linked `pea`, installed `pea`, dev `Pe.Host`, and installed `Pe.Host` are different runtime roots.

The wrappers encode policy and collect evidence: `NoRrdContact` versus `RrdRequired`, read-only orientation before mutation, bounded logs, sync/restart guidance, test-owned process planning, command fallback, and explicit proof/does-not-prove language.

That does not make `BUILD.md` a Peco tool manual. The durable decision is: **when the claim depends on live Rider/Revit state, use the Peco live-loop abstraction instead of reproducing that orchestration by hand or resurrecting removed `pe-dev` commands.** The direct tool names belong in Peco instructions and skills, where they can evolve without rewriting the build philosophy.

## Environment limitations this repo designs around

- **Windows dotnet state can be poisoned.** Missing core Windows environment variables can break NuGet/MSBuild restore with errors such as `Value cannot be null. (Parameter 'path1')`. The build tool detects this and points to `tools/dotnet-sandbox-safe.ps1`; recovery notes live in `docs/ENVIRONMENT.md`.
- **Revit process startup is expensive.** Avoid touching RRD unless the current UI/session/document state is the subject of proof.
- **RRD is user-owned state.** A restart can cost minutes and may require reopening a model. Attached proof should be deliberate and evidence-based.
- **Hot reload is useful but not proof by itself.** Treat sync success as a step toward an attached behavior/log/script/test proof, not as the final freshness claim.
- **Terminal isolated outputs do not feed loaded RRD assemblies.** The safe compile lane writes `.artifacts/...`; package-local interactive outputs and loaded Revit DLLs are a different authority.
- **Installed and dev roots are separate.** Do not validate installed behavior against dev host/runtime roots.

## Build modes and output ownership

| Mode                              | Selected by                                       | Output owner                       | Decision                                                               |
| --------------------------------- | ------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| **Isolated**                      | Plain terminal `dotnet build`, `./build`, CI      | `.artifacts/...`                   | Default for safe source/package proof.                                 |
| **Interactive/package-local**     | Rider/IDE build or explicit non-isolated override | Package-local `bin/obj`            | Only for work that intentionally feeds Rider/RRD hot-reload baselines. |
| **Terminal interactive override** | `/p:PeIsolatedBuild=false`                        | Package-local `bin/obj` from shell | Escape hatch; can clobber Rider/RRD assumptions. Use deliberately.     |

Verified mechanics:

- Isolated builds redirect outputs into `.artifacts/build/...`.
- Non-isolated builds keep package-local `obj/$(Configuration)` intermediates.
- `Pe.App` isolated package builds publish into `.artifacts/publish/revit/$(Configuration)`.
- Repo guards disable `DeployAddin` and `LaunchRevit` during isolated terminal builds.
- `.Tests` configurations force off `DeployAddin` and `LaunchRevit`.
- Non-release interactive builds pin `AssemblyInformationalVersion` to stable `dev` to reduce hot-reload baseline churn from generated metadata.

## Rider/Nice3point debug launch decision

Rider **run/debug configurations** and MSBuild **solution/build configurations** are different inputs. For desktop Revit debugging, the durable model is:

```text
canonical Pe.App run/debug configuration
+ active Rider solution configuration such as Debug.R24 / Debug.R25 / Debug.R26
=> MSBuild Configuration
=> Directory.Build.props RevitVersion inference
=> Nice3point TargetFramework, Revit API refs, StartProgram, deploy, and launch behavior
```

The canonical `Pe.App` run/debug configuration is year-polymorphic. The active Rider solution configuration is the year authority. The repo should share this canonical config as `.run/Pe.App.run.xml` for stability and transparency, while leaving volatile `.idea` workspace state user-local. Cached launcher fields in saved Rider XML, such as `EXE_PATH` or `PROJECT_TFM`, are materialized Rider state and must not be treated as the durable source of truth.

A Rider `Build` before-launch step is part of the valid launch contract for RRD work because it runs the MSBuild/Nice3point path that builds, publishes, deploys the add-in, and triggers year-aware startup helpers. Hardcoded executable-path run/debug configurations may be useful as temporary diagnostics, but they are not the preferred automation contract because they can bypass or obscure the build/deploy path and produce stale RRD sessions.

Therefore automation that restarts RRD should prefer:

```text
select Debug.R## solution configuration
verify Rider reports Debug.R## as the selected solution configuration
select canonical Pe.App run/debug configuration
invoke Rider's Debug action
prove bridge/session/document behavior after launch
```

Invoking Rider's real `Debug` action matters: it produces the same visible launch/build/debug behavior as a manual Rider workflow. Programmatic execution shortcuts can report success without visibly launching Revit or the debugger.

Year-specific run/debug entries should be fallback or diagnostic aids unless a future Rider constraint proves the canonical path impossible.

### RiderBridge package compatibility

`Pe.RiderBridge` packages are capped by JetBrains IDE build metadata in both `tools/Pe.RiderBridge/build.gradle.kts` and `tools/Pe.RiderBridge/src/main/resources/META-INF/plugin.xml`. After a Rider major-build update, such as `RD-261`, bump the `untilBuild` / `until-build` cap and repackage through `tools/Pe.RiderBridge/package.ps1`. The install folder name can lag behind an in-place Rider update; use `product-info.json` for the actual Rider build number.

## Source compile decision

Use ordinary `dotnet build` when you need compile confidence.

```powershell
dotnet build .\source\Pe.Revit\Pe.Revit.csproj -c Debug.R25
dotnet build .\source\Pe.Host\Pe.Host.csproj -c Debug.R25
dotnet build .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25
```

This proves compile correctness only. It does not refresh RRD, package-local Rider outputs, installed product roots, or source-linked TypeScript payloads.

## Revit proof decisions

### FreshRevitProcess is the preferred autonomous proof lane

Use FreshRevitProcess when the current UI session is not itself under test. The repo helper plans a safe target year/session and uses the Revit test harness to launch/control Revit rather than reusing the current RRD process.

```powershell
pe-dev test --filter "Name~Reports_runtime_assembly_load_paths" --timeout-seconds 900
pe-dev test --plan --json --filter "Name~Reports_runtime_assembly_load_paths"
```

`--plan`/`--dry-run` resolves the lane without launching Revit, building, quarantining add-ins, running tests, or cleaning sessions. Real runs should include a bounded timeout because Revit launch and test-adapter hangs are otherwise easy to mistake for agent failure.

### AttachedRrd is for the currently running Rider/Revit session

Use AttachedRrd only when the active RRD session, active document, UI/session state, loaded package-local assemblies, or black-box product behavior is the thing being validated.

Do not treat attached proof as “run a build, then trust it.” The attached loop must answer separate questions:

1. Is Host reachable?
2. Is the private Revit bridge connected?
3. Is the required document/session state present?
4. Did the relevant runtime refresh/restart path actually happen?
5. Did a behavior probe, script, host operation, attached test, log delta, or Pea black-box interaction prove the intended behavior?

A Rider/IDE build may be part of preparing package-local outputs, but it is not a universal instruction and may be blocked or inappropriate while a debug session is running. Plain terminal `dotnet build` remains the compile default. When runtime freshness matters, coordinate through the Peco attached-runtime abstraction and prove behavior at the end.

Attached probes can include host operations, script execution against the running document, attached Revit tests, or black-box Pea review. Script execution is a first-class proof path because it can reference Pe assemblies and exercise Host/Revit behavior in the live session. Pea black-box review is also a first-class product harness because it tests the operator-facing product rather than the repo agent’s assumptions.

Do not document or depend on removed public `pe-dev` command groups (`doctor`, `status`, `sync`, `env`, `revit`, or `verify`) for attached RRD work. Attached live-loop behavior belongs to Peco-only verification wrappers and skills, not to a broad public CLI surface.

## Packaging and release decisions

### `./build` is packaging authority, not compile authority

Use `./build` for package and release orchestration. Do not grow it into a replacement for normal `dotnet build`.

```powershell
dotnet run --project .\build\Build.csproj -c Release -- pack
dotnet run --project .\build\Build.csproj -c Release -- pack --configuration Release.R25
```

Pack targets:

```powershell
dotnet run --project .\build\Build.csproj -c Release -- pack desktop --configuration Release.R25
dotnet run --project .\build\Build.csproj -c Release -- pack pea
dotnet run --project .\build\Build.csproj -c Release -- pack installer --configuration Release.R25
dotnet run --project .\build\Build.csproj -c Release -- pack automation
dotnet run --project .\build\Build.csproj -c Release -- pack all
```

`pack` with no explicit target is equivalent to `pack all`. `pack pea` builds only the installed Pea payload package so it can be proved without compiling Revit add-ins or creating an MSI. `pack installer` also creates the Pea payload because the MSI embeds it.

Package outputs:

- Desktop bundle: `.artifacts/packages/bundles/Pe.App.bundle.zip`
- Pea payload: `.artifacts/packages/pea/Pe.Tools.pea.<version>.zip` plus `.json` manifest
- Design Automation appbundle: `.artifacts/packages/automation/Pe.Dev.RevitAutomation.Worker.<year>.appbundle.zip`
- Installer: `.artifacts/packages/installers/*.msi`

### Publish is a GitHub release workflow

The build pipeline has a `publish` command, but its module publishes release assets through GitHub and is skipped without a GitHub token. Treat it as CI/release-lane behavior, not a normal local validation command.

```powershell
dotnet run --project .\build\Build.csproj -c Release -- pack publish
```

## Runtime and install layout decisions

`Pe.Shared.Product` owns durable product identity and local runtime/user layout. Generated build projections are not the authority.

Key local roots:

```text
%LocalAppData%\Positive Energy\Pe.Tools\bin\host\      # installed shared Pe.Host runtime
%LocalAppData%\Positive Energy\Pe.Tools\bin\pea\       # PATH-visible pea launcher/payloads
%LocalAppData%\Positive Energy\Pe.Tools\dev\bin\host\  # dev-lane host runtime, not MSI-owned
```

Do not validate installed behavior against the dev host root. MSI upgrades intentionally replace the installed host runtime tree under `bin\host`; installer cleanup must never target `dev\bin\host`.

Installed Pea payloads are versioned under `bin\pea\versions\<version>`. The launcher contract is:

```text
bin\pea\
  pea.cmd
  current.txt
  versions\<version>\
    bun.exe
    app\installed-main.js
    node_modules\@opentui\core-win32-x64\...
    node_modules\@duckdb\node-bindings-win32-x64\...
    bin\napi-v6\win32\x64\...
```

The payload is a Bun-targeted bundle plus explicit native sidecars, not a package-manager install. Build machines need Bun and the `source/pe-tools` dependency store available, but end-user machines do not run `pnpm install`, `pnpm deploy`, or dependency resolution. `pea.cmd` runs the selected version's `bun.exe app\installed-main.js`.

Package/artifact proof for `pack pea` is NoRrdContact. It proves archive shape and portable light CLI behavior, such as `--help` and host-operation contract search from a temp root. It does not prove AttachedRrd behavior, FreshRevitProcess behavior, installed MSI registration, or full TUI rendering freshness.

### PATH-visible CLI decision

`pea` is the product/operator CLI and `peco` is the repo/dev coding-agent CLI. In the source-linked dev lane, both are PATH-visible launcher commands under the installed-shaped `bin\pea` root, but they execute TypeScript sources from `source/pe-tools/apps` instead of an installer payload.

The clean source-linked CLI model is:

- Bare `pea` launches the Pea Revit/operator agent TUI from `source/pe-tools/apps/pea/src/main.ts`.
- Bare `peco` launches the Peco repo coding-agent TUI from `source/pe-tools/apps/pe-code/src/main.ts`.
- OpenTUI native renderer launch must use Bun in the source-linked lane. Node `tsx` can import OpenTUI, but `createCliRenderer()` needs native FFI and fails on current Node runtimes without Node 26.3+ experimental FFI flags.
- `pea <subcommand> ...` stays available for product/operator commands such as `host` and `script`.
- `peco <subcommand> ...` stays available for repo/dev commands such as `live`, `script`, and `talk-to-pea`.
- `pea --installed ...` is the explicit installed-lane selector. Use it in installed-lane validation and scripts where ambiguity would be expensive.
- `pea --dev ...` is the explicit source-linked selector. It requires `dev-source.txt` and runs the Pea app from `source/pe-tools/apps/pea` through the repo TypeScript runtime.
- `PEA_RUNTIME=dev` is a local shell convenience only. Do not use ambient environment selection as proof of lane.
- `Pe.App` must pass `--dev` or `--installed` when launching Pea from Revit, based on its `Pe.App.runtime.json` descriptor. The Host binary already follows that descriptor; Pea must not silently cross lanes through a linked source file.

This source-linked shape is intentionally about developer iteration, not installer payload ownership. A `dev-source.txt` file is a capability registration for launchers. It does not prove packaged installed behavior and should not be used as installed-lane evidence.

`pe-dev` is different by design: it is source/dev-only repo tooling, not an installed product slice. The MSI must not install it, register it on PATH, or harvest a `pe-dev` payload. Developers bootstrap their own PATH entry to the build output they want to use:

```powershell
dotnet run --project .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25 -- bootstrap-path
```

`bootstrap-path` points the user PATH at `AppContext.BaseDirectory` for that invocation, so `dotnet run -c Debug.R25 -- bootstrap-path` targets the project-bin output for `Debug.R25`. This keeps `pe-dev` personal and configuration-specific without creating another product runtime root.

This asymmetry is deliberate: Host needs a dev-only root to avoid installed-runtime file locks and stale installed contracts; `pea` and `peco` need stable operator/dev launch commands; `pe-dev` should stay a local source workflow helper.

`pea`, `peco`, and `pe-dev` are separate surfaces:

- `pea` starts the source-linked Pea Revit/operator workbench TUI; `pea host` and `pea script` expose product command subgroups.
- `peco` starts the MastraCode-based repo coding agent; `peco live`, `peco script`, and `peco talk-to-pea` expose repo/dev command subgroups.
- `pe-dev` is the narrow C# source/dev CLI for PATH bootstrap, source linking, codegen, FreshRevitProcess tests, and automation commands.

Useful dev-lane refresh commands:

```powershell
pe-dev bootstrap-path
pe-dev pea link-dev
pea
peco
pea --dev --help
pea --installed --help
```

`pe-dev pea link-dev` writes `dev-source.txt` next to PATH-visible `pea.cmd` / `peco.cmd` launchers and refreshes those launchers. It does not mutate `current.txt` or install a `versions\dev` payload. Use `pea`, `peco`, or `pea --dev ...` for source-linked development; use `pea --installed ...` for installed payload behavior.

Do not use a dev command to rewrite the installed-shaped `pea` payload selection. A previous `pe-dev pea install-dev` command was removed because it wrote `versions\dev` and `current.txt` under `bin\pea`, making installed-lane validation ambiguous. Source-linked dev work should use `link-dev` plus `pea` / `peco`; packaged installed payload validation should use the installer/package lane or `pea --installed ...` against an installed payload.

## Generated contract decisions

Generated contracts are projections, not hand-maintained source.

```powershell
pe-dev codegen sync --target build
pe-dev codegen sync --target host-types
pe-dev codegen sync --target host-client
pe-dev codegen sync --target product
```

`sync` updates generated projections and formats affected TypeScript packages. Host DTO TypeScript is generated through `pe-dev`/TypeGen and normalized for NodeNext `.js` imports; do not run `dotnet-typegen` or maintain `tgconfig.json` by hand.

The build tool also exposes:

```powershell
dotnet run --project .\build\Build.csproj -c Release -- sync-contracts
```

Use it after changing human-authored build/product contract inputs such as `build/authored/*` or `Pe.Shared.Product` layout identity.

## Design Automation decision

Design Automation flows are normally `NoRrdContact`. Keep first-pass audit manifests intentionally small: one or two models before broadening.

```powershell
pe-dev automation auth login
pe-dev automation browse hubs
pe-dev automation manifest create --path docs/context/my-run/schedules.json
pe-dev automation submit schedules --manifest docs/context/my-run/schedules.json
pe-dev automation inspect receipt --receipt latest --download-artifacts true
```

The automation shell is `Pe.Dev.RevitAutomation.Worker`, not desktop `Pe.App`. Desktop and DA should remain sibling shells over shared DA-safe runtime packages.

## Build matrix and configuration facts

- Default Revit year: `2025`.
- Default no-config solution configuration: `Debug.R25`.
- Solution configurations span `Debug`/`Release` for R23-R26, plus matching `.Tests` variants.
- `PeStableCliConfiguration` defaults to `Debug.R25`.
- Revit 2023/2024 packages target `net48`.
- Revit 2025/2026 and out-of-proc tooling target `net8.0-windows`.
- `Pe.Shared.*` packages are `netstandard2.0` shared-neutral libraries.
- Build and installer projects are explicit build-infrastructure tools.
- `Pe.Revit.Tests` is the only package that supports both `AttachedRrd` and `FreshRevitProcess` verification.

## Build/package authorities

- `Pe.Tools.slnx` is IDE organization and parity input, not the build-matrix source of truth.
- `build/authored/BuildMatrix.props` owns Revit-year and configuration-matrix vocabulary.
- `build/authored/BuildTaxonomy.props` owns package taxonomy and Revit-awareness metadata.
- `build/authored/PackagePolicy.props` owns repo-wide conditional package-reference policy.
- `build/generated/*.props` and `*.targets` are generated MSBuild projections.
- `Directory.Build.props` / `Directory.Build.targets` enforce isolated defaults, target-framework projection, execution policies, and guardrails.
- `build/BuildArtifactLayout.cs` owns `.artifacts/...` package topology.
- `build/ProductLayoutAuthority.cs` composes repo/build/install layout and writes installer payload manifests.
- `install/Installer.cs` consumes the generated installer payload manifest; do not run `install/Installer.csproj` directly unless you already have that manifest.

## Compact command index

| Goal                              | Use                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Safe source compile               | `dotnet build .\source\<Package>\<Package>.csproj -c Debug.R25`                                                                       |
| Recover poisoned dotnet sandbox   | `.\tools\dotnet-sandbox-safe.ps1 <dotnet args>`                                                                                       |
| Fresh Revit proof                 | `pe-dev test --filter "Name~..." --timeout-seconds 900`                                                                               |
| Fresh proof planning              | `pe-dev test --plan --json --filter "Name~..."`                                                                                       |
| Attached RRD proof                | Use Peco attached-runtime verification wrappers/skills, then prove with an attached operation/script/test/log/Pea product probe. |
| Product host/log/script check     | `pea host ...`, `pea script ...`                                                                                                      |
| Package artifacts/MSI             | `dotnet run --project .\build\Build.csproj -c Release -- pack`                                                                        |
| Package one year                  | `dotnet run --project .\build\Build.csproj -c Release -- pack --configuration Release.R25`                                            |
| Package desktop bundle only       | `dotnet run --project .\build\Build.csproj -c Release -- pack desktop --configuration Release.R25`                                    |
| Package Pea payload only          | `dotnet run --project .\build\Build.csproj -c Release -- pack pea`                                                                    |
| Package installer only            | `dotnet run --project .\build\Build.csproj -c Release -- pack installer --configuration Release.R25`                                  |
| Package automation appbundle only | `dotnet run --project .\build\Build.csproj -c Release -- pack automation`                                                             |
| Publish GitHub release artifacts  | `dotnet run --project .\build\Build.csproj -c Release -- pack publish`                                                                |
| Link source `pea` dev lane        | `pe-dev pea link-dev`, then `peco` or `pea --dev ...`                                                                              |
| Validate installed `pea` lane     | `pea --installed ...`                                                                                                                 |
| Generated contract update         | `pe-dev codegen sync --target <target>`                                                                                               |
