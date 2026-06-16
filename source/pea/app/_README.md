# pea app Development Notes

## Mental Model

This legacy app location has been retired as the owner of TypeScript CLI composition. Active human-facing CLI entrypoints live in `source/pe-tools/apps`.

### Pea startup

1. Resolve host/workspace arguments.
2. Ask `Pe.Host` for workspace/runtime facts when needed.
3. Seed Pea settings under `.pea`.
4. Install Pea bundled workflow skills under `.pea/skills`.
5. Start the Pe.Tools runtime seam with Pea instructions and Pea product tools only.

### Peco startup

1. Resolve the repo workspace root.
2. Preserve any existing root `AGENTS.md`; otherwise install a managed `.mastracode/AGENTS.md` block.
3. Seed project-scoped Peco skills in a normal MastraCode skill location for this repo.
4. Do not install hooks or slash commands by default.
5. Start the Pe.Tools runtime seam with the repo coding mode and source tools.
6. Add Pea product tools and the curated repo verification tools as repo-only tools.
7. Keep repo workflow guidance in Peco instructions and skills, not in Pea.

### ACP startup and baseline proof

1. Start `peco --acp` for the repo coding agent, or `pea --acp` / `pea agent --acp` only when explicitly testing deployed Pea behavior.
2. Use `--acp-transport stdio` for local editor subprocesses and `--acp-transport http` for remote/browser-mediated clients.
3. Keep runtime selection process-local; ACP sessions do not mix Pea and Peco threads.
4. Create/open runtime sessions through `PeaRuntimeProtocolSessions` so ACP session ids map cleanly to runtime thread/resource identity while runtime factory churn stays below the protocol layer.
5. Translate Mastra Harness events once into Pea runtime events, then translate Pea runtime events into ACP `session/update` notifications: assistant text chunks, tool cards with raw args/results, task state as plans, and subagent inner tools as first-class prefixed tool cards. Protocol adapters must not depend on Mastra event shapes directly.
6. Treat ACP as the serious integration path for hosted/T3-style minimal UI work, but prove the ACP seam with ACPX/SDK client handshakes before testing inside T3 Code or the browser gateway.
7. Keep hosted Pea web UI as presentation/controller only. Local Pea remains the runtime/tool/Revit authority, owns ACP session lifecycle, and must survive browser refresh or tab closure.
8. Keep browser-localhost transport reconnectable and non-authoritative for model/tool execution. The browser may create sessions, send prompts, cancel turns, and observe raw ACP updates; it must not hold provider/Gateway secrets or become the model proxy.

Preferred proof order:

1. Run Pea app unit tests and typecheck/build.
2. Run ACPX directly against `pea --acp` and `peco --acp`.
3. Run SDK client handshakes over the HTTP/SSE transport for both runtimes.
4. Return to T3 Code provider/UI integration only after ACPX/SDK proof succeeds.

ACPX baseline commands from `source/pea/app`:

```text
acpx --version
pnpm acpx:Peco:session
pnpm acpx:Peco "Say hi and name the current repo."
pnpm acpx:Peco:json "List the files in the current repo root and explain which ACP updates represented the tool call."
```

Equivalent raw commands:

```text
acpx --agent "pnpm --dir source/pea/app pea --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 120 --ttl 30 sessions ensure
acpx --agent "pnpm --dir source/pe-tools --filter @pe/peco peco -- --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 120 --ttl 30 sessions ensure
acpx --agent "pnpm --dir source/pe-tools --filter @pe/peco peco -- --acp --model-id openai/gpt-5.5" --cwd C:\Users\kaitp\source\repos\Pe.Tools --timeout 180 --ttl 30 --format text "Reply exactly: ACP_OK_DEV"
```

Important cwd rule: ACPX starts the raw agent subprocess from the ACP session cwd. Keep ACPX `--cwd` pointed at the Pe.Tools repo root, and make the raw agent command target the Pea app package explicitly with `pnpm --dir source/pea/app ...`. Do not run parallel raw-agent ACPX prompt turns with the same cwd/session cache; create/ensure sessions sequentially when testing both runtimes.

