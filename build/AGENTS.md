# build

## Scope

Owns the repo-level pack and publish automation.

## Purpose

`./build` is the CI-aligned packaging and release surface for this repo. Use plain terminal `dotnet build` for ordinary compile verification; use `./build` for `pack` and `publish`. Do not turn `./build` into a replacement for normal `dotnet build`.

## Critical Entry Points

- `Program.cs` - command/option registration for pack and publish flows.
- `Modules/ResolveBuildMatrixModule.cs` - packaging configuration resolution from SDK-facing repo props.
- `Modules/ResolveBuildLayoutModule.cs` - resolves the build-side `ProductLayoutAuthority`.
- `BuildArtifactLayout.cs` - repo-local `.artifacts` topology: build, publish, staging, package, installer, and tools roots.
- `ProductLayoutAuthority.cs` - build/install projection authority that composes repo root, `Pe.Shared.Product` layout, artifact layout, and SDK installer payload paths.
- `Modules/CreateBundleModule.cs` - publishes the Revit matrix once for both desktop and installer packaging.
- `Modules/CreateAutomationBundleModule.cs`, `Modules/CreateInstallerModule.cs` - remaining package outputs.
- `Modules/ValidateSolutionParityModule.cs` - `.slnx` parity validation without treating `.slnx` as build truth.

## Validation

See `../BUILD.md` for the complete build/runtime decision table. This executable is for packaging and release, not ordinary compile proof and not live RRD runtime freshness.

- Build packages: `dotnet run -c Release -- pack`
- Publish release artifacts from existing packages: `dotnet run -c Release -- publish`
- Run the full release path in one shot: `dotnet run -c Release -- pack publish`

## Living Memory

- `Directory.Build.props` owns the repo Revit year list and default year consumed by the SDK. The
  release manifest repeats that list as an installed transport contract; installer packaging must
  mechanically reject any mismatch rather than treating the JSON as an independent authority.
- `Pe.Revit.Sdk` owns project taxonomy, target-framework projection, Revit package policy, deploy, and generated configuration behavior.
- `Pe.Revit.Versioning` owns Revit suffixes and Design Automation eligibility outside MSBuild.
- `Pe.Shared.Product` owns durable product identity and local runtime/user layout; `ProductLayoutAuthority` owns repo/build/install projection from that product truth.
- `BuildArtifactLayout` owns `.artifacts/...` path math. Do not recreate `.artifacts`, `packages`, `publish`, `staging`, or installer output roots in modules.
- `CreateBundleModule` builds the product-specific Revit source once; `CreateInstallerModule` builds
  Host and Pea, then consumes that Revit output. The checked
  `product.payloads.json` goes unchanged to SDK `pe-revit install package` and `pe-revit msi`; do not
  restore product-owned manifest rewriting or zip composition.
- `CreateAutomationBundleModule` selects the worker/year matrix and delegates each engine artifact to
  SDK `PeCreateAppBundle`; do not restore `Autodesk.PackageBuilder`, manual `.addin`/bundle XML, or zip
  composition here.
- `./build` owns the isolated build mode and writes to `.artifacts/...` through `ProductLayoutAuthority` / `BuildArtifactLayout`.
- The default Revit target remains `Debug.R25`.
- `--configuration <BuildType>` narrows ordinary desktop/automation packaging to one selected
  configuration such as `Release.R25`. Installer packaging is the exception: releases must contain
  the complete `Directory.Build.props` year matrix and reject `--configuration`.
- Installer Revit publish roots under `.artifacts/publish/installer/revit/...` are staged by `pack`.
- `.slnx` is IDE organization and parity input only; it is not the build-matrix source of truth.
- `.slnx` and configuration strings are compatibility surfaces, not the intended orchestration authority.
- Successful `./build` output does not mean the live Revit session has fresh runtime assemblies.
- AttachedRrd validation belongs to SDK `pe-revit` live/test commands, with Peco wrappers adding Pea status/log hooks. Do not use `./build` for live runtime freshness.
