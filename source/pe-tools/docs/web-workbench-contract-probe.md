# Web Workbench Contract Probe

## Decision

Pea/Peco workbench development is pivoting to a React web workbench as the advanced contract probe. The custom `@pe/tui` work is paused and should not drive product or contract decisions. Mastra's existing TUI remains sufficient for terminal-first usage while this repo focuses on richer tool-call observability and durable Pe workbench contracts.

The web UI is intentionally disposable. Its component tree, CSS, routing, visual design, and bundler details are not the durable artifact. The durable artifacts are:

- `@pe/agent-contracts`: product-facing workbench state, events, command request/response types, and transport payload shapes.
- `@pe/agent-projection`: ACP/Mastra/runtime event projection into stable workbench state plus selectors.
- `@pe/workbench-core`: UI-neutral command controller and state transition surface.
- `@pe/acp-client`: ACP adapter hiding protocol volatility behind Pe workbench contracts.
- `@pe/workbench-transport`: browser-safe HTTP/SSE request and event boundary.

## Product Boundary

Pea is the deployed/operator workbench. Peco is the repo coding agent. The web workbench should support both runtimes through the same contracts, but Pea product semantics get priority when a contract question has to pick a default.

## Probe Goals

The web workbench should stress the high-level state model and UX feel for:

- thread/session list, loading, active-thread identity, and history replay
- part-based transcript rendering
- active and recent tool-call observability
- raw tool input/output inspection when available
- approval request/resolution lifecycle
- plan/task visibility
- model and session mode visibility/mutation where supported
- observational memory, system prompt, raw messages, context, and debug event inspection
- browser transport semantics for state snapshots, streamed events, and commands

## Non-Goals

- Do not polish the custom TUI in this pass.
- Do not treat React component structure as architecture.
- Do not add a design system unless the lack of one blocks contract probing.
- Do not claim AttachedRrd proof from this work; this is a Pea/Peco source/dev workbench lane.

## Contract Rule

If a behavior is needed by both the web UI and any plausible future durable UI, it belongs in `@pe/*` contracts, projection, controller, adapter, or transport. React should keep only local view state such as selected tab, selected tool/debug item, selected inspector entry, pane sizes, and draft composer text.

## Implemented Contract Decisions

- `WorkbenchState` is domain-shaped rather than adapter-shaped: `agent`, `threads`, `transcript`, `tools`, `approvals`, `plans`, `models`, `modes`, `memory`, `inspector`, `debug`, and `uiStatus` are the stable UI domains.
- Transcript messages are part-based. Renderers consume typed parts (`text`, `reasoning`/`thought`, tool references, approval references, status, error, and raw payloads) instead of flattening ACP updates into opaque text.
- Thread identity is explicit as workbench thread/session state. ACP session ids can back thread ids, but UI code must not assume every future runtime has `threadId === sessionId`.
- Tool observability is a first-class state domain. Tool calls carry status, raw input/output when available, content previews, locations, errors, timestamps, provenance, and timeline entries.
- Approval lifecycle is controller/adapter-owned. Resolvers are keyed by session/tool-call request identity, pending approvals are projected into state, approval resolution is transported back through the ACP client, and session close/load clears stale pending approvals. Pea's current runtime still needs a same-turn approval continuation seam before an approved in-flight ACP tool can complete.
- Model and mode are separate domains. ACP supports `setSessionMode`; model mutation is currently projected as workbench state/debug metadata until provider config mutation has a durable protocol rule.
- Browser clients talk through explicit HTTP/SSE transport: snapshot fetch, event stream, and command POSTs. Browser code must not instantiate ACP clients directly.
- React applies `WorkbenchEvent`s through `@pe/agent-projection`; it does not parse ACP or own durable reducer rules.

## Implemented Transport Semantics

- The localhost workbench server requires a local connection token. This is loopback transport plumbing, not WorkOS/Pea Cloud/user identity auth; served workbench URLs carry their per-launch token automatically, while Vite dev defaults to the fixed `dev-loopback` token used by `pea dev:web` / `peco dev:web`.
- `GET /api/workbench/state` returns the current `WorkbenchState` snapshot.
- `GET /api/workbench/events` streams `workbench-state` and `workbench-event` SSE records.
- Command routes return `{ ok: true, state }` after routing through `WorkbenchController`.
- Supported command routes: `start`, `send`, `threads/refresh`, `threads/load`, `approvals/resolve`, `cancel`, `model`, and `mode`.
- The same transport server can serve a built disposable website directory, but the website can also run separately through Vite+ with `PE_WORKBENCH_API_URL` or `?api=`.

## Disposable UI Choices

- `apps/website` is a dense three-pane React workbench: left thread/session pane, center transcript/composer/approvals, right tool and inspector/debug panes.
- CSS, layout widths, component names, tab structure, and Vite app layout are disposable.
- Durable discoveries live in the `@pe/*` packages and this note, not in React component structure.

## Proof Lanes Used

- Source/package proof, NoRrdContact: package checks and tests for contracts, projection, controller, ACP adapter, transport, Pea/Peco app checks, and website.
- Package/artifact proof, NoRrdContact: `website#build`, `@pe/workbench-transport#build`, `@pe/agent-projection#build`, and `@pe/acp-client#build` produced fresh runtime artifacts for the web smoke lane.
- Local Peco web/dev smoke, NoRrdContact:
  - `peco web --port 43113 --static-dir <website/dist>` served the built React app.
  - `GET /api/workbench/events` streamed the initial `workbench-state` and live `workbench-event` records.
  - `POST /api/workbench/commands/start` initialized `Pe.Tools Dev Agent`, created session `runtime-acp-16`, and returned 16 threads.
  - `POST /api/workbench/commands/send` with a repository file-listing prompt completed successfully with 3 transcript messages, 1 tool call, 60 debug events, and final run status `idle`.
  - The runtime smoke caught stale `@pe/acp-client` dist output still emitting old `status_changed` events and an unsafe projection fallback for unmapped updates. The fix is to pack fresh ACP/projection artifacts and keep unknown ACP updates debug-only/no-op instead of corrupting state.
- Local Pea web/dev smoke, NoRrdContact:
  - Initial `pea web --port 43114 --static-dir <website/dist>` served the web workbench URL/API but exposed Pea product storage initialization failure: `SQLITE_ERROR: no such table: mastra_threads` (`MASTRA_STORAGE_LIBSQL_SAVE_THREAD_FAILED`).
  - Runtime storage was fixed so `createRuntimeHarness` initializes active storage before session/memory use while preserving `disableInit`.
  - Fresh-state `pea web --port 43115 --static-dir <website/dist>` then initialized session `runtime-acp-2` and reported Pea workbench capabilities including threads, history, tool calls, approvals, raw tool IO, model switching, session modes, observational memory, and system prompt inspection.
  - Pea local state reported `availableModels: []` and only `pea` as the active mode in this auth/config state.
  - Prompt smoke streamed transcript/debug/tool events and raised an approval request for `Host Operation Search` with raw input and `allow_once`/`reject_once` options. `POST /api/workbench/commands/approvals/resolve` moved the approval to `resolved` through the web transport.
  - Completed Pea tool execution was not proved: after approval resolution the ACP tool remained `pending` and run status stayed `running`. Root cause is runtime continuation, not browser transport: the active Mastra run needs a same-turn approval resume seam, while the current ACP path records resume decisions for prompt-start context.
- No AttachedRrd proof was claimed.
