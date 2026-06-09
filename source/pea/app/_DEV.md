# pea app Development Notes

## Mental Model

This app hosts two products that share a TypeScript shell but not a persona.

Pea is the deployed Revit/operator workbench. It starts in a host-reported workspace, memory-mounts bundled Pea workflow skills, discovers user skills from `.pea/skills` and `~/.pea/skills`, and exposes Pea product tools for host/Revit work.

dev-agent is the Pe.Tools repo coding agent. It is assembled directly on Mastra Harness/Workspace primitives, with source-work tools plus extra verification and product-probing tools available when proof needs repo or Revit context.

## Architecture

- `main.ts` owns the human CLI tree. Keep `pea agent` for deployed Pea and `pea dev` for the repo coding agent. ACP and AG-UI are protocol flags on those runtime boundaries, not separate commands/personas.
- `pea-runtime.ts` owns `createPea(...)` and `createPeaDev(...)`, the Pe.Tools-owned runtime seams over public Mastra Harness, Workspace, Memory, and auth storage primitives. Do not reintroduce `createMastraCode(...)` as an internal dependency.
- Harness thread identity is runtime-scoped: `dev-agent` uses the normal MastraCode database and MastraCode-compatible project resource id so repo-agent threads appear beside bare MastraCode threads, while Pea uses an isolated `.pea/mastra.db` plus Pea-local resource id under the resolved Pea workspace (for example `Documents/Pe.Tools/.pea`) so product/operator memory does not mix with repo-agent memory.
- `pea-runtime-events.ts` and `mastra-harness-runtime-events.ts` define the Pea-owned protocol-neutral runtime event contract. Mastra Harness events terminate there; protocol adapters must not import `HarnessEvent` directly.
- `pea-runtime-factory.ts` and `pea-runtime-protocol-sessions.ts` own protocol-facing runtime construction, active session ids, thread/resource mapping, prompt concurrency, cancellation, and protocol cwd/resource metadata. Protocol adapters should use these seams instead of calling `createPea(...)` / `createPeaDev(...)` directly.
- `pea-runtime-session-registry.ts` owns the file-backed protocol session metadata and history registry. It makes ACP session list/resume/delete/load/fork and AG-UI external-thread mapping/event history durable across adapter reconstruction. ACP load can replay protocol-visible history and inject restored history into a fresh runtime thread. ACP fork creates a new protocol session and fresh runtime thread with copied protocol-visible history. AG-UI rehydration maps the same external `threadId` to a fresh runtime thread and injects prior AG-UI-visible history as restored context. Harness-native model-memory restoration and branching remain future work.
- `pea-runtime-resources.ts` owns protocol-neutral resource references and session resource scope. ACP `resource_link` / embedded resources and AG-UI multimodal inputs must enter the runtime through `PeaRuntimeResource`, then become runtime context at the session seam.
- `pea-runtime-auth.ts` owns protocol-neutral runtime auth descriptors. ACP auth methods and AG-UI auth capability metadata must come from this descriptor; local HTTP/SSE bearer tokens are transport auth, not model/runtime credential auth. ACP logout may only be advertised for runtimes with a scoped revocation seam; today that means `pea` clears Pea-owned OpenAI/Codex credentials, while `dev-agent` logout stays disabled because it uses broader MastraCode auth storage.
- `pea-runtime-client.ts` owns protocol-neutral client delegation capabilities such as user permission, client filesystem, terminal, and terminal-auth support. ACP adapts `InitializeRequest.clientCapabilities`, `requestPermission`, `fs/*`, and `terminal/*` methods into this contract; protocol prompts carry that client and Pea protocol session id through the Pea runtime request context so runtime tools can depend on this seam instead of importing ACP SDK types. Do not add duplicate visible harness tools for client-owned file or terminal operations; route client delegation through the existing workspace/file/command execution seams when those seams can apply it deterministically.
- `pea-runtime-interrupts.ts` owns protocol-neutral runtime interrupt outcomes and resume decisions for tool approval, tool suspension, plan approval, and runtime suspension. `pea-runtime-context.ts` carries resume decisions as structured request context while `PeaRuntimeProtocolSessions` also injects a prompt-visible context entry. AG-UI may project interrupts into `RUN_FINISHED` outcomes and normalize `resume[]` back through this seam, but protocol adapters should not invent policy-specific interrupt reasons directly.
- `pea-local-transport-auth.ts` owns local bearer/query/header token validation for HTTP/SSE protocol surfaces. Local browser transports should require a generated token by default.
- `acp/` adapts Pea/dev-agent runtime sessions and Pea runtime events to Agent Client Protocol transports. ACPX is the protocol truth lane; T3 Code is downstream client/UI inspiration. The stdio `pea --acp` / `pea dev --acp` entrypoints are the client-compatible baseline, while HTTP/SSE exposes the same SDK-backed JSON-RPC stream for remote/browser-mediated clients.
- `agui/` adapts the same Pea/dev-agent runtime sessions and Pea runtime events to native AG-UI HTTP/SSE. Prefer this over routing frontend work through ACP when the client can speak AG-UI directly. AG-UI `context` entries must flow through the runtime context primitive, not permanent prompt widening.
- `pea-agent.ts` constructs only the deployed Pea operator agent.
- `dev-agent.ts` constructs the repo coding agent on the shared runtime seam without product-persona merging.
- `tools/pea/tools.ts` exports Pea product tools: status, logs, scripting, Revit API docs, and host-operation search/call.
- `tools/shared/live-loop.ts` owns the shared live-loop implementation used by dev-agent tools and the human `pea live status/sync/restart` Gunshi commands.
- `tools/dev/tools.ts` exports only narrow dev-agent repo verification wrappers: `live_loop_context`, `live_rrd_sync`, `live_rrd_restart`, `talk_to_pea`, sync-first `script_execute`, and `test`.
- `runtime-skill-source.ts` composes bundled/default in-memory skill mounts with user disk skill roots through Mastra Core's `Workspace.skillSource` seam.
- `bundled-skill-content/` contains Pea workflow skills memory-mounted under `.pea/bundled-skills`; user Pea skills live in `.pea/skills` or `~/.pea/skills`.
- `dev-agent-skill-content/` contains the small dev-agent-only goal skill surface memory-mounted under `.pe-tools/bundled-skills`; user/dev project skills live in Mastra-compatible skill roots such as `.mastracode/skills`, `.agents/skills`, `.claude/skills`, and their user-global equivalents.

