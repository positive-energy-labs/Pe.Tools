# Pe.Scripting.Cli

## Scope

Owns the run-first terminal surface for the scripting lane: workspace-relative single-file execution, stdin snippet execution, host request construction, and exit-code mapping.

## Purpose

`Pe.Scripting.Cli` exists to close the iteration loop without a VSIX. It should make the supported scripting lane trivially runnable by humans and agents while staying intentionally narrow and aligned with the public host contract.

## Critical Entry Points

- `Program.cs` - argument parsing, workspace preflight, host request construction, host HTTP execution, and exit-code mapping.

## Validation

- Cheap validation loop:
  - `dotnet run --project source/Pe.Scripting.Cli/Pe.Scripting.Cli.csproj -- --help`
  - `dotnet run --project source/Pe.Scripting.Cli/Pe.Scripting.Cli.csproj -- src\DoesNotExist.cs`
- Keep stdout/stderr behavior intentional:
  - script output goes to stdout in normal mode
  - diagnostics go to stderr

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **workspace path** | The supported positional argument shape for file execution | Avoid calling it a local path |
| **stdin snippet** | Inline source piped into the CLI and sent as `InlineSnippet` | Prefer this for quick probes |
| **host request** | One sync request/response exchange against `Pe.Host` | Prefer this over vague transport language |

## Living Memory

- This CLI intentionally does not support arbitrary local `.cs` paths outside the scripting workspace in this slice.
- The CLI is a product surface, not a thin demo wrapper. Keep its errors actionable and its defaults strong.
- Prefer reusing shared protocol constants from `Pe.Shared.HostContracts` instead of duplicating routes or version numbers.
- The CLI should follow the public host contract. The internal scripting pipe is not this package's product boundary.
- If you change request DTOs, host routes, or the supported source kinds, update this package in the same pass.
