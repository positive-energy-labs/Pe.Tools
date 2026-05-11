# TAXONOMY

This file is a living record of the taxonomy we are converging on. It focuses on authority, workflow, runtime shape, and boundary language rather than file-by-file history. This is constantly in flux and this should be incrimentally updated.

## Core Axes

| Axis | Question it answers | Canonical values | Notes |
| --- | --- | --- | --- |
| **module taxonomy** | What kind of package is this code unit? | (see below) | This is about package role, not deployment output. |
| **product taxonomy** | What durable output or deployed shape does this workflow produce? | (see below) | This is about the resulting product/runtime shape, not the code organization. |
| **workflow taxonomy** | What is the operator trying to do? | `Build`, `Verify`, `Package`, `Publish` | Prefer this over overloading configuration strings. |
| **execution policy** | Is this workflow allowed to touch `RRD`? | `NoRrdContact`, `RrdRequired` | This is the safety boundary around the live Rider-driven Revit session. |
| **build mode** | Where do outputs go, and are they part of the live hot-reload loop? | `Isolated`, `Interactive` | `Isolated` writes under `.artifacts/...`; `Interactive` writes package-local outputs for Rider/HR. |
| **verify target** | What kind of verification host is being requested? | `AttachedRrd`, `FreshRevitProcess` | Only meaningful under workflow `Verify`. |
| **target framework class** | Which target-framework family should this package resolve through? | `Explicit`, `SharedNeutral`, `OutOfProcNet8`, `RevitRuntime`, `RevitTest`, `AutomationWorker` | Compatibility vocabulary, not orchestration authority. |

## Module Classes

| Module class | Meaning | Typical examples |
| --- | --- | --- |
| **BuildTool** | Repo build/orchestration code. | `build/` |
| **InstallerTool** | MSI authoring and install-time mechanics. | `install/` |
| **DesktopShell** | The in-proc Revit add-in shell. | `Pe.App` |
| **RevitRuntime** | Revit-loaded runtime packages shared by desktop and DA-safe flows where possible. | `Pe.Revit.*` |
| **TestHarness** | Revit-aware verification surface. | `Pe.Revit.Tests` |
| **AutomationShell** | The headless Design Automation entry shell. | `Pe.Dev.RevitAutomation.Worker` |
| **OperatorSurface** | Human/agent command surfaces that orchestrate work. | `Pe.Dev.Cli`, `Pe.Dev.RevitAutomation`, `pea` |
| **HostService** | Out-of-proc runtime service that exposes operations and bridge coordination. | `Pe.Host` |
| **SharedNeutral** | Pure shared packages that must stay outside Revit/runtime-specific dependency gravity. | `Pe.Shared.*` |
| **ExternalIntegration** | Vendor or external-system integration packages. | `Pe.Aps` |

## Product Classes

| Product class | Meaning | Typical examples |
| --- | --- | --- |
| **BuildInfrastructure** | Internal build/install machinery. | `Build`, `Installer` |
| **DesktopAddin** | The deployed Revit add-in product shape. | `Pe.App` |
| **HostRuntime** | The installed local host process/runtime. | `Pe.Host` |
| **DevTooling** | Operator-facing tooling rather than end-user runtime. | `Pe.Dev.Cli`, `Pe.Dev.RevitAutomation` |
| **AutomationRuntime** | The deployed Design Automation worker/runtime. | `Pe.Dev.RevitAutomation.Worker` |
| **RevitRuntime** | Runtime assemblies loaded for Revit-side behavior. | `Pe.Revit.*` |
| **TestHarness** | Verification-only runtime shape. | `Pe.Revit.Tests` |
| **SharedLibrary** | Durable shared code with no standalone deployed shell. | `Pe.Shared.*`, `Toon` |
| **ExternalIntegration** | Standalone integration surface with outside systems. | `Pe.Aps` |

## Authorities And Projections