## Provenance Rules

- Coding behavior comes from the Pe.Tools runtime seam over Mastra Harness/Workspace primitives: one repo mode for now, source tools, shell tools, memory/resource scoping, and future TUI behavior.
- Live Revit/operator facts come from Pea product tools and `Pe.Host`, not repo source assumptions.
- Repo workflow semantics come from repo commands and docs, especially `pe-dev`, `docs/ENVIRONMENT.md`, `./build`, installer logic, MSBuild props, and package-local `AGENTS.md` files.
- Complex multi-step repo practices belong in dev-agent-only skills.
- Hooks and custom slash commands are not installed by default; hooks are reserved for future narrow unsafe-action guardrails.
- Repo verification wrappers must report what their result proves and does not prove, especially around NoRrdContact, RrdRequired, sync runtime freshness (`fresh`/`stale`/`unproven`), and FreshRevitProcess.
- `pea live status` is the single human-facing live-loop status packet; installed payload metadata lives under `pea runtime payload` to avoid competing runtime-status meanings.
- `pe-dev` is an optional fallback for FreshRevitProcess helper workflows, not a startup gate or live-loop dependency for dev-agent.
- Observational memory/resource scoping follows Mastra's current Harness thread/fork UX. Do not invent Pea-specific resource ids unless a later Harness replacement intentionally changes that behavior.

## Key Flows

### Pea startup

1. Resolve host/workspace arguments.
2. Ask `Pe.Host` for workspace/runtime facts when needed.
3. Seed Pea settings under `.pea`.
4. Install Pea bundled workflow skills under `.pea/skills`.
5. Start the Pe.Tools runtime seam with Pea instructions and Pea product tools only.

### dev-agent startup

1. Resolve the repo workspace root.
2. Preserve any existing root `AGENTS.md`; otherwise install a managed `.mastracode/AGENTS.md` block.
3. Seed project-scoped dev-agent skills in a normal MastraCode skill location for this repo.
4. Do not install hooks or slash commands by default.
5. Start the Pe.Tools runtime seam with the repo coding mode and source tools.
6. Add Pea product tools and the curated repo verification tools as repo-only tools.
7. Keep repo workflow guidance in dev-agent instructions and skills, not in Pea.

### ACP startup and baseline proof

1. Start `pea dev --acp` for the repo coding agent, or `pea --acp` / `pea agent --acp` only when explicitly testing deployed Pea behavior.
2. Use `--acp-transport stdio` for local editor subprocesses and `--acp-transport http` for remote/browser-mediated clients.
3. Keep runtime selection process-local; ACP sessions do not mix Pea and dev-agent threads.
4. Create/open runtime sessions through `PeaRuntimeProtocolSessions` so ACP session ids map cleanly to runtime thread/resource identity while runtime factory churn stays below the protocol layer.
5. Translate Mastra Harness events once into Pea runtime events, then translate Pea runtime events into ACP `session/update` notifications: assistant text chunks, tool cards with raw args/results, task state as plans, and subagent inner tools as first-class prefixed tool cards. Protocol adapters must not depend on Mastra event shapes directly.
6. Treat ACP as the serious integration path for hosted/T3-style minimal UI work, but prove the ACP seam with ACPX/SDK client handshakes before testing inside T3 Code or the browser gateway.
7. Keep hosted Pea web UI as presentation/controller only. Local Pea remains the runtime/tool/Revit authority, owns ACP session lifecycle, and must survive browser refresh or tab closure.
8. Keep browser-localhost transport reconnectable and non-authoritative for model/tool execution. The browser may create sessions, send prompts, cancel turns, and observe raw ACP updates; it must not hold provider/Gateway secrets or become the model proxy.

Preferred proof order:

