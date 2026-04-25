# build

## Scope

Owns the repo-level pack and publish automation.

## Purpose

`./build` is the CI-aligned packaging and release surface for this repo. Use plain terminal `dotnet build` for ordinary compile verification; use `./build` for `pack` and `publish`.

## Critical Entry Points

- `Program.cs` - command/option registration for pack and publish flows.
- `Modules/ResolveBuildMatrixModule.cs` - supported Revit-year and configuration-group resolution.
- `Modules/ResolveBuildLayoutModule.cs` - `.artifacts` output layout resolution.
- `Modules/PublishRevitAddinModule.cs` - isolated Revit add-in publish staging for bundle/installer packaging.
- `Modules/CreateBundleModule.cs`, `Modules/CreateAutomationBundleModule.cs`, `Modules/CreateInstallerModule.cs` - package outputs.
- `Modules/ValidateSolutionParityModule.cs` - `.slnx` parity validation without treating `.slnx` as build truth.

## Validation

- Build packages: `dotnet run -c Release -- pack`
- Publish release artifacts from existing packages: `dotnet run -c Release -- publish`
- Run the full release path in one shot: `dotnet run -c Release -- pack publish`
- This executable is for packaging and release, not proof of live RRD runtime freshness.

## Living Memory

- `./build` owns the isolated lane and writes to `.artifacts/...`.
- The default Revit target remains `Debug.R25`.
- `--configuration <BuildType>` narrows packaging to one selected configuration such as `Release.R25`.
- Revit publish roots under `.artifacts/publish/revit/...` are staged by `pack`.
- `.slnx` is IDE organization and parity input only; it is not the build-matrix source of truth.
- Successful `./build` output does not mean the live Revit session has fresh runtime assemblies.
- If a human or agent intends to validate through `pe-dev revit script ...` or `Pe.Revit.Tests`, they must use the interactive build lane and run `pe-dev revit sync-runtime` or manual `pe-dev revit hot-reload` first.
