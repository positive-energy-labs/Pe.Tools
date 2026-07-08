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
| **FreshRevitProcess** | Fresh Revit-backed proof should use SDK `pe-revit test fresh`, not the active UI session.  | The current RRD session is user-owned, slow to recover, likely stale, and often not the thing under test. | Revit-backed behavior ran in a fresh test-owned process.                 |
| **AttachedRrd**       | Live-session proof must be treated as an attached runtime loop, not as normal compilation. | Rider/Revit/Host/session/document state is fragile and cannot be inferred from MSBuild success.           | A targeted probe behaved correctly in the currently running RRD session. |
| **Installed lane**    | Installed behavior must be validated from installed roots.                                 | MSI/product roots and dev/runtime roots intentionally differ.                                             | Installed bootstrap/runtime behavior, not source or RRD behavior.        |

## Peco context decision

Peco keeps narrow repo-specific context tools because this environment is unusually easy to misread:

- Rider and Revit are long-lived user processes.
- Hot reload can report success without proving the loaded Revit assembly graph is behaviorally fresh.
- Host reachability, Revit bridge connectivity, active documents, and log deltas are separate facts.
- Revit-backed tests can either own a fresh process or attach to an existing one; those are not interchangeable.
- Source-linked `pea`, installed `pea`, dev `Pe.Host`, and installed `Pe.Host` are different runtime roots.

The SDK encodes live/test policy and mutation mechanics: `NoRrdContact` versus `RrdRequired`, sync/restart guidance, test-owned process planning, command fallback, and explicit proof/does-not-prove language. Peco adds the repo/product context around that: read-only orientation, bounded Pea/host/Revit logs, product probes, and black-box Pea feedback.

That does not make `BUILD.md` a Peco tool manual. The durable decision is: **when the claim depends on live Rider/Revit state, use SDK `pe-revit live/test` mechanics instead of reproducing that orchestration by hand or resurrecting removed `pe-dev` commands; use Peco only when Pea status/logs or product probes should accompany the proof.**

## Environment limitations this repo designs around

- **Windows dotnet state can be poisoned.** Missing core Windows environment variables can break NuGet/MSBuild restore with errors such as `Value cannot be null. (Parameter 'path1')`. The build tool detects this and points to `tools/dotnet-sandbox-safe.ps1`; recovery notes live in `docs/ENVIRONMENT.md`.
- **Revit process startup is expensive.** Avoid touching RRD unless the current UI/session/document state is the subject of proof.
- **RRD is user-owned state.** A restart can cost minutes and may require reopening a model. Attached proof should be deliberate and evidence-based.
- **Hot reload is useful but not proof by itself.** Treat sync success as a step toward an attached behavior/log/script/test proof, not as the final freshness claim. The SDK shadow deploy writes a content-hash stamp per build; `pe-revit live status` reports `deployedStamp` vs `loadedStamp`, which is the concrete deploy-vs-loaded freshness check that replaced the old mutate-a-signal-file approach — but a matching stamp still proves only which assembly is loaded, not that a given behavior is correct.
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

## Rider/SDK debug launch decision

Rider **run/debug configurations** and MSBuild **solution/build configurations** are different inputs. For desktop Revit debugging, the durable model is:

```text
canonical Pe.App run/debug configuration
+ active Rider solution configuration such as Debug.R24 / Debug.R25 / Debug.R26
=> MSBuild Configuration
=> Pe.Revit.Sdk RevitVersion inference from the Directory.Build.props year list
=> Pe.Revit.Sdk TargetFramework, Revit API refs, StartProgram, deploy, and launch behavior
```

The canonical `Pe.App` run/debug configuration is year-polymorphic. The active Rider solution configuration is the year authority. The repo should share this canonical config as `.run/Pe.App.run.xml` for stability and transparency, while leaving volatile `.idea` workspace state user-local. Cached launcher fields in saved Rider XML, such as `EXE_PATH` or `PROJECT_TFM`, are materialized Rider state and must not be treated as the durable source of truth.

A Rider `Build` before-launch step is part of the valid launch contract for RRD work because it runs the MSBuild/`Pe.Revit.Sdk` path that builds, publishes, deploys the add-in, and triggers year-aware startup helpers. Hardcoded executable-path run/debug configurations may be useful as temporary diagnostics, but they are not the preferred automation contract because they can bypass or obscure the build/deploy path and produce stale RRD sessions.

