# Pea beta runtime protocol contract

## Status

Dense context note for the beta Pea browser/protocol seam. Disposable until promoted into Pea feature docs or replaced by the actual server/UI contract.

## Beta goal

Expose Pea runtime activity to frontend and CLI clients without turning those clients into runtime policy, auth, Revit authority, model routing, or tool-approval infrastructure.

```text
Mastra HarnessEvent
  -> Pea runtime event contract
  -> ACP / AG-UI protocol adapters
  -> browser, editor, or CLI clients
```

Mastra is an implementation detail below the Pea runtime contract. ACP and AG-UI adapters consume Pea runtime events, not raw `HarnessEvent` or `HarnessDisplayState`.

## Core decisions

- Browser and CLI clients observe and steer the local runtime; local Pea/Peco executes.
  - Why: Revit/tool/model/source lifecycle is local runtime state, not browser-tab state.
- The local protocol boundary is Pea-owned.
  - Why: protocol clients should prove product/frontend communication seams, not grow a second agent runtime API.
- Pea and Peco remain separate products.
  - `pea` mode uses the deployed Revit/operator runtime.
  - `Peco` mode uses the repo coding-agent runtime.
  - Threads are not shared across modes and Peco is not a Pea persona.
- Tool calls must be fully reflected.
  - Why: beta users need educational/debug visibility into what Pea/Peco did, especially around Revit host operations, scripts, shell commands, and source-editing tools.
- Tool frames are telemetry and interrupt evidence, not direct browser authority over runtime policy.
  - Include lifecycle, tool name/id, args/input, streamed input, updates, shell stdout/stderr, final result, provider metadata, error status, and surfaced error payloads.
  - Runtime approval/suspension/plan requests may be exposed as protocol-native interrupts so clients can collect user input.
  - The local runtime still owns whether and how that input is applied. Do not let browser protocols execute tools, hold credentials, or mutate runtime permission policy directly.
- Raw args/results/output are intentionally exposed after JSON-safe serialization.
  - Why: this is a local debug and educational affordance for manually auditing tool and host-operation behavior.
  - Display truncation is a frontend rendering concern; the process-local event/log should preserve the full sanitized value.
- No durable cross-mode thread model.
  - Why: Pea and Peco are separate products; switching mode means switching runtime/session, not changing a property on one conversation.
- No model switching in beta protocol scope.
  - Why: beta tests target one selected model/config per runtime and should not carry model-picker complexity.

## Contract families

`PeaRuntimeEvent` is the stable intermediate contract:

- `run_started` / `run_finished`
- `assistant_message_started` / `assistant_message_delta` / `assistant_message_finished`
- `tool_started` / `tool_input_delta` / `tool_input_finished`
- `tool_updated` / `tool_shell_output` / `tool_finished`
- `plan_updated` / `plan_requested`
- `runtime_error`

`PeaRuntimeSessions` is the stable session command seam:

- `createThreadSession`
- `switchThread`
- `sendMessage`
- `abort`
- `subscribe`

`PeaRuntimeProtocolSessions` is the stable protocol session seam above runtime factories:

- Owns process-local protocol session ids, AG-UI external thread id mapping, runtime thread ids, runtime resource ids, cwd, additional directory metadata, prompt concurrency, cancellation, and active-session deletion/close.
- Uses `PeaRuntimeFactory` to choose `pea` vs `Peco` runtime creation without letting ACP or AG-UI adapters call `createPea(...)` / `createPeaDev(...)` directly.
- Supports session list/resume/load/fork/delete/close. ACP `additionalDirectories` is supported for session creation/listing and resume/load/fork scope updates. `close` frees active runtime resources while keeping the listed session metadata; `delete` removes it from the registry.

`PeaRuntimeSessionRegistry` is the durable protocol session metadata/history seam:

- Real ACP and AG-UI servers persist session metadata in a small JSON registry. ACP stores protocol-visible user prompt chunks and session updates for load replay. AG-UI stores emitted protocol-visible events so rehydrated external `threadId` sessions can restore prior frontend-visible history as runtime context. `PEA_RUNTIME_SESSION_REGISTRY_DIR` can override the registry directory; otherwise it uses the user-local Pe.Tools Pea protocol-session directory.
- Persisted ACP session ids and AG-UI external thread ids can be rehydrated into fresh active runtime threads under the same protocol session id after adapter reconstruction.
- ACP `session/load` replays stored user prompt chunks and ACP updates back to the client, then injects restored history into the first prompt on the fresh runtime thread.
- ACP `session/fork` creates a new Pea-owned protocol session and fresh runtime thread, copies protocol-visible history from the source session, and injects that copied history into the first prompt.
- AG-UI exposes local HTTP close/delete controls for external `threadId` sessions. Close frees active runtime resources while preserving listed metadata; delete removes the session record and persisted event replay history.
- This is protocol-visible history durability, not Harness-native model-memory restoration or branching.

`PeaRuntimeResource` is the stable protocol resource contract:

- ACP `resource_link`, ACP embedded resources, ACP image/audio blocks, and AG-UI multimodal user-message parts become protocol-neutral resource records before reaching the runtime command seam.
- Runtime sessions add the current resource scope (`cwd` plus `additionalDirectories`) and annotate file URI resources with normalized local path and in-scope status.
- AG-UI may supply Pea runtime resource scope as `forwardedProps.pea.cwd` and `forwardedProps.pea.additionalDirectories`. These are control fields for the session seam, not prompt context, and should be stripped before generic forwarded props are injected.
- Adapters should not hand-roll resource context strings; they should create resources and let `PeaRuntimeProtocolSessions` inject resource context for the active runtime thread.

`PeaRuntimeInterrupt` is the stable runtime interrupt outcome contract:

- Runtime events for tool approval, tool suspension, plan approval, and generic runtime suspension become Pea-owned interrupt records with stable reason ids before protocol projection.
- AG-UI projects these records into `RUN_FINISHED` outcomes with `type: "interrupt"` and `interrupts: [...]`.
- AG-UI `resume[]` entries become Pea-owned resume decisions and are carried by `PeaRuntimeProtocolSessions` at the runtime prompt boundary.
- Resume decisions are exposed as structured request context through `getPeaRuntimeResumeDecisions(requestContext)` and also injected as prompt-visible context for model awareness. Runtime tools should consume the helper rather than parsing context text.
- Durable suspended-turn continuation is future work until runtime tools consume resume decisions and prove restoration/continuation semantics.

`PeaLocalTransportAuth` is the local HTTP/SSE auth seam:

- Local browser-facing transports require bearer/query/header token auth.
- AG-UI and ACP HTTP surfaces share constant-time token validation and generate a token by default when one is not supplied.

`PeaRuntimeAuth` is the runtime credential auth seam:

- ACP `initialize` advertises auth methods derived from runtime options: API-key env-var auth for API-key mode, agent-managed Codex OAuth for OAuth mode, and both only when auto mode explicitly allows the OAuth beta path.
- ACP `authenticate` validates that the requested method id was advertised. It does not mutate credentials yet.
- ACP `logout` is advertised only when scoped stored credential revocation exists. Today this is limited to the `pea` runtime, where logout clears Pea-owned OpenAI/Codex credentials from the scoped Pe.Tools auth file and current process environment. Do not wire ACP logout to global Peco/MastraCode auth storage.
- AG-UI reports the same runtime auth metadata under `capabilities.custom`, including explicit `pea.logoutSupported`; local HTTP tokens remain transport auth only, and AG-UI exposes authenticated `POST /agui/logout` for runtimes with scoped revocation support.

`PeaRuntimeClient` is the runtime client-delegation seam:

- Protocol adapters map client capabilities into permission, filesystem, terminal, and terminal-auth booleans without leaking protocol SDK types above the adapter.
- ACP `InitializeRequest.clientCapabilities` feeds this contract, Pea runtime `pending_approval` tool starts trigger ACP `session/request_permission` through the client bridge, and ACP client `fs/*` / `terminal/*` methods are exposed as protocol-neutral Pea runtime client methods.
- ACP prompts carry the configured `PeaRuntimeClient` into Mastra request context under the Pea runtime context seam. Runtime tools should retrieve that client from the Pea-owned request context helper rather than importing ACP SDK types.
- ACP permission answers are recorded as pending Pea runtime resume decisions on the protocol session and consumed into the next runtime prompt through the same structured resume-decision request context used by AG-UI. Switching Mastra/Peco command execution to client-owned filesystem/terminal execution remains future work until the runtime command seam can consume those decisions deterministically.

The current Mastra implementation may still use Harness current-thread primitives internally. Protocol adapters must not.

## Serialization rule

"Fully reflected" means JSON-safe full fidelity, not raw object passthrough.

- `Date` -> ISO string
- `Error` -> `{ name, message, stack? }`
- `Map` -> keyed object
- `Set` -> array
- arrays/objects -> recursively sanitized
- circular references -> stable circular marker string
- functions/symbols/bigints/undefined -> safe scalar fallback

## Event mapping priorities

- `Mastra HarnessEvent` -> `PeaRuntimeEvent` happens only in `mastra-harness-runtime-events.ts`.
- `PeaRuntimeEvent` -> ACP happens only in `acp/pea-runtime-to-acp-events.ts`.
- `PeaRuntimeEvent` -> AG-UI happens only in `agui/pea-runtime-to-agui-events.ts`.
- AG-UI run-finished interrupt outcomes come from `pea-runtime-interrupts.ts`, not AG-UI-specific inspection of raw runtime implementation details.
- AG-UI emitted events should be recorded as protocol-visible history through `PeaRuntimeProtocolSessions.recordProtocolEvent`, not sidecar adapter storage.
- AG-UI emitted events carry per-thread sequence values. `GET /agui/events?threadId=<id>&afterSequence=<n>` is the transport replay seam behind `transport.resumable`; do not conflate it with suspended-turn continuation.
- Subagent inner tools are normalized into ordinary `tool_started` / `tool_finished` Pea runtime events with stable prefixed tool ids.
- Protocol adapters should preserve raw sanitized tool inputs/results while mapping lifecycle/status into their native protocol vocabulary.

## Main risk to remember

The browser needs rich visibility and a way to return user input, not runtime authority. If a frame asks the browser to execute tools, own credentials, or decide policy outside Pea's local runtime contract, it has escaped this beta scope.