| Concept | Authority | What it owns | What it should not become |
| --- | --- | --- | --- |
| **authored build contracts** | `build/authored/*.props` | Human-owned matrix, taxonomy, and package-policy truth | Generated imports or ad hoc duplicated logic |
| **generated build contracts** | `build/generated/*.props`, `build/generated/*.targets` | MSBuild-facing projections of authored truth | A second source of truth |
| **build contract sync** | `build/BuildContractSync.cs` | Regeneration of build-facing projections from authored truth and `Pe.Shared.Product` | Manual copy-paste maintenance |
| **product identity and local layout** | `Pe.Shared.Product` | Product names, executable names, local runtime roots, user-content roots, Revit add-in manifest identity | Routes, host payloads, bridge frames, startup behavior |
| **build-facing product layout projection** | `ProductBuildLayoutProjection` | Pure relative-path projection of product layout for build and installer consumers | Repo artifact topology or runtime behavior |
| **repo artifact topology** | `build/BuildArtifactLayout.cs` | `.artifacts/build`, `.artifacts/publish`, `.artifacts/packages`, staging, tools roots | Product install roots or user-content layout |
| **build/install composition authority** | `build/ProductLayoutAuthority.cs` | Composition of repo root, product layout projection, artifact topology, and installer manifest writing | A replacement for `Pe.Shared.Product` |
| **installer handoff contract** | `InstallerPayloadManifest` | One pack-to-installer payload description | Long-term runtime state |
| **pea runtime payload contract** | `PeaPayloadManifest` | Versioned `pea` payload archive identity, hash, size, commit | Installer topology or host protocol |
| **generated host clients** | `Pe.Shared.HostContracts/Generated/PeHostClient.cs`, `source/pea/app/generated/pe-host-client.ts` | Client projections of the intentional public host-operation slice | The authority for operation definitions |

## Boundary Packages

| Package / area | Owns | Does not own |
| --- | --- | --- |
| **`Pe.Shared.Product`** | Product identity, runtime layout, user-content layout, deployment identity, build-facing layout projection | Host routes, bridge frames, storage behavior, Revit version compatibility |
| **`Pe.Shared.RevitVersions`** | Revit year metadata, configuration suffixes, DA engine IDs, version-to-target-framework facts | Product paths, `.artifacts` topology, workflow policy |
| **`Pe.Shared.StorageRuntime`** | Storage/document behavior on top of product-owned roots: settings, module storage, state, output, credential reads | Product naming, install topology, host protocol |
| **`Pe.Shared.HostContracts`** | Operation definitions, HTTP routes, bridge contracts, scripting contracts, generated-client slice | Host startup, browser launching, runtime path ownership |
| **`build/`** | Packaging orchestration, artifact topology, generated MSBuild contract sync, installer/payload handoff writing | Live runtime freshness or product-local path truth |
| **`install/`** | MSI authoring and install-time materialization of packaged outputs | Authoring-time product taxonomy or repo build truth |

## Runtime And Deployment Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **runtime layout** | Local machine state under `%LocalAppData%\\Positive Energy\\Pe.Tools\\...` | Prefer this for installed binaries, logs, cache, and mutable state |
| **user-content layout** | User-authored files under `Documents\\Pe.Tools\\...` | Prefer this for settings, scripting workspaces, and durable output |
| **artifact layout** | Repo-local build outputs under `.artifacts\\...` | Avoid confusing this with installed runtime paths |
| **projection** | A pure target-shaped description derived from a stronger authority | Prefer this for generated props and build-facing layout objects |
| **authority** | The place that is allowed to answer a question canonically | Prefer identifying the authority instead of retyping constants |
| **payload** | A packaged runtime blob intended to be installed or unpacked later | Prefer this for `pea` archives and installer-fed publish outputs |
| **bootstrap** | The small stable launcher or entry material that locates a versioned payload | Prefer this for the durable `pea.cmd` surface |
| **staging** | Temporary pack-time layout before the final package artifact is emitted | Avoid treating staging paths as deployed locations |

## Shell Separation

| Shell / surface | Role | Important separation |
| --- | --- | --- |
| **desktop shell** | `Pe.App` inside live Revit | Not the authority for DA or host runtime topology |
| **automation shell** | `Pe.Dev.RevitAutomation.Worker` inside Autodesk DA | Sibling to desktop, not a clone of `Pe.App` startup |
| **host** | `Pe.Host` out-of-proc HTTP/SSE/WebSocket service | Owns execution/orchestration, not product path identity |
| **`pe-dev`** | Primary operator CLI for repo and Revit workflows | Prefer extending this over one-off helper executables |
| **`pea`** | User/agent command surface backed by generated host clients and versioned payloads | Prefer this over reviving bespoke scripting pipes or script-only CLIs |

## Distilled Rules

| Rule | Why it matters |
| --- | --- |
| **Do not overload configuration strings to carry every concept.** | Configuration is now only one compatibility surface inside a larger taxonomy. |
| **Treat authored files as truth and generated files as projections.** | This keeps build mechanics explainable and regenerable. |
| **Keep product layout and artifact layout separate.** | Installed runtime paths and repo build outputs answer different questions. |
| **Keep transport contracts separate from local layout identity.** | Routes and payloads evolve for communication; product identity evolves for deployment/runtime shape. |
| **Use workflow plus execution policy when talking about build behavior.** | That is the actual safety model around `RRD`, not whether a command happens to be `dotnet build`. |
| **Use module class for package role and product class for output shape.** | That is the key distinction the current diff finally makes explicit. |