The `Pe.Revit.Sdk` `pe-revit live` surface now owns this build → deploy → start/restart orchestration against the canonical config. Prefer it over hand-driving Rider:

```text
dotnet tool run pe-revit -- live --project .\source\Pe.App\Pe.App.csproj --year 2025 --json
dotnet tool run pe-revit -- live --project .\source\Pe.App\Pe.App.csproj --year 2025 --restart --json
```

Bare `pe-revit live` builds/deploys, applies Rider Hot Reload when safe, and can start RRD when it is missing; `--restart` forces a fresh session. Agents should call the SDK live surface directly, then use `live_loop_context` when Pea/host/Revit status or log evidence matters. The manual path — select `Debug.R##`, select the canonical `Pe.App` run/debug configuration, invoke Rider's real `Debug` action — remains the underlying human model and the fallback if the SDK live surface cannot converge; programmatic Rider shortcuts can report success without visibly launching Revit or the debugger.

Year-specific run/debug entries should be fallback or diagnostic aids unless a future Rider constraint proves the canonical path impossible.

### RiderBridge package compatibility

`Pe.RiderBridge` is SDK-owned. Install or refresh it through `pe-revit live install-rider-plugin`; do not keep a Pe.Tools-local plugin source or package lane.

## Source compile decision

Use ordinary `dotnet build` when you need compile confidence.

```powershell
dotnet build .\source\Pe.Revit\Pe.Revit.csproj -c Debug.R25
dotnet build .\source\Pe.App\Pe.App.csproj -c Debug.R25
dotnet build .\source\Pe.Dev.Cli\Pe.Dev.Cli.csproj -c Debug.R25
```

This proves compile correctness only. It does not refresh RRD, package-local Rider outputs, installed product roots, or source-linked TypeScript payloads.

## Revit proof decisions

### FreshRevitProcess is the preferred autonomous proof lane

Use FreshRevitProcess when the current UI session is not itself under test. SDK `pe-revit test fresh` plans a safe target year/session and uses the Revit test harness to launch/control Revit rather than reusing the current RRD process.

```powershell
dotnet tool run pe-revit -- test fresh --filter "Name~Reports_runtime_assembly_load_paths" --timeout-seconds 900 --json
dotnet tool run pe-revit -- test fresh --plan --json --filter "Name~Reports_runtime_assembly_load_paths"
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

A Rider/IDE build may be part of preparing package-local outputs, but it is not a universal instruction and may be blocked or inappropriate while a debug session is running. Plain terminal `dotnet build` remains the compile default. When runtime freshness matters, coordinate through SDK `pe-revit live/test attached` and use Peco only for Pea status/log hooks or product probes.

Attached probes can include host operations, script execution against the running document, attached Revit tests, or black-box Pea review. Script execution is a first-class proof path because it can reference Pe assemblies and exercise Host/Revit behavior in the live session. Pea black-box review is also a first-class product harness because it tests the operator-facing product rather than the repo agent’s assumptions.

Do not document or depend on removed public `pe-dev` command groups (`doctor`, `status`, `sync`, `env`, `revit`, or `verify`) for attached RRD work. SDK `pe-revit live` owns mutation/freshness mechanics; Peco adds Pea status/log context and product-facing probes.

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
    app\pea.exe
    node_modules\@opentui\core-win32-x64\...
    node_modules\@duckdb\node-bindings-win32-x64\...
    node_modules\@anush008\tokenizers-win32-x64-msvc\...
    node_modules\@libsql\win32-x64-msvc\...
    bin\napi-v6\win32\x64\...
```

The payload is a Node SEA executable produced by Vite+/tsdown from `source/pe-tools/apps/pea/src/main.ts` plus explicit native sidecars, not a package-manager install and not an alternate installed-only entrypoint. Build machines need Vite+ with Node 25.7.0 or newer for tsdown `exe` packaging and the `source/pe-tools` dependency store available, but end-user machines do not run `pnpm install`, `pnpm deploy`, or dependency resolution. `pea.cmd` runs the selected version's `app\pea.exe`.

Private `source/pe-tools` packages are source-exported for development. Their Vite+ package configs use explicit `pack.entry` values so `vp pack` can still produce artifacts without mutating package exports back to `dist`; keep installed payload bundling as the artifact boundary instead of adding parallel `main` / `main-installed` source entrypoints.

