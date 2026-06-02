# build

## Scope

Owns the repo-level pack and publish automation.

## Purpose

`./build` is the CI-aligned packaging and release surface for this repo. Use plain terminal `dotnet build` for ordinary compile verification; use `./build` for `pack` and `publish`. Do not turn `./build` into a replacement for normal `dotnet build`.

## Critical Entry Points

- `Program.cs` - command/option registration for pack and publish flows.
- `Modules/ResolveBuildMatrixModule.cs` - supported Revit-year and configuration-group resolution.
- `Modules/ResolveBuildLayoutModule.cs` - resolves the build-side `ProductLayoutAuthority`.
- `BuildArtifactLayout.cs` - repo-local `.artifacts` topology: build, publish, staging, package, installer, and tools roots.
- `ProductLayoutAuthority.cs` - build/install projection authority that composes repo root, `Pe.Shared.Product` layout, artifact layout, and installer payload manifest writing.
- `Modules/PublishRevitAddinModule.cs` - isolated Revit add-in publish staging for bundle/installer packaging.
- `Modules/CreateBundleModule.cs`, `Modules/CreateAutomationBundleModule.cs`, `Modules/CreateInstallerModule.cs` - package outputs.
- `Modules/ValidateSolutionParityModule.cs` - `.slnx` parity validation without treating `.slnx` as build truth.

## Validation

See `../BUILD.md` for the complete build/runtime decision table. This executable is for packaging and release, not ordinary compile proof and not live RRD runtime freshness.

- Build packages: `dotnet run -c Release -- pack`
- Publish release artifacts from existing packages: `dotnet run -c Release -- publish`
- Run the full release path in one shot: `dotnet run -c Release -- pack publish`

## Living Memory

- `build/authored/BuildMatrix.props` is the human-owned Revit-year and configuration-matrix vocabulary for this repo. Keep its Design Automation eligibility aligned with `Pe.Shared.RevitVersions.RevitVersionCatalog`.
- `build/authored/BuildTaxonomy.props` is the human-owned project-taxonomy vocabulary for this repo.
- `build/authored/PackagePolicy.props` is the human-owned package-policy vocabulary for repo-wide conditional package references.
- `Pe.Shared.Product` owns durable product identity and local runtime/user layout; `ProductLayoutAuthority` owns repo/build/install projection from that product truth.
- `BuildArtifactLayout` owns `.artifacts/...` path math. Do not recreate `.artifacts`, `packages`, `publish`, `staging`, or installer output roots in modules.
- `InstallerPayloadManifest` is the serialized SOT for one build-to-installer packaging run. `CreateInstallerModule` writes it; `install/Installer.cs` consumes `--manifest <path>`.
- `build/generated/BuildMatrix.Configuration.props` and `build/generated/BuildMatrix.TargetFramework.props` are generated from the authored matrix and are the MSBuild-facing configuration and target-framework imports.
- `build/generated/BuildTaxonomy.Evaluator.props` and `build/generated/BuildTaxonomy.Validation.targets` are generated from the authored taxonomy and are the MSBuild-facing evaluator and taxonomy-validation imports.
- `build/generated/PackagePolicy.props` is generated from the authored package-policy table.
- `build/generated/ProductLayout.props` is the generated build-facing projection of `Pe.Shared.Product` local layout identity; it is not an authority.
- `./build` owns the isolated build mode and writes to `.artifacts/...` through `ProductLayoutAuthority` / `BuildArtifactLayout`.
- The default Revit target remains `Debug.R25`.
- `--configuration <BuildType>` narrows packaging to one selected configuration such as `Release.R25`.
- Revit publish roots under `.artifacts/publish/revit/...` are staged by `pack`.
- `.slnx` is IDE organization and parity input only; it is not the build-matrix source of truth.
- `.slnx`, configuration strings, and generated evaluator imports are compatibility surfaces, not the intended orchestration authority.
- Regenerate build-facing contract imports with `dotnet run --project build/Build.csproj -c Release -- sync-contracts` after changing anything under `build/authored/` or `Pe.Shared.Product` layout identity.
- Successful `./build` output does not mean the live Revit session has fresh runtime assemblies.
- AttachedRrd validation belongs to Rider/IDE-owned interactive outputs plus dev-agent live-loop tooling. Do not use `./build` for live runtime freshness.
