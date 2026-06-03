# pea app

`source/pea/app` owns the TypeScript CLI/runtime for two separate entrypoints:

- `pea agent` starts **Pea**, the deployed Revit/operator workbench.
- `pea dev` starts **dev-agent**, the Pe.Tools repo coding agent with Pea black-box feedback tools.

Keep those surfaces separate. Pea is product/runtime-facing; dev-agent is repo/source-facing.

## Operator commands

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

`pea dev-agent` remains a compatibility alias for `pea dev`.

## Local development

```powershell
pnpm install
pnpm run check
pnpm run build
pnpm run pea --help
pnpm run agent
pnpm run dev-agent
```

Development scripts mirror the public command shape:

```powershell
pnpm run status
pnpm run bootstrap
pnpm run execute -- --source-path src\SampleScript.cs
```

## Live-loop commands

`pea live ...` mirrors the shared `live_loop_context` / `live_rrd_sync` / `live_rrd_restart` implementation for humans coordinating AttachedRrd/Rider sessions. It is a repo live-loop surface, not Pea operator-agent context.

```powershell
pea live status
pea live sync
pea live restart
```

## Pea configuration

`pea config defaults` prints the Pea-owned settings path, seeded model pack, goal judge, OM thresholds, quiet/TUI posture, and behavior-bearing runtime policy. `pea config defaults --write` seeds or updates the MastraCode-compatible Pea settings file without launching the agent.

Seeded Pea defaults are intentionally Revit-agent focused:

- custom model pack: `custom:Pea OpenAI`
- agent/build/plan/fast models and goal judge from `pea-instructions.ts`
- observer/reflector overrides and OM thresholds from `pea-runtime-defaults.ts`
- goal max turns from the Pea defaults summary
- `yolo=true`, `thinkingLevel=medium`, quiet mode enabled, `quietModeMaxToolPreviewLines=0`, `theme=auto`
- prompt caching required, OpenAI Responses item-reference compatibility enabled, MCP disabled by default

`pea` resolves host/workspace facts in this order:

- `--host`, then `PE_TOOLS_HOST_BASE_URL`, then the local default host URL
- `--workspace`, then the default workspace key
- `pea agent` uses `--workspace-root` as an explicit cwd override; otherwise it bootstraps the scripting workspace through `Pe.Host` and starts at the returned product/workbench root
- Pea settings are stored at `.pea/settings.json` under that host-reported root
- bundled Pea skills are written under `.pea/skills` before the agent starts

Prefer host-reported paths over hardcoded TypeScript assumptions. Use `--workspace-root` only as an explicit local override for narrower agent scope.

## Pea agent runtime

`pea agent` runs through a thin Pea runtime wrapper around `createMastraCode`, then uses MastraCode's `MastraTUI`. Pea owns one primary `agent` posture, dynamic instructions with transient startup context and status-change invalidation notices, defaults, bundled workflow skills, processors, normal workspace file/CLI tools, and a small Pe-specific tool set:

- fresh status and logs
- script bootstrap and execution
- Revit API doc search/fetch
- host-operation search/call with generated request/response hints

The startup seed is a per-thread orientation snapshot from workspace facts plus `revit.context.summary` when the Revit bridge is connected. After startup, Pea checks cheap host/session status internally on each turn and injects only a compact `<pea-status-change>` invalidation notice when the normalized status changes; unchanged status stays invisible and prior/current status facts are not injected. Use `pe_status` as the explicit host/session source of truth, `host_operation_call key=revit.context.summary` for current Revit user context, and `host_operation_call key=revit.context.visible-summary` for visible active-view contents.

Bundled Pea workflow skills include Family Foundry profile authoring, Family Foundry artifact debugging, active-document inspection, Revit C# script authoring, and settings/profile validation.

The OpenAI Responses compatibility processor strips stale provider item-reference replay metadata from provider-bound history and retries once on `rs_...` item-not-found errors. It does not disable prompt caching or remove local message text/tool history.

When a capability exists as a public host operation, prefer discovering and calling it over writing a raw script. Use scripts for Revit API gaps, focused probes, and bounded document mutations with follow-up verification.

## dev-agent runtime

`pea dev` starts a MastraCode-based source-editing agent for this repo. It keeps normal MastraCode coding tools, modes, subagents, memory, and TUI behavior, then adds:

- Pea product tools for black-box host/Revit/product facts
- narrow repo verification tools: `live_loop_context`, `live_rrd_sync`, `live_rrd_restart`, `talk_to_pea`, sync-first `script_execute`, and `test`
- the same live-loop implementation is exposed for humans through `pea live status`, `pea live sync`, and `pea live restart`
- project-scoped workflow skills under `.mastracode/skills`, including `pe-live-loop` for fragile live Revit/Rider/Windows coordination
- a managed `.mastracode/AGENTS.md` only when the repo root does not already provide `AGENTS.md`

The dev-agent skill surface is intentionally small and goal-enabled: `pe-steer`, `pe-diagnose`, `pe-live-loop`, `pe-tdd`, `pe-architecture`, `pe-codify-work`, `pe-handoff`, and `pe-write-skill`.

No dev-agent hooks or slash commands are installed by default. Workflow sequencing belongs in skills and repo verification tools; hooks are reserved for future narrow unsafe-action guardrails.