Package/artifact proof for `pack pea` is NoRrdContact. It proves archive shape and portable light CLI behavior, such as `--help` and host-operation contract search from a temp root. It does not prove AttachedRrd behavior, FreshRevitProcess behavior, installed MSI registration, or full TUI rendering freshness.

### PATH-visible CLI decision

`pea` is the product/operator CLI and `peco` is the repo/dev coding-agent CLI. In the source-linked dev lane, both are PATH-visible launcher commands under the installed-shaped `bin\pea` root, but they execute TypeScript sources from `source/pe-tools/apps` instead of an installer payload.

The clean source-linked CLI model is:

- Bare `pea` launches the Pea Revit/operator agent TUI from `source/pe-tools/apps/pea/src/main.ts`.
- Bare `peco` launches the Peco repo coding-agent TUI from `source/pe-tools/apps/pe-code/src/main.ts`.
- Source-linked `pea` / `peco` package scripts use `vp exec jiti src/main.ts`. This keeps the runtime under Vite+'s managed Node while letting `jiti` handle the repo's TypeScript/NodeNext source graph. Raw `vp exec node src/main.ts` is not enough for this source graph because Node's built-in TypeScript support is still strip/transform limited and does not resolve the repo's `.js` source specifiers back to `.ts`.
- Source-linked `pea web` / `peco web` route through `source/pe-tools/tools/dev-web`. That helper owns the two-process dev web model: a watched backend workbench API plus the Vite website dev server.
- `pea <subcommand> ...` stays available for product/operator commands such as `host` and `script`.
- `peco <subcommand> ...` stays available for repo/dev commands such as `live`, `script`, and `talk-to-pea`.
- `pea --installed ...` is the explicit installed-lane selector. Use it in installed-lane validation and scripts where ambiguity would be expensive.
- `pea --dev ...` is the explicit source-linked selector: it routes through the shim's `pea.dev.txt` marker (written by `pe-revit dev link`) and runs the Pea app from `source/pe-tools/apps/pea`.
- `PEA_RUNTIME=dev` is a local shell convenience only. Do not use ambient environment selection as proof of lane.
- `Pe.App`'s lane comes from `PePayloadContext`: loaded by the installed loader shim ⇒ `Deployment` is the lane-pinned `InstalledProduct` (host via `EnsureRunning`, siblings via `Resolve`); self-hosted classic deploy ⇒ dev lane. There is no `Pe.App.runtime.json` descriptor anymore, and no ambient lane inference.

This source-linked shape is intentionally about developer iteration, not installer payload ownership. A shim's `{name}.dev.txt` marker is a per-shim capability registration written by `pe-revit dev link`. It does not prove packaged installed behavior and should not be used as installed-lane evidence.

`pe-dev` is source/dev-only repo tooling, not an installed product slice: release installs never ship it (its PathShim is targetless, so users never see it). Devs get it on PATH the same way as pea/peco — the manifest declares a `pe-dev` PathShim with a `dotnet run` dev command; `pe-revit dev link` routes it to this checkout. No hand PATH edits, no separate bootstrap.

This asymmetry is deliberate: Host needs a dev-only root to avoid installed-runtime file locks and stale installed contracts; `pea` and `peco` need stable operator/dev launch commands; `pe-dev` should stay a local source workflow helper.

`pea`, `peco`, and `pe-dev` are separate surfaces:

- `pea` starts the source-linked Pea Revit/operator workbench TUI; `pea host` and `pea script` expose product command subgroups.
- `peco` starts the MastraCode-based repo coding agent; `peco live`, `peco script`, and `peco talk-to-pea` expose repo/dev command subgroups.
- `pe-dev` is the narrow C# source/dev CLI for PATH bootstrap, source linking, web dev supervision, and automation commands.

### Source-linked web dev

Source-linked web dev is intentionally one user command over two local processes:

- `pea web` or `peco web` from a source-linked launcher starts the repo-owned `tools/dev-web` supervisor.
- `pe-dev web pea` and `pe-dev web peco` run the same supervisor explicitly when debugging the dev lane.
- The supervisor starts the selected backend workbench API with `node --watch --import jiti/register src/main.ts web ...` and starts the Vite website dev server.
- Default local ports are fixed: website `http://127.0.0.1:5173`, workbench API `http://127.0.0.1:43112`, token `dev-loopback`.
- The supervisor takes over those two ports by default on Windows. Pass `--no-takeover` when a smoke test or manual session should fail instead of killing the port owner.
- Pass `--no-watch` to disable backend Node watch during smoke tests or debugger-driven sessions.

