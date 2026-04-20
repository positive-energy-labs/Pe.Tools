# Pe.Dev.Cli

## Scope

Owns the dev-facing terminal surface for local Revit iteration helpers such as Rider hot reload prep, add-in
auto-approval, and build-hook orchestration.

## Purpose

`Pe.Dev.Cli` exists to centralize fragile local automation behind stable commands that humans and agents can invoke
directly. It should prefer explicit command seams over scattering PowerShell entrypoints across the repo.

## Critical Entry Points

- `Program.cs` - repo-root discovery, command parsing, PowerShell script dispatch, and build-hook orchestration.

## Validation

- Cheap validation loop:
    - `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- --help`
    - `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit hot-reload -DryRun`
- Keep this CLI focused on stable command naming and orchestration. Do not duplicate the underlying automation logic
  here unless the script implementation is actually being retired.

## Shared Language

| Term               | Meaning                                                                                 | Prefer / Avoid                                          |
|--------------------|-----------------------------------------------------------------------------------------|---------------------------------------------------------|
| **build hook**     | A command shape used from project post-build targets or wrappers                        | Prefer stable CLI verbs over ad hoc script paths        |
| **forwarded args** | Remaining command arguments passed straight through to the underlying PowerShell script | Prefer this when preserving an existing script contract |

## Living Memory

- This package is the stable dev-automation seam, not the final home for every implementation detail.
- Favor keeping command names stable even if the underlying script or automation backend changes later.
- If a build hook must remain asynchronous to avoid hanging MSBuild, preserve that behavior here.
