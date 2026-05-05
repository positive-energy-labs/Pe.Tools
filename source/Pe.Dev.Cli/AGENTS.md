# Pe.Dev.Cli

## Scope

Owns the single dev-facing and operator-facing CLI surface for local Revit iteration, scripting, logs, approvals, and Design Automation.

## Purpose

`Pe.Dev.Cli` exists to centralize fragile repo workflows behind one stable executable: `pe-dev`. Keep this package focused on command parsing, human/JSON output, and dispatch into shared runtime and automation seams instead of re-growing sidecar executables.

## Critical Entry Points

- `Program.cs` - `pe-dev` entrypoint.
- `DevCliProgram.cs` - top-level usage/help and command dispatch.
- `RevitCommandRunner.cs` - `revit approve`, `hot-reload`, `sync-runtime`, `logs`, `session`, `test`, and `script` command routing.
- `AutomationCliProgram.cs` - `revit automation ...` command routing.
- `../Pe.Aps/Auth/ApsAuthService.cs` - persisted APS auth status, login, logout, and token acquisition flow.
- `../Pe.Dev.RevitAutomation/AutomationBrowseService.cs` - sticky browse context plus repo-local cache-backed ACC discovery.
- `../Pe.Dev.RevitAutomation/AutomationManifestService.cs` - human-readable schedule manifest create/update/validate flow.
- `../Pe.Dev.RevitAutomation/AutomationScheduleRunServices.cs` - submit-now / inspect-later schedule run orchestration.

## Validation

Cheap validation loop:

- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- --help`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit session`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit sync-runtime extra`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit logs all --tail 20`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit test --filter "Name~AssemblyLoadDiagnostics"`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- revit automation --help`

Operator examples:

- `pe-dev revit automation auth login`
- `pe-dev revit automation browse hubs`
- `pe-dev revit automation browse use-project "PE 2025 Projects"`
- `pe-dev revit automation browse models --recurse true --out docs/context/da-fantech-scrape/discovered-model-inventory.json`
- `pe-dev revit automation manifest create --path docs/context/da-fantech-scrape/fantech-schedule-batch.json`
- `pe-dev revit automation submit schedules --manifest docs/context/da-fantech-scrape/fantech-schedule-batch.json --json`
- `pe-dev revit automation inspect receipt --receipt latest --download-artifacts true --json`

Keep `Pe.Dev.Cli` focused on stable command naming, parse/print behavior, and orchestration boundaries. Shared automation logic belongs in `Pe.Dev.RevitAutomation`.

Live runtime validation loop:

- build the affected runtime package-local outputs
- run `pe-dev revit sync-runtime`
- then run `pe-dev revit script ...` or the matching validation command
- do not assume a successful `./build` isolated compile made the live RRD session fresh

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **single executable** | The repo should teach one CLI surface: `pe-dev` | Avoid reviving `pe-script` or separate automation executables |
| **operator surface** | The command families humans and agents should actually learn and run | Prefer extending `pe-dev` over hidden scripts |
| **automation lane** | `pe-dev revit automation ...` | Prefer this over talking about DA as a separate tool |
| **browse lane** | the sticky-context ACC discovery commands under `revit automation browse ...` | Prefer this over copy-pasting ids through one-off list commands |
| **status lane** | `inspect receipt`, `inspect workitem`, and low-level `workitem-status` fallback | Prefer inspection over rerunning jobs when you already have a receipt or id |
| **JSON mode** | `--json` output intended for downstream tooling or scripting | Prefer this for machine consumption instead of scraping human text |

## Living Memory

- `Pe.Dev.Cli` is the only CLI humans and agents should learn in this repo.
- The deployed CLI is installed beside `Pe.Host` under `%LocalAppData%\Positive Energy\Pe.Tools\Host\`. Do not rely on PATH registration for that copy.
- Local `Pe.Dev.Cli` builds now mirror the runnable CLI output to `%LocalAppData%\Positive Energy\Pe.Tools\Bin\pe-dev\`. If the user wants `pe-dev` on `PATH`, that mirrored bin directory is the intended dev-facing path to register.
- `revit script` and `revit automation` are both first-class command families, not sidecars.
- Build hooks must consume the built CLI output through `dotnet exec`, not `dotnet run`.
- `revit approve` is background-only and intentionally relaunches an internal worker so MSBuild does not block.
- `revit hot-reload` exposes no file or year arguments. Session selection, dirty-file discovery, and Rider cache handling are internal policy.
- `revit sync-runtime` is the operator-facing pre-live-validation command. Keep it explicit, health-aware, and thin over the lower-level HR path.
- `revit script` no longer auto-runs hot reload before execution. Explicit `revit sync-runtime` is the preferred pre-live-validation step after runtime package edits.
- `revit session` is the unified local status surface. It should stay CLI-first, pull in host-status when available, and keep `--json` honest for tooling.
- `revit test` is the deterministic Revit-backed test lane for runtime freshness. By default it auto-selects a safe Revit year in the same runtime family that is not already running, then forces a dedicated test Revit process and temporarily hides the deployed `Pe.App` add-in for that year unless the operator opts out.
- The Revit window left behind by `revit test` is an owned inspect/debug session, not a freshness-safe attach target. The next `revit test` run should recycle that owned session before launching again.
- `revit test` should also start the approval watcher for its target year before launching a fresh test-controlled Revit process, otherwise unsigned add-in approval can stall unattended startup.
- Keep CLI models honest: parse flags here, but keep APS policy, packaging, worker definitions, and report/artifact handling in `Pe.Dev.RevitAutomation`.
