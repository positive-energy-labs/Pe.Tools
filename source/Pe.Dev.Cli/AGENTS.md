# Pe.Dev.Cli

## Scope

Owns the single dev-facing and operator-facing CLI surface for local Revit iteration, scripting, logs, approvals, and Design Automation.

## Purpose

`Pe.Dev.Cli` exists to centralize fragile repo workflows behind one stable executable: `pe-dev`. Keep this package focused on command parsing, human/JSON output, and dispatch into shared runtime and automation seams instead of re-growing sidecar executables.

## Critical Entry Points

- `Program.cs` - `pe-dev` entrypoint.
- `DevCliProgram.cs` - top-level usage/help and command dispatch.
- `RevitCommandRunner.cs` - `revit approve`, `hot-reload`, `logs`, `session`, and `script` command routing.
- `AutomationCliProgram.cs` - `revit automation ...` command routing.
- `AutomationProbeAccessCliOptions.cs` - diagnostic cloud-open probe options.
- `AutomationParameterCollectionCliOptions.cs` - single-model parameter collection options.
- `AutomationParameterCollectionBatchCliOptions.cs` - batch manifest entrypoint.
- `AutomationWorkItemCliOptions.cs` - workitem inspection options.

## Validation

Cheap validation loop:

- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- --help`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit session`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit logs all --tail 20`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit automation --help`

Operator examples:

- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation probe-access --region US --project-guid <guid> --model-guid <guid> --mask false`
- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation collect-parameters --region US --project-guid <guid> --model-guid <guid> --category-name "Duct Accessories" --mask false`
- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation collect-parameters-batch --manifest <path> --json`
- `dotnet exec source\Pe.Dev.Cli\bin\Debug.R25\net8.0-windows\pe-dev.dll revit automation workitem-status --workitem-id <id> --mask false`

Keep `Pe.Dev.Cli` focused on stable command naming, parse/print behavior, and orchestration boundaries. Shared automation logic belongs in `Pe.Dev.RevitAutomation`.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **single executable** | The repo should teach one CLI surface: `pe-dev` | Avoid reviving `pe-script` or separate automation executables |
| **operator surface** | The command families humans and agents should actually learn and run | Prefer extending `pe-dev` over hidden scripts |
| **automation lane** | `pe-dev revit automation ...` | Prefer this over talking about DA as a separate tool |
| **status lane** | `workitem-status`, a read-only inspection command | Prefer this over rerunning jobs when you already have an id |
| **JSON mode** | `--json` output intended for downstream tooling or scripting | Prefer this for machine consumption instead of scraping human text |

## Living Memory

- `Pe.Dev.Cli` is the only CLI humans and agents should learn in this repo.
- `revit script` and `revit automation` are both first-class command families, not sidecars.
- Build hooks must consume the built CLI output through `dotnet exec`, not `dotnet run`.
- `revit approve` is background-only and intentionally relaunches an internal worker so MSBuild does not block.
- `revit hot-reload` exposes no file or year arguments. Session selection, dirty-file discovery, and Rider cache handling are internal policy.
- Keep CLI models honest: parse flags here, but keep APS policy, packaging, worker definitions, and report/artifact handling in `Pe.Dev.RevitAutomation`.
