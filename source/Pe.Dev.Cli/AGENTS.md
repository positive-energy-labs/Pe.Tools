# Pe.Dev.Cli

## Scope

Owns the single dev-facing and operator-facing CLI surface for local Revit iteration, environment diagnostics, codegen, `pea` dev installs, and Design Automation.

## Purpose

`Pe.Dev.Cli` exists to centralize fragile repo workflows behind one stable executable: `pe-dev`. Keep this package focused on command parsing, human/JSON output, and dispatch into shared runtime and automation seams instead of re-growing sidecar executables.

`pe-dev` is an operator helper surface, not a replacement for standard `dotnet build`. Ordinary compile and test workflows should stay on standard `dotnet` entrypoints whenever the platform allows it. The repo-level workflow runbook is `docs/ENVIRONMENT.md`.

## Critical Entry Points

- `Program.cs` - `pe-dev` entrypoint.
- `DevCliProgram.cs` - top-level usage/help and command dispatch.
- `Routing/RootCommandRunner.cs` - top-level `doctor`, `status`, `sync`, `test`, `self-test`, `pea`, `automation`, `codegen`, and internal dispatch.
- `RevitCommandRunner.cs` - desktop Revit session, runtime sync, and fresh-process test routing.
- `Commands/Automation/AutomationCommandRunner.cs` - top-level `automation ...` command routing.
- `Commands/Codegen/CodegenCommandRunner.cs` - generated build contracts, programmatic Host TypeGen DTOs, and TypeScript Host client check/sync routing.
- `../Pe.Aps/Auth/ApsAuthService.cs` - persisted APS auth status, login, logout, and token acquisition flow.
- `../Pe.Dev.RevitAutomation/AutomationBrowseService.cs` - sticky browse context plus repo-local cache-backed ACC discovery.
- `../Pe.Dev.RevitAutomation/AutomationManifestService.cs` - human-readable schedule manifest create/update/validate flow.
- `../Pe.Dev.RevitAutomation/AutomationScheduleRunServices.cs` - submit-now / inspect-later schedule run orchestration.

## Validation

Cheap validation loop:

- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- --help`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- doctor`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- self-test`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- status`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- sync --json`
- `dotnet run --project source/Pe.Dev.Cli/Pe.Dev.Cli.csproj -- test --plan --json --filter "Name~AssemblyLoadDiagnostics"`
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

Live runtime validation loop:

- AttachedRrd scripting is the primary interactive Revit lane: build the affected runtime package-local outputs, run `pe-dev sync`, then run `pea script ...` against the live document/session.
- FreshOwnedRevit is the proof lane: use `pe-dev test ...` when RRD freshness is uncertain, HR is unsafe, or current UI/document state is not the thing being investigated.
- `pe-dev doctor --json` is the machine-readable agent preflight; read `outcome`, `exitCode`, `issues[]`, and `recommendedNextSteps[]` instead of scraping human `AGENT GUIDANCE` text.
- `pe-dev sync --json`, `pe-dev doctor --json`, and `pe-dev test --json` are the machine-readable lanes. Prefer them in hooks and autonomous runs; human mode may include `AGENT GUIDANCE` and child process logs.
- Use `pe-dev test --plan --json ...` for safe smoke checks and command planning. It resolves the fresh lane but does not build, quarantine add-ins, launch Revit, run tests, or clean up sessions.
- Use `--timeout-seconds <seconds>` on real `test` proof runs from agents/hooks so a Revit launch or test adapter hang fails bounded with exit code `124`. Keep `--plan` for cheap validation; do not use a real fresh run as a CLI smoke test.
- `pe-dev self-test` is the cheap no-Revit smoke test for the verify command parser and option contracts.
- AGENT GUIDANCE: AttachedRrd validation uses assemblies already loaded in RRD. If runtime code changed, run `pe-dev sync` before `pea script ...` or attached `.Tests`; an isolated `dotnet build` / `./build` is not runtime freshness proof.

Agent command decision flow:

1. Start with `pe-dev doctor --json` when runtime state is unknown.
2. If `exitCode=2`, fix local shell/runtime setup first; do not chase Revit behavior yet.
3. If current live document/UI state matters, run `pe-dev sync`, then `pea script ...` or attached `.Tests`.
4. If current live document/UI state does not matter, run `pe-dev test ...` for deterministic proof.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **dev CLI** | The repo-local developer/operator surface is `pe-dev` | Avoid reviving `pe-script` or separate automation executables |
| **operator surface** | The command families humans and agents should actually learn and run | Prefer `pe-dev doctor` / `sync` / `test` for agent-safe verification and `pea script` for live document probes |
| **automation workflow** | `pe-dev automation ...` | Prefer this over nesting DA under desktop Revit |
| **browse workflow** | the sticky-context ACC discovery commands under `pe-dev automation browse ...` | Prefer this over copy-pasting ids through one-off list commands |
| **status workflow** | `inspect receipt` and `inspect workitem` | Prefer inspection over rerunning jobs when you already have a receipt or id |
| **JSON mode** | `--json` output intended for downstream tooling or scripting | Prefer this for machine consumption instead of scraping human text |
| **AGENT GUIDANCE** | Human-readable command output that tells agents how to interpret runtime state and what to do next | Use this in build-hook and verification output when freshness, lane, or confidence is ambiguous |

## Living Memory

- `Pe.Dev.Cli` is the only CLI humans and agents should learn for repo-local development/operator work.
- `Pe.Dev.Cli` is not installed by the MSI; deployed agent/user workflows use `pea` instead.
- Local `Pe.Dev.Cli` builds now mirror the runnable CLI output to `%LocalAppData%\Positive Energy\Pe.Tools\bin\pe-dev\`. If the user wants `pe-dev` on `PATH`, that mirrored bin directory is the intended dev-facing path to register.
- `env`, `revit`, `verify`, `pea`, `automation`, and `codegen` are first-class root command families; keep implementation plumbing out of public help.
- `doctor` is the agent preflight when runtime state is ambiguous: it aggregates Windows env health, dev/install runtime presence, runtime descriptors, host/bridge/session state, and loaded-vs-disk runtime freshness guidance.
- `pea script` belongs to the deployed `pea` surface, not `pe-dev`; keep AttachedRrd scripting as the primary interactive lane and make freshness explicit with `pe-dev sync` before script execution.
- Build hooks must consume the built CLI output through `dotnet exec`, not `dotnet run`.
- Approval watcher plumbing and lower-level hot-reload are internal. Keep agent-facing runtime entrypoints on `sync` while preserving `sync` as the lower-level/direct command.
- `sync` is the agent-facing pre-live-validation command. Keep it explicit, health-aware, and thin over the lower-level HR path.
- `status` and `status` split static runtime/install diagnostics from live desktop session diagnostics. It should stay CLI-first, pull in host probe/session-summary facts through shared Host contracts when available, and keep `--json` honest for tooling.
- `test` is the preferred agent-facing alias for fresh-owned Revit verification; keep `test fresh` available as the lower-level/direct command.
- `test fresh` is an explicit Revit-backed verification helper, not the semantic center of repo testing. Keep it thin, deterministic, and honest about the behavior it owns.
- `test fresh` currently provides the dedicated `FreshRevitProcess` helper. By default it auto-selects a safe Revit year in the same runtime family that is not already running, then forces a dedicated test Revit process, temporarily hides the deployed `Pe.App` add-in for that year unless the operator opts out, and closes the fresh process after the run.
- `test fresh` should record the owned fresh Revit session as soon as it appears, recycle that exact owned process on the next run when needed, and prefer failing over broad same-year process kills if ownership becomes ambiguous.
- `test fresh` should also start the approval watcher for its target year before launching a fresh test-controlled Revit process, otherwise unsigned add-in approval can stall unattended startup.
- Do not hide `test fresh` behind ordinary `dotnet build` or bare `dotnet test` flows. If a workflow needs this helper, require explicit intent.
- Keep CLI models honest: parse flags here, but keep APS policy, packaging, worker definitions, and report/artifact handling in `Pe.Dev.RevitAutomation`.
