# Pe.Dev.Cli

## Scope

Owns the dev-facing `pe-dev` CLI surface for fresh Revit proof runs, `pea` source linking, codegen, and APS Design Automation operator workflows.

Attached RRD/live-loop diagnostics and hot reload are no longer public `pe-dev` command groups. Keep those surfaces in the TypeScript dev-agent tools (`live_loop_context`, `live_rrd_sync`, `live_rrd_restart`) and the deployed `pea` CLI where appropriate.

## Purpose

`Pe.Dev.Cli` centralizes repo workflows behind one stable executable without re-growing sidecar executables. Keep this package focused on command parsing, human/JSON output, and dispatch into shared runtime and automation seams.

`pe-dev` is not a replacement for standard `dotnet build`. Ordinary compile and package checks should stay on standard `dotnet` / repo build entrypoints. The repo-level workflow guide is `BUILD.md`.

## Critical Entry Points

- `Program.cs` - `pe-dev` entrypoint.
- `DevCliProgram.cs` - top-level usage/help and command dispatch.
- `Routing/RootCommandRunner.cs` - top-level `bootstrap-path`, `test`, `self-test`, `pea`, `automation`, `codegen`, and internal dispatch.
- `Commands/BootstrapPathCommand.cs` - personal PATH bootstrap to the current build output.
- `RevitCommandRunner.cs` - FreshRevitProcess test routing plus internal unsigned add-in approval watcher launch.
- `Commands/Automation/AutomationCommandRunner.cs` - top-level `automation ...` command routing.
- `Commands/Codegen/CodegenCommandRunner.cs` - generated build contracts, programmatic Host TypeGen DTOs, and TypeScript Host client check/sync routing.
- `../Pe.Aps/Auth/ApsAuthService.cs` - persisted APS auth status, login, logout, and token acquisition flow.
- `../Pe.Dev.RevitAutomation/AutomationBrowseService.cs` - sticky browse context plus repo-local cache-backed ACC discovery.
- `../Pe.Dev.RevitAutomation/AutomationManifestService.cs` - human-readable schedule manifest create/update/validate flow.
- `../Pe.Dev.RevitAutomation/AutomationScheduleRunServices.cs` - submit-now / inspect-later schedule run orchestration.

## Validation

Cheap validation loop:

- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- --help`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- self-test`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -c Debug.R25 -- bootstrap-path`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- test --plan --json --filter "Name~Reports_runtime_assembly_load_paths"`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- automation --help`

Operator examples:

- `pe-dev automation auth login`
- `pe-dev automation browse hubs`
- `pe-dev automation browse use-project "PE 2025 Projects"`
- `pe-dev automation browse models --recurse true --out docs/context/da-fantech-scrape/discovered-model-inventory.json`
- `pe-dev automation manifest create --path docs/context/da-fantech-scrape/fantech-schedule-batch.json`
- `pe-dev automation submit schedules --manifest docs/context/da-fantech-scrape/fantech-schedule-batch.json --json`
- `pe-dev automation inspect receipt --receipt latest --download-artifacts true --json`

Keep `Pe.Dev.Cli` focused on stable command naming, parse/print behavior, and orchestration boundaries. Shared automation logic belongs in `Pe.Dev.RevitAutomation`.

## Live Runtime Boundary

- AttachedRrd/live-loop state is owned by the TypeScript dev-agent tools, not public `pe-dev` commands.
- Use `live_loop_context` for the single read-only environment/session/log decision packet.
- Use `live_rrd_sync` / `live_rrd_restart` for RiderBridge-backed sync and restart actions.
- Use deployed `pea` surfaces for operator log access and scripting.
- `pe-dev test` remains the FreshRevitProcess proof lane when RRD freshness is uncertain, HR is unsafe, or current UI/document state is irrelevant.
- Use `pe-dev test --plan --json ...` for safe smoke checks and command planning. It resolves the fresh lane but does not build, quarantine add-ins, launch Revit, run tests, or clean up sessions.
- Use `--timeout-seconds <seconds>` on real `test` proof runs from agents/hooks so a Revit launch or test adapter hang fails bounded with exit code `124`.
- Keep `Pe.Revit.Tests` messaging precise: `.Tests` build outputs are isolated, but explicit-year `dotnet test` execution can still be Revit-backed unless `pe-dev test` is used.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **dev CLI** | The repo-local developer/operator surface is `pe-dev` | Avoid reviving `pe-script` or separate automation executables |
| **FreshRevitProcess** | The dedicated fresh-owned Revit proof lane exposed as `pe-dev test` | Prefer this when current RRD document/session state is irrelevant |
| **live-loop context** | The TypeScript dev-agent decision packet exposed as `live_loop_context` | Prefer this over reviving `pe-dev doctor`, `status`, `env`, or `sync` |
| **automation workflow** | `pe-dev automation ...` Design Automation workflows | Prefer this over nesting DA under desktop Revit |
| **browse workflow** | Sticky-context ACC discovery commands under `pe-dev automation browse ...` | Prefer this over copy-pasting ids through one-off list commands |
| **status workflow** | `automation inspect receipt` and `automation inspect workitem` | Prefer inspection over rerunning jobs when you already have a receipt or id |
| **JSON mode** | `--json` output intended for downstream tooling or scripting | Prefer this for machine consumption instead of scraping human text |

## Living Memory

- `Pe.Dev.Cli` is the repo-local CLI for dev/operator workflows that still belong in C# orchestration: PATH bootstrap, FreshRevitProcess tests, `pea` source linking, codegen, and Design Automation.
- `bootstrap-path` is the supported personal setup path for `pe-dev`; it points PATH at the current invocation's build output. Do not restore MSI ownership, local runtime mirroring, or a `pe-dev-cli-bootstrap` installer slice.
- `pe-dev pea link-dev` is the dev Pea setup path. Do not restore dev payload install commands that rewrite `bin\pea\versions\dev` or `current.txt`; that makes installed-lane validation ambiguous.
- `doctor`, `status`, `sync`, `env`, `revit`, and `verify` are intentionally removed from the public CLI surface. Do not reintroduce them for live-loop context.
- `pea script` belongs to the deployed `pea` surface, not `pe-dev`.
- Build hooks must consume the built CLI output through `dotnet exec`, not `dotnet run`.
- Approval watcher plumbing is internal and preserved for unattended FreshRevitProcess startup.
- `test` is the FreshRevitProcess verification helper. It should stay thin, deterministic, and honest about the behavior it owns.
- `test` starts the approval watcher for its target year before launching a fresh test-controlled Revit process, otherwise unsigned add-in approval can stall unattended startup.
- Do not hide `pe-dev test` behind ordinary `dotnet build` or bare `dotnet test` flows. If a workflow needs this helper, require explicit intent.
- Keep CLI models honest: parse flags here, but keep APS policy, packaging, worker definitions, and report/artifact handling in `Pe.Dev.RevitAutomation`.
