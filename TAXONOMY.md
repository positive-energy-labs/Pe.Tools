# TAXONOMY

Living vocabulary for build/runtime/deployment decisions. Use this to translate "how do I..." into the right lane, workflow, command surface, and safety policy.

## Decision Axes

| Axis | Question | Values |
| --- | --- | --- |
| **module taxonomy** | What kind of code package is this? | `BuildTool`, `InstallerTool`, `DesktopShell`, `RevitRuntime`, `TestHarness`, `AutomationShell`, `OperatorSurface`, `HostService`, `SharedNeutral`, `ExternalIntegration` |
| **product taxonomy** | What durable product/runtime shape is produced? | `BuildInfrastructure`, `DesktopAddin`, `HostRuntime`, `DevTooling`, `AutomationRuntime`, `RevitRuntime`, `TestHarness`, `SharedLibrary`, `ExternalIntegration` |
| **installer component taxonomy** | What MSI-visible/install-owned slice is this? | `RevitAddin`, `HostRuntime`, `PeaCli`, `PeDevCli`, `RuntimeState`, `UserContent`, `AutomationBundle` |
| **workflow taxonomy** | What is the operator doing? | `Build`, `Verify`, `Package`, `Publish` |
| **runtime lane** | Which local machine lane owns the running binaries/state? | `Dev`, `Install` |
| **execution policy** | May this touch live Rider-driven Revit? | `NoRrdContact`, `RrdRequired` |
| **build mode** | Where do compiler outputs go? | `Isolated`, `Interactive` |
| **verify target** | What Revit host is verifying behavior? | `AttachedRrd`, `FreshRevitProcess` |
| **target framework class** | Which TFM family should resolve? | `Explicit`, `SharedNeutral`, `OutOfProcNet8`, `RevitRuntime`, `RevitTest`, `AutomationWorker` |

## How-do-I Mapping

| If you ask... | Workflow | Lane | Execution policy | Default surface |
| --- | --- | --- | --- | --- |
| "Compile this safely" | `Build` | none | `NoRrdContact` | `dotnet build <package>.csproj -c Debug.R25` |
| "Check generated contracts" | `Verify` | none | `NoRrdContact` | `pe-dev codegen check` |
| "Update generated contracts" | `Verify`/source update | `Dev` | `NoRrdContact` | `pe-dev codegen sync ...` |
| "Use current source in live RRD" | `Verify` | `Dev` | `RrdRequired` | Rider build, then `pe-dev verify revit sync` |
| "Run a script against live Revit" | `Verify` | `Dev` | `RrdRequired` | `pea script ...` after sync |
| "Run attached Revit tests" | `Verify` | `Dev` | `RrdRequired` | sync, then explicit-year `dotnet test` |
| "Run fresh Revit tests" | `Verify` | `Dev` | `NoRrdContact` | `pe-dev verify revit fresh ...` |
| "Package product artifacts" | `Package` | none | `NoRrdContact` | `dotnet run --project build/Build.csproj -- pack` |
| "Build the installer" | `Package` | none | `NoRrdContact` | `pack` creates MSI under `.artifacts/packages/installers` |
| "Validate installed product" | `Verify` | `Install` | `NoRrdContact` unless explicitly opening RRD | install MSI, run installed `pea`/host paths |
| "Work on pe-dev/pea tooling" | `Build`/`Verify` | `Dev` | `NoRrdContact` | `dotnet build Pe.Dev.Cli`, `pe-dev pea install-dev` |
| "Publish release artifacts" | `Publish` | none | `NoRrdContact` | `dotnet run --project build/Build.csproj -- pack publish` |

## Runtime Lanes

