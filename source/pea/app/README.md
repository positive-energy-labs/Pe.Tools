# pea app

`pea` is the Pe Agent command surface. It is user/agent-facing and talks to `Pe.Host` through generated TypeScript host clients and operation metadata.

## Commands

```powershell
pea --help
pea agent
pea host status
pea host logs --target revit --tail 50
pea host operations --query "active document" --limit 5
pea host operation search --query "settings validate"
pea host operation call --key settings.session-summary --json "{}"
pea config defaults
pea config defaults --write
pea script bootstrap --workspace default
pea script execute --source-path src\SampleScript.cs
```

## Local development

```powershell
pnpm install
pnpm run check
pnpm run build
pnpm run pea --help
```

Development scripts mirror the public command shape:

```powershell
pnpm run agent
pnpm run status
pnpm run bootstrap
pnpm run execute -- --source-path src\SampleScript.cs
```

## Configuration

`pea config defaults` prints the Pea-owned settings path, seeded model pack, goal judge, OM thresholds, quiet/TUI posture, and behavior-bearing runtime policy. `pea config defaults --write` seeds or updates the MastraCode-compatible Pea settings file without launching the agent.

Seeded Pea defaults are intentionally Revit-agent focused:

- custom model pack: `custom:Pea OpenAI`
- agent/build/plan/fast models and goal judge from `app/pea-instructions.ts`
- observer/reflector overrides and OM thresholds from `app/pea-runtime-defaults.ts`
- goal max turns from the Pea defaults summary
- `yolo=true`, `thinkingLevel=medium`, quiet mode enabled, `quietModeMaxToolPreviewLines=0`, `theme=auto`
- prompt caching required, OpenAI Responses item-reference compatibility enabled, MCP disabled by default

`pea` resolves host/workspace facts in this order:

- `--host`, then `PE_TOOLS_HOST_BASE_URL`, then the local default host URL
- `--workspace`, then the default workspace key
- `pea agent` uses `--workspace-root` as an explicit cwd override; otherwise it bootstraps the scripting workspace through `Pe.Host` and starts at the returned product/workbench root
- Pea settings are stored at `.pea/settings.json` under that host-reported root
- bundled skills are written under `.pea/skills` before the agent starts

Prefer host-reported paths over hardcoded TypeScript assumptions. Use `--workspace-root` only as an explicit local override for narrower agent scope.

## Agent runtime

`pea agent` runs through a thin Pea runtime wrapper around `createMastraCode`, then uses MastraCode's `MastraTUI`. Pea owns one primary `agent` posture, dynamic instructions with transient startup context and status-change invalidation notices, defaults, bundled workflow skills, processors, normal workspace file/CLI tools, and a small Pe-specific tool set:

- fresh status and logs
- script bootstrap and execution
- Revit API doc search/fetch
- host-operation search/call with generated request/response hints

The startup seed is a per-thread orientation snapshot from workspace facts plus `revit.context.summary` when the Revit bridge is connected. After startup, Pea checks cheap host/session status internally on each turn and injects only a compact `<pea-status-change>` invalidation notice when the normalized status changes; unchanged status stays invisible and prior/current status facts are not injected. Use `pe_status` as the explicit host/session source of truth, `host_operation_call key=revit.context.summary` for current Revit user context, and `host_operation_call key=revit.context.visible-summary` for visible active-view contents.

Bundled workflow skills include Family Foundry profile authoring, Family Foundry artifact debugging, active-document inspection, Revit C# script authoring, and settings/profile validation.

The OpenAI Responses compatibility processor strips stale provider item-reference replay metadata from provider-bound history and retries once on `rs_...` item-not-found errors. It does not disable prompt caching or remove local message text/tool history.

When a capability exists as a public host operation, prefer discovering and calling it over writing a raw script. Use scripts for Revit API gaps, focused probes, and bounded document mutations with follow-up verification.