1. Run Pea app unit tests and typecheck/build.
2. Run ACPX directly against `pea --acp` and `pea dev --acp`.
3. Run SDK client handshakes over the HTTP/SSE transport for both runtimes.
4. Return to T3 Code provider/UI integration only after ACPX/SDK proof succeeds.

ACPX baseline commands from `source/pea/app`:

```text
acpx --version
pnpm acpx:dev-agent:session
pnpm acpx:dev-agent "Say hi and name the current repo."
pnpm acpx:dev-agent:json "List the files in the current repo root and explain which ACP updates represented the tool call."
```

Equivalent raw commands:

```text
acpx --agent "pnpm --dir source/pea/app pea --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 120 --ttl 30 sessions ensure
acpx --agent "pnpm --dir source/pea/app pea dev --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 120 --ttl 30 sessions ensure
acpx --agent "pnpm --dir source/pea/app pea dev --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 180 --ttl 30 --format text "Reply exactly: ACP_OK_DEV"
```

Important cwd rule: ACPX starts the raw agent subprocess from the ACP session cwd. Keep ACPX `--cwd` pointed at the Pe.Tools repo root, and make the raw agent command target the Pea app package explicitly with `pnpm --dir source/pea/app ...`. Do not run parallel raw-agent ACPX prompt turns with the same cwd/session cache; create/ensure sessions sequentially when testing both runtimes.

First-slice limitations:

- Mastra/dev-agent owns terminal and filesystem execution by default; ACP clients display tool progress and raw payloads. ACP client capabilities for permissions, fs, terminal, and terminal auth are captured behind `PeaRuntimeClient`; pending runtime approval tools are forwarded to ACP `session/request_permission`, ACP permission answers are recorded as pending Pea runtime resume decisions for the next prompt, and ACP-backed filesystem/terminal delegation methods are carried into runtime request context through the same Pea runtime contract. Runtime tools should only switch to client-owned execution through this seam when the runtime command path can apply it deterministically.
- `session/list`, `session/resume`, `session/load`, `session/fork`, `session/delete`, and `session/close` are supported through `PeaRuntimeProtocolSessions`; real protocol servers persist session metadata and protocol-visible history in `PeaRuntimeSessionRegistry`, `close` frees active runtime resources without deleting the listed session, and `additionalDirectories` is advertised and updates the active session resource scope on resume/load/fork. Loading a persisted session replays user prompt chunks and ACP updates to the client, then injects restored history as context into the first prompt on the fresh runtime thread. Forking creates a new protocol session and fresh runtime thread, copies protocol-visible history, and injects the copied history into the first prompt. Neither path restores or branches Mastra/Harness model memory.
- ACP advertises runtime auth methods from `PeaRuntimeAuth`: `OPENAI_API_KEY` env-var auth for API-key mode and agent-managed Codex OAuth for OAuth mode. `authenticate` validates method ids; `logout` is advertised only for `pea` and clears scoped Pea OpenAI/Codex credentials plus the current process `OPENAI_API_KEY`.
- The local browser gateway is an adapter over the ACP session/update spine, not a replacement for `--acp` stdio/HTTP or ACPX/SDK proof.
- `pea --acp` and `pea dev --acp` use the same adapter but must both be verified because they cross different product/runtime boundaries.
- AG-UI uses generated local-token transport auth by default, exposes status/session discovery/event-replay/logout/run/close/delete endpoints, maps AG-UI `threadId` to Pea-owned runtime sessions through the same persisted metadata registry, records emitted AG-UI events as protocol-visible history, reports runtime auth metadata and `pea.logoutSupported` under `capabilities.custom`, emits sequenced run/state/message snapshots before streaming runtime events, and reports runtime tool/plan suspension as `RUN_FINISHED` interrupt outcomes. `forwardedProps.pea.cwd` and `forwardedProps.pea.additionalDirectories` are Pea-owned AG-UI control metadata for runtime resource scope; strip them before generic forwarded props become prompt context. `transport.resumable` means replaying persisted events after a client-supplied sequence through `GET /agui/events`; it does not mean true suspended-turn continuation. AG-UI `resume[]` entries are normalized into Pea runtime resume decisions through `PeaRuntimeInterrupt`, passed as structured runtime request context, and injected as prompt-visible context by `PeaRuntimeProtocolSessions`. After adapter reconstruction, the same AG-UI `threadId` is rehydrated into a fresh runtime thread with prior AG-UI-visible history injected into the first prompt. True suspended-turn resume remains future work until runtime tools can consume resume decisions deterministically.

### Black-box product feedback

1. dev-agent changes source directly.
2. It proves compile/package/runtime behavior through normal tools and narrow repo wrappers.
3. When product behavior matters, it uses `talk_to_pea` to delegate to the real Pea operator agent in a stateful thread.
4. It frames Pea turns as `operator`, `feedback`, or `collaborate` depending on whether it needs a user-facing answer, product/harness critique, or Revit/project convention exploration.
5. It reports observed harness/product behavior back into the source-editing loop.

## Open Questions

- Whether the long-term human-facing command should remain under `pea dev` or move to a separate PATH name.
- Which repeated repo workflows deserve dev-agent skills after real usage proves the pattern.