The website Vite proxy is part of this dev lane. It forwards `/workbench` to `PE_WORKBENCH_AGENT_URL` or `http://127.0.0.1:43112`, adding `PE_WORKBENCH_DEV_TOKEN` or `dev-loopback`. If the backend is not on the default port, visit the website with a `?workbench=<encoded backend url>` query or set the proxy environment variables before starting Vite.

Installed/product web behavior is separate. `pea --installed web ...` runs the packaged Pea CLI path; source-linked `pea web` is a dev supervisor convenience, not installed-lane proof.

Useful dev-lane refresh commands:

```powershell
pe-revit path ensure     # once per machine: registers <appBase>\shims on the user PATH (safely)
pe-revit dev link        # from this checkout: routes pea/peco/pe-dev shims to source
pe-revit dev status      # shows each shim's resolved lane
pe-dev web pea
pea
peco
pea --installed --help
```

PATH and dev-shim management is SDK-owned (`pe-revit path`, `pe-revit dev`). The old
`pe-dev bootstrap-path` and `pe-dev pea link-dev` commands were removed: they hand-edited the user
PATH (REG_SZ overwrite, whole-PATH rewrites) and maintained a second launcher generator in `bin\pea`.
One PATH entry — the product shims dir — is the condoned way onto PATH; everything else is a shim
file in that dir. A shim runs dev when ITS `{name}.dev.txt` exists (written by `dev link`), installed
otherwise; `--installed` / `PE_LANE=installed` forces the installed target.

If you used the old flow on this machine, clean up once: delete `%LOCALAPPDATA%\Positive Energy\Pe.Tools\bin\pea\*.cmd`
and remove the `bin\pea` / Pe.Dev.Cli output-dir entries from your user PATH (the SDK never writes those).

Do not use a dev command to rewrite the installed-shaped `pea` payload selection: source-linked dev
work is `pe-revit dev link` + `pea` / `peco`; packaged installed payload validation is the
installer/package lane or `pea --installed ...`.

## Contract decisions (runtime op catalog)

The `pe-dev codegen` tier is gone. The connected Revit session is the source of truth for the whole cross-language contract: C# `BridgeOp` fields/`[BridgeOperation]` methods self-register at startup, and the TS host serves the live catalog — request/response JSON Schemas included — from `GET /ops` (full architecture: `docs/features/host-runtime-ops/SPEC.md`).

TypeScript compile-time types are a checked-in lockfile generated from that live catalog:

```powershell
# with Revit connected — the generator lives in the package it writes
pnpm --filter @pe/host-contracts codegen         # regenerate src/generated/host-ops.generated.ts
pnpm --filter @pe/host-contracts codegen:check   # drift gate: exit 1 when the checked-in types disagree with /ops
```

The generator is `packages/host-contracts/scripts/host-typegen.ts`; root `pnpm typegen:check` delegates to `codegen:check` and runs inside `pnpm ready`. Regenerate after changing a C# request/response DTO or adding an op, and commit the result like a lockfile. Schema required-ness is honest per direction: response properties are required exactly when non-nullable in C#; request properties are required only when non-nullable *and* their constructor parameter has no default (`BridgeOpSchemaGenerator`).

What lives in `@pe/host-contracts`:

- `src/generated/host-ops.generated.ts` — the typegen lockfile: per-op request/response interfaces, the `HostOps` map, `hostOpKeys`.
- `src/operation-types.ts` — hand-authored TS-only op schemas (settings runtime, APS auth, logs), key guards, `OpKey`/`OpRequestOf`/`OpResponseOf`.
- `src/contracts/` — hand-authored bridge protocol, product constants, and operation vocabulary.

Session selection is caller scope, not operation payload: `HostSessionScope.bridgeSessionId` travels as the `x-pe-bridge-session-id` header on `POST /call`.

### Field options, examples, and the registration gate

Operation metadata travels with the thing it describes, and the connected session validates it at registration — callers never hand-maintain a parallel copy.