| Lane | Purpose | Roots | Owner |
| --- | --- | --- | --- |
| **Dev** | Repo/operator iteration. May mirror CLI/dev host outputs for local work. | `%LocalAppData%\Positive Energy\Pe.Tools\dev\...`, `%LocalAppData%\Positive Energy\Pe.Tools\bin\pe-dev\`, `%LocalAppData%\Positive Energy\Pe.Tools\bin\pea\` during dev install | `Pe.Dev.Cli`, Rider, explicit dev commands |
| **Install** | Product-shaped installed runtime for user validation/release behavior. | `%LocalAppData%\Positive Energy\Pe.Tools\bin\host\`, `bin\pea\`, optional `bin\pe-dev\` | MSI / installer custom actions |

Do not blur lanes: Dev commands may prepare operator tooling; Install validation should use installed product roots and MSI ownership.

## Build Modes And RRD Safety

| Mode | Outputs | Default trigger | RRD posture |
| --- | --- | --- | --- |
| **Isolated** | `.artifacts/build/...` | plain terminal `dotnet build`, CI, `./build` | `NoRrdContact`; safe default |
| **Interactive** | package-local `bin/obj` | Rider/IDE build | can feed Rider hot reload; protect RRD |

`/p:PeIsolatedBuild=false` forces terminal interactive output. Treat it as an escape hatch, not runbook guidance: it can clobber Rider's package-local baseline and recreate the HR/RRD fragility this split exists to avoid. Prefer Rider for interactive outputs when RRD is alive.

## Module Classes

| Module class | Meaning | Examples |
| --- | --- | --- |
| `BuildTool` | Repo orchestration. | `build/` |
| `InstallerTool` | MSI authoring/install-time mechanics. | `install/` |
| `DesktopShell` | In-proc Revit add-in shell. | `Pe.App` |
| `RevitRuntime` | Revit-loaded runtime packages shared where possible by desktop/DA. | `Pe.Revit.*` |
| `TestHarness` | Revit-aware verification. | `Pe.Revit.Tests` |
| `AutomationShell` | Headless Design Automation shell. | `Pe.Dev.RevitAutomation.Worker` |
| `OperatorSurface` | Human/agent command surfaces. | `Pe.Dev.Cli`, `Pe.Dev.RevitAutomation`, `pea` |
| `HostService` | Out-of-proc local host service. | `Pe.Host` |
| `SharedNeutral` | Pure shared packages outside Revit dependency gravity. | `Pe.Shared.*` |
| `ExternalIntegration` | Vendor/external integration. | `Pe.Aps` |

## Product Classes

| Product class | Meaning | Examples |
| --- | --- | --- |
| `BuildInfrastructure` | Internal build/install machinery. | `Build`, `Installer` |
| `DesktopAddin` | Deployed Revit add-in shape. | `Pe.App` |
| `HostRuntime` | Installed/dev local host process. | `Pe.Host` |
| `DevTooling` | Operator tooling, not default end-user runtime. | `Pe.Dev.Cli`, `Pe.Dev.RevitAutomation` |
| `AutomationRuntime` | Deployed Design Automation worker. | `Pe.Dev.RevitAutomation.Worker` |
| `RevitRuntime` | Revit-side runtime assemblies. | `Pe.Revit.*` |
| `TestHarness` | Verification-only runtime. | `Pe.Revit.Tests` |
| `SharedLibrary` | Shared code with no standalone shell. | `Pe.Shared.*`, `Toon` |
| `ExternalIntegration` | Standalone integration surface. | `Pe.Aps` |

Product classes are build/runtime output categories, not MSI features. Installer authoring uses installable components because install appearance, install behavior, uninstall ownership, and maintenance behavior do not map 1:1 to code package product classes.

## Installer Component Classes

| Installer component | Meaning | Installer ownership |
| --- | --- | --- |
| `RevitAddin` | Per-user desktop Revit add-in registration and loaded add-in files. | Owns `Pe.App.addin` and `Pe.App\...` under each selected Revit year; does not own parent Autodesk/Revit/Addins folders. |
| `HostRuntime` | Installed local host process runtime. | Owns installed files under `%LocalAppData%\Positive Energy\Pe.Tools\bin\host`. |
| `PeaCli` | User-facing `pea` launcher plus packaged agent payload. | Owns launcher/package files; custom actions own expanded payload versions and current pointer. |
| `PeDevCli` | Optional development/operator CLI. | Owns installed files under `%LocalAppData%\Positive Energy\Pe.Tools\bin\pe-dev` and its PATH registration. |
| `RuntimeState` | Mutable state, auth tokens, logs, and cache. | Left behind by normal uninstall unless an explicit purge maintenance action is added. |
| `UserContent` | User-authored settings, scripting workspaces, and command output. | Never removed by normal uninstall. |
| `AutomationBundle` | Design Automation appbundle package artifact. | Package artifact only; not MSI-installed. |

## Authorities And Boundaries

| Concept | Authority | Owns | Not owns |
| --- | --- | --- | --- |
| authored build taxonomy | `build/authored/BuildTaxonomy.props` | package taxonomy, Revit awareness, verify support | generated MSBuild logic |
| generated build contracts | `build/generated/*.props`, `*.targets` | MSBuild projections | source of truth |
| product identity/layout | `Pe.Shared.Product` | product names, exe names, install/user/runtime relative paths | host routes, Revit behavior |
| artifact topology | `build/BuildArtifactLayout.cs` | `.artifacts/...` shape | installed/user roots |
| build/install composition | `build/ProductLayoutAuthority.cs` | repo root + artifact topology + product layout + manifest writing | replacement for `Pe.Shared.Product` |
| installer handoff | `InstallerPayloadManifest` | pack-to-installer payload paths | runtime state |
| pea payload | `PeaPayloadManifest` | `pea` archive identity/hash/size/commit | installer topology |
| host operations | `Pe.Shared.HostContracts` | operation definitions, routes, bridge/script contracts, generated-client slice | host startup/runtime path ownership |

## Boundary Packages

| Area | Owns | Does not own |
| --- | --- | --- |
| `Pe.Shared.Product` | identity, layout, deployment names, build-facing layout projection | host protocol, Revit version matrix |
| `Pe.Shared.RevitVersions` | Revit years/config suffixes/DA engine IDs | product paths, workflow policy |
| `Pe.Shared.StorageRuntime` | storage behavior on product-owned roots | product naming, install topology |
| `Pe.Shared.HostContracts` | routes/operations/contracts | host process startup |
| `build/` | packaging orchestration, artifacts, generated contract sync, installer handoff | live runtime freshness |
| `install/` | MSI UI/features/custom actions/materialization | build taxonomy or repo artifact truth |
