# Pe.Dev.Cli

## Scope

Owns the single dev-facing CLI surface for local Revit iteration helpers and scripting entrypoints.

## Purpose

`Pe.Dev.Cli` exists to centralize fragile local automation and script execution behind one stable executable: `pe-dev`. Keep this package focused on command parsing, stdout/stderr behavior, and dispatch into shared automation/runtime seams instead of re-growing a second product surface.

## Critical Entry Points

- `Program.cs` - `pe-dev` entrypoint.
- `DevCliProgram.cs` - top-level usage/help and command dispatch.
- `RevitCommandRunner.cs` - `revit approve`, `hot-reload`, `logs`, `session`, and `script` command routing.
- `ScriptCliProgram.cs` / `ScriptCliOptions.cs` - merged scripting CLI behavior now exposed as `pe-dev revit script ...`.

## Validation

- Cheap validation loop:
  - `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- --help`
  - `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit session`
  - `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit logs all --tail 20`
- Keep this CLI focused on stable command naming and orchestration. Shared automation logic belongs in `Pe.Dev.RevitAutomation`.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **single executable** | The repo should teach one CLI surface: `pe-dev` | Avoid reviving `pe-script` or separate automation executables |
| **low-level command** | A primitive command like `revit approve` or `revit session` | Prefer this over hiding behavior behind many opaque aliases |
| **script lane** | The `pe-dev revit script ...` workflow | Prefer this over talking about a separate scripting CLI |

## Living Memory

- `Pe.Dev.Cli` is the only CLI humans and agents should learn in this repo.
- `revit script` is part of the dev tooling surface, not a sibling product.
- Build hooks must consume the built CLI output through `dotnet exec`, not `dotnet run`.
- `revit approve` is background-only and intentionally relaunches an internal worker so MSBuild does not block.
- `revit hot-reload` exposes no file or year arguments. Session selection, dirty-file discovery, and Rider cache handling are internal policy.