First-slice limitations:

- Mastra/Peco owns terminal and filesystem execution by default; ACP clients display tool progress and raw payloads. ACP client capabilities for permissions, fs, terminal, and terminal auth are captured behind `PeaRuntimeClient`; pending runtime approval tools are forwarded to ACP `session/request_permission`, ACP permission answers are recorded as pending Pea runtime resume decisions for the next prompt, and ACP-backed filesystem/terminal delegation methods are carried into runtime request context through the same Pea runtime contract. Runtime tools should only switch to client-owned execution through this seam when the runtime command path can apply it deterministically.
- `session/list`, `session/resume`, `session/load`, `session/fork`, `session/delete`, and `session/close` are supported through `PeaRuntimeProtocolSessions`; real protocol servers persist session metadata and protocol-visible history in `PeaRuntimeSessionRegistry`, `close` frees active runtime resources without deleting the listed session, and `additionalDirectories` is advertised and updates the active session resource scope on resume/load/fork. Loading a persisted session replays user prompt chunks and ACP updates to the client, then injects restored history as context into the first prompt on the fresh runtime thread. Forking creates a new protocol session and fresh runtime thread, copies protocol-visible history, and injects the copied history into the first prompt. Neither path restores or branches Mastra/Harness model memory.
- ACP advertises runtime auth methods from `PeaRuntimeAuth`: `OPENAI_API_KEY` env-var auth for API-key mode and agent-managed Codex OAuth for OAuth mode. `authenticate` validates method ids; `logout` is advertised only for `pea` and clears scoped Pea OpenAI/Codex credentials plus the current process `OPENAI_API_KEY`.
- The local browser gateway is an adapter over the ACP session/update spine, not a replacement for `--acp` stdio/HTTP or ACPX/SDK proof.
- `pea --acp` and `peco --acp` use the same adapter but must both be verified because they cross different product/runtime boundaries.
- AG-UI uses generated local-token transport auth by default, exposes status/session discovery/event-replay/logout/run/close/delete endpoints, maps AG-UI `threadId` to Pea-owned runtime sessions through the same persisted metadata registry, records emitted AG-UI events as protocol-visible history, reports runtime auth metadata and `pea.logoutSupported` under `capabilities.custom`, emits sequenced run/state/message snapshots before streaming runtime events, and reports runtime tool/plan suspension as `RUN_FINISHED` interrupt outcomes. `forwardedProps.pea.cwd` and `forwardedProps.pea.additionalDirectories` are Pea-owned AG-UI control metadata for runtime resource scope; strip them before generic forwarded props become prompt context. `transport.resumable` means replaying persisted events after a client-supplied sequence through `GET /agui/events`; it does not mean true suspended-turn continuation. AG-UI `resume[]` entries are normalized into Pea runtime resume decisions through `PeaRuntimeInterrupt`, passed as structured runtime request context, and injected as prompt-visible context by `PeaRuntimeProtocolSessions`. After adapter reconstruction, the same AG-UI `threadId` is rehydrated into a fresh runtime thread with prior AG-UI-visible history injected into the first prompt. True suspended-turn resume remains future work until runtime tools can consume resume decisions deterministically.

### Black-box product feedback

1. Peco changes source directly.
2. It proves compile/package/runtime behavior through normal tools and narrow repo wrappers.
3. When product behavior matters, it uses `talk_to_pea` to delegate to the real Pea operator agent in a stateful thread.
4. It frames Pea turns as `operator`, `feedback`, or `collaborate` depending on whether it needs a user-facing answer, product/harness critique, or Revit/project convention exploration.
5. It reports observed harness/product behavior back into the source-editing loop.

## Open Questions

- Which future runtime abstraction should back `peco` protocol flags without routing dev workflows through `pea`.
- Which repeated repo workflows deserve Peco skills after real usage proves the pattern.
