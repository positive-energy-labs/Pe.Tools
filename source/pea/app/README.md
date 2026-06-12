# pea app

`source/pea/app` is the retired legacy TypeScript CLI/runtime location. The active CLI composition now lives under `source/pe-tools/apps`:

- `pea` is the deployed Revit/operator workbench CLI.
- `peco` is the Pe.Tools repo/dev CLI with Pea black-box feedback tools.

Keep those surfaces separate. Pea is product/runtime-facing; peco is repo/source-facing.

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

`peco` and `pea Peco` are intentionally gone; use `peco` for repo/dev workflows.

## Protocol entrypoints

ACP is exposed as a flag on the existing runtime boundaries:

```powershell
pea --acp
pea agent --acp
peco --acp
peco --acp --model-id openai/gpt-5.5
```

The default transport is stdio, matching clients and wrappers that spawn agents with `args: ["--acp"]`.
For remote or browser-mediated clients, use the HTTP/SSE transport:

```powershell
pea --acp --acp-transport http --acp-port 43111
peco --acp --acp-transport http --acp-port 43111 --acp-token <token>
```

HTTP transport exposes `POST /rpc` for ACP JSON-RPC messages and `GET /events` for server-to-client JSON-RPC responses, notifications, and requests. The bearer/query token printed at startup is required for both endpoints.

There is intentionally no separate `pea acp-agent` command. Use `pea --acp` for Pea and `peco --acp` for Peco.

Verified local ACPX smoke commands:

```powershell
pnpm acpx:pea:session
pnpm acpx:Peco:session
pnpm acpx:Peco "Reply exactly: ACP_OK_DEV"

acpx --agent "pnpm --dir source/pea/app pea --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 120 --ttl 30 sessions ensure
acpx --agent "pnpm --dir source/pea/app peco --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 120 --ttl 30 sessions ensure
acpx --agent "pnpm --dir source/pea/app peco --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 180 --ttl 30 --format text "Reply exactly: ACP_OK_DEV"
```

Zed-style local agent packaging consumes the same stdio contract through `cmd` and `args`:

```toml
[agent_servers.pea-dev]
name = "Pe.Tools Peco"

[agent_servers.pea-dev.targets.windows-x86_64]
cmd = "pnpm"
args = ["--dir", "source/pea/app", "pea", "dev", "--acp", "--model-id", "openai/gpt-5.5"]
```

Remote/browser-mediated clients should connect to the printed HTTP URLs and send ACP JSON-RPC envelopes to `POST /rpc` while reading server-to-client envelopes from `GET /events`. ACP resource links, embedded resources, and session `cwd` / `additionalDirectories` are normalized into Pea runtime resources before they reach the agent runtime. ACP initialization advertises runtime auth methods for API-key or Codex OAuth modes; HTTP bearer/query tokens only protect the local transport. ACP `logout` is advertised only for the `pea` runtime, where it clears Pea-owned OpenAI/Codex credentials from the scoped Pe.Tools auth file and current process environment; `Peco` logout remains disabled because it uses broader MastraCode auth storage. Real ACP servers persist protocol session metadata and protocol-visible history in the Pea runtime session registry, so `session/list`, `session/resume`, `session/load`, `session/fork`, and `session/delete` survive adapter reconstruction. `session/load` replays stored user prompt chunks and ACP updates to the client, then injects restored history as context into the first prompt on the fresh runtime thread. `session/fork` creates a new Pea-owned protocol session and fresh runtime thread, copies protocol-visible history, and injects that copied history on the first prompt. This does not restore or branch Mastra/Harness model memory yet. ACP client permissions, filesystem, terminal, and terminal-auth capabilities are captured under the Pea runtime client contract; pending runtime approval tools are forwarded to ACP `session/request_permission`, permission answers are recorded as pending Pea runtime resume decisions for the next prompt, and ACP-backed filesystem/terminal methods are carried into the runtime request context as `PeaRuntimeClient`. Pea must not add duplicate visible harness tools for client-owned file or terminal operations; those delegation seams should be consumed by the existing workspace/file/command execution paths when they can apply client-owned execution deterministically.

Native AG-UI is exposed separately for frontend-forward clients that already speak AG-UI HTTP event streams:

```powershell
pea --ag-ui --ag-ui-port 43112
peco --ag-ui --ag-ui-port 43112 --ag-ui-token <token>
```