- **Field options and descriptions live on the request DTO.** `[FieldOptions("<domain>")]` on a property (`source/Pe.Shared.RevitData/FieldOptionsAttribute.cs`) makes `BridgeOpSchemaGenerator` emit an `x-options` node on that property's request schema, and the property's XML `<summary>` becomes its schema `description`. The `/ops` form renders an option-backed string field as an input + `<datalist>` and shows the description; agents read the same off the catalog. This requires `GenerateDocumentationFile` on the *defining* project and the `.xml` present beside the assembly at runtime (it deploys with the bundle, so a missing description usually means the dependency's outputs went stale — see the SDK stamp/deploy note above — not that XML was skipped).
- **Options resolve live, by source key.** The `revit.catalog.field-options` op (`{ sourceKey }` → `FieldOptionsData`) resolves against the shared `SettingsValueDomainRegistry` — the *same* value domains the settings field-options path uses, so category/family/parameter lists come from the open document. Because it resolves by key alone (no property binding), a source key must be globally unambiguous.
- **Registration is the validation gate.** `BridgeOpRegistry` scans in two phases — discover + validate the whole set, then commit — so a failed op cannot half-register and mask the real error when the bridge supervisor re-scans on every reconnect. Validation strict-deserializes every request example and safe default against the request type (`MissingMemberHandling.Error`), so example drift fails registration and the unit tests instead of reaching a caller. Examples and call guidance are capped at two entries each.

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
- Revit 2023/2024 packages target `net48`.
- Revit 2025/2026 and out-of-proc tooling target `net8.0-windows`.
- `Pe.Shared.*` packages are `netstandard2.0` shared-neutral libraries.
- Build packaging projects are explicit build-infrastructure tools.
- `Pe.Revit.Tests` is the only package that supports both `AttachedRrd` and `FreshRevitProcess` verification.

## Build/package authorities

- `Pe.Tools.slnx` is IDE organization and parity input, not the build-matrix source of truth.
- `Directory.Build.props` owns the repo Revit-year list, default year, short solution configurations, isolated defaults, and product knobs.
- `Pe.Revit.Sdk` owns project taxonomy, target-framework projection, Revit package policy, deploy, and guardrails.
- `Pe.Revit.Versioning` owns non-MSBuild Revit suffixes and Design Automation support facts.
- `build/BuildArtifactLayout.cs` owns `.artifacts/...` package topology.
- `build/ProductLayoutAuthority.cs` composes repo/build/install layout and SDK installer payload paths.
- `pe-revit msi` owns generated MSI authoring from the SDK payload manifest emitted by `build/Modules/CreateInstallerModule.cs`.

## Compact command index

| Goal                              | Use                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Safe source compile               | `dotnet build .\source\<Package>\<Package>.csproj -c Debug.R25`                                                                  |
| Recover poisoned dotnet sandbox   | `.\tools\dotnet-sandbox-safe.ps1 <dotnet args>`                                                                                  |
| Fresh Revit proof                 | `dotnet tool run pe-revit -- test fresh --filter "Name~..." --timeout-seconds 900 --json`                                        |
| Fresh proof planning              | `dotnet tool run pe-revit -- test fresh --plan --json --filter "Name~..."`                                                       |
| Attached RRD proof                | Use SDK `pe-revit live/test attached`; use Peco context/product tools when Pea status/logs or product probes should accompany the proof. |
| Product host/log/script check     | `pea host ...`, `pea script ...`                                                                                                 |
| Package artifacts/MSI             | `dotnet run --project .\build\Build.csproj -c Release -- pack`                                                                   |
| Package one year                  | `dotnet run --project .\build\Build.csproj -c Release -- pack --configuration Release.R25`                                       |
| Package desktop bundle only       | `dotnet run --project .\build\Build.csproj -c Release -- pack desktop --configuration Release.R25`                               |
| Package Pea payload only          | `dotnet run --project .\build\Build.csproj -c Release -- pack pea`                                                               |
| Package installer only            | `dotnet run --project .\build\Build.csproj -c Release -- pack installer --configuration Release.R25`                             |
| Package automation appbundle only | `dotnet run --project .\build\Build.csproj -c Release -- pack automation`                                                        |
| Publish GitHub release artifacts  | `dotnet run --project .\build\Build.csproj -c Release -- pack publish`                                                           |
| Link source dev shims             | `pe-revit path ensure` (once), `pe-revit dev link`, then `pea` / `peco` / `pe-dev`                                               |
| Run source web dev explicitly     | `pe-dev web pea` or `pe-dev web peco`                                                                                            |
| Validate installed `pea` lane     | `pea --installed ...`                                                                                                            |
| Regenerate host op types          | `pnpm --filter @pe/host-contracts codegen` (Revit connected); `codegen:check` is the drift gate                                 |