The AG-UI endpoint serves `GET /agui/status`, `GET /agui/sessions`, `GET /agui/events`, `POST /agui/logout`, `POST /agui/run`, `POST /agui/sessions/:threadId/close`, and `DELETE /agui/sessions/:threadId`. It prints bearer/query-token URLs at startup and requires a generated local transport token by default when one is not supplied. It uses the same Pea-owned runtime/session seam as ACP, persists AG-UI `threadId` mappings and protocol-visible event history in the runtime session registry, forwards AG-UI `context`, state, tools, forwarded props, and multimodal input resources through the runtime context/resource primitives, reports runtime auth metadata under AG-UI `capabilities.custom` including `pea.logoutSupported`, emits run/state/message snapshots, streams AG-UI SSE events from the stable Pea runtime event contract, and reports Pea runtime tool/plan suspension as AG-UI `RUN_FINISHED` interrupt outcomes. AG-UI callers can pass Pea runtime scope as `forwardedProps.pea.cwd` and `forwardedProps.pea.additionalDirectories`; those control fields update the Pea protocol session resource scope and are stripped before generic forwarded props become prompt context. Emitted AG-UI events include monotonically increasing `sequence` values per thread, and `GET /agui/events?threadId=<id>&afterSequence=<n>` replays persisted events after that sequence; this is the advertised `transport.resumable` behavior. `close` frees active runtime resources while keeping listed thread metadata; `delete` removes the thread mapping and persisted protocol-visible event history. AG-UI `resume[]` entries are normalized into Pea runtime resume decisions through `PeaRuntimeInterrupt`, exposed as structured runtime request context, and injected as prompt-visible context at the runtime session seam. After adapter reconstruction, the same AG-UI `threadId` is rehydrated into a fresh runtime thread and prior AG-UI-visible history is injected into the first prompt as restored Pea context. True suspended-turn continuation still depends on runtime/tool support; the protocol adapter no longer owns that decision shape.

## Local development

```powershell
pnpm install
pnpm run check
pnpm run build
pnpm run pea --help
pnpm run agent
pnpm run Peco
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

Pea model auth is explicit: `--auth-source api-key` requires an OpenAI API key path, `--auth-source oauth` requires stored Codex/Mastra OAuth credentials, and `--auth-source auto` prefers API-key configuration unless `--allow-oauth-beta-auth` or `PEA_ALLOW_OAUTH_BETA_AUTH` enables the temporary OAuth beta escape hatch. Existing `OPENAI_API_KEY` values win; stored API keys hydrate `process.env` only when the process has no key.

## Pea agent runtime

`pea agent` runs through the Pe.Tools `createPea(...)` runtime seam over Mastra Harness/Workspace primitives, then uses Mastra's TUI renderer. Pea owns one primary `agent` posture, dynamic instructions with transient startup context and status-change invalidation notices, defaults, bundled workflow skills, processors, workspace file/CLI tools, and a small Pe-specific tool set:

- fresh status and logs
- script bootstrap and execution
- Revit API doc search/fetch
- host-operation search/call with generated request/response hints

The startup seed is a per-thread orientation snapshot from workspace facts plus `revit.context.summary` when the Revit bridge is connected. After startup, Pea checks cheap host/session status internally on each turn and injects only a compact `<pea-status-change>` invalidation notice when the normalized status changes; unchanged status stays invisible and prior/current status facts are not injected. Use `pe_status` as the explicit host/session source of truth, `host_operation_call key=revit.context.summary` for current Revit user context, and `host_operation_call key=revit.context.visible-summary` for visible active-view contents.

Bundled Pea workflow skills include Family Foundry profile authoring, Family Foundry artifact debugging, active-document inspection, Revit C# script authoring, and settings/profile validation.

The OpenAI Responses compatibility processor strips stale provider item-reference replay metadata from provider-bound history and retries once on `rs_...` item-not-found errors. It does not disable prompt caching or remove local message text/tool history.

When a capability exists as a public host operation, prefer discovering and calling it over writing a raw script. Use scripts for Revit API gaps, focused probes, and bounded document mutations with follow-up verification.

## Peco runtime

`peco` starts the Pe.Tools source-editing agent for this repo through `createPeaDev(...)`. It uses Mastra Harness/Workspace primitives for local memory/resource scoping, workspace tools, shell execution, and TUI behavior, then adds:

- Pea product tools for black-box host/Revit/product facts
- narrow repo verification tools: `live_loop_context`, `live_rrd_sync`, `live_rrd_restart`, `talk_to_pea`, sync-first `script_execute`, and `test`
- the same live-loop implementation is exposed for humans through `pea live status`, `pea live sync`, and `pea live restart`
- project-scoped workflow skills under `.mastracode/skills`, including `pe-live-loop` for fragile live Revit/Rider/Windows coordination
- a managed `.mastracode/AGENTS.md` only when the repo root does not already provide `AGENTS.md`

The Peco skill surface is intentionally small and goal-enabled: `pe-steer`, `pe-diagnose`, `pe-live-loop`, `pe-tdd`, `pe-architecture`, `pe-codify-work`, `pe-handoff`, and `pe-write-skill`.

No Peco hooks or slash commands are installed by default. Workflow sequencing belongs in skills and repo verification tools; hooks are reserved for future narrow unsafe-action guardrails.
