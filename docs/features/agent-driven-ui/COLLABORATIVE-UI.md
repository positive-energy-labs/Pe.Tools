# Collaborative UI — agent-writable route state through tools/MCP

**Date:** 2026-07-06 · **Supersedes the verdict in [RESEARCH.md](RESEARCH.md)** (which answered "streamed structured output into an audit grid" — the wrong framing).

**The corrected question:** the agent must be able to change a route's underlying state **through tools/MCP** — working on a **semi-persistent, schema'd artifact** that is **reactive in the UI**, editable by the human at the same time. Not generative UI (agent invents UI); **collaborative UI** (agent and human co-edit known-schema state through a shared surface). Write paths must include: pea in-app, external MCP agents (Claude, scripts), and eventually browser-native agents.

---

## TL;DR

The requirement decomposes into four layers — **artifact (persistence) · write paths (tools) · reactivity (fan-out) · approval** — and no single library covers all four. But the pieces all exist, mostly in dependencies you already ship:

1. **`clientTools` in `@mastra/client-js` is the headline finding**: `agent.stream(messages, { clientTools })` sends browser-defined tool schemas with the request; when the model calls one, **the client executes it in the browser mid-stream** (mutating your TanStack store directly = natively reactive), returns the result, and the agent continues. This is exactly "agent changes route state through a tool," already in your `1.28` dependency. (`client-js/src/resources/agent.ts:138-293`.)
2. **mastra working memory is the mastra-native semi-persistent artifact**: zod-schema'd, `scope: 'resource'` (default) persists across threads, agent writes via the built-in **`updateWorkingMemory` tool with deep-merge semantics** (partial updates; `null` tombstones; arrays replace), and with **`useStateSignals: true`** it emits **`data-signal` chunks (snapshot or unified-diff delta, SHA-256 deduped) into the stream** — reactive while a run is live. Gap: **no post-stream push, no multi-client fan-out** — that's the piece you build on your existing SSE wire.
3. **mastra MCP gives external agents the same door**: `MCPServer` (streamable HTTP, mounted on a route) exposing artifact tools, **resource subscriptions** (`notifyUpdated` → `notifications/resources/updated`) for reactive reads, **elicitation** (a tool pauses and asks the human mid-execution — an MCP-native approval primitive), and per-request `toolsets` on stream. Browser can't host MCP in mastra — the server hosts; tab fan-out is yours.
4. **WebMCP is the strategic browser-native door** (watch, don't bet yet): `document.modelContext.registerTool({ name, description, inputSchema, async execute })` — the page itself exposes tools; `execute` runs in-page so store mutation is reactive by construction. W3C draft (Feb 2026), Chrome 149 origin trial (June 2026), consumers today are Gemini-in-Chrome + inspector extension.
5. **CopilotKit, re-scored honestly for this framing**: yes — it is literally made for this loop (`useFrontendTool` browser handlers + `useAgent` bidirectional shared state + `registerCopilotKit` co-located in the mastra server + headless coexistence with assistant-ui). See the fair adoption assessment below. The reason it still doesn't win on this stack is **narrower** than the old report claimed: it covers only the in-app door. It does **not** cover persistence (its shared state is run/session-scoped — you still need working memory or an artifact table) and does **not** cover the MCP/external-agent door. Since those force you to build the artifact layer anyway — and the in-app door is ~already built (`clientTools` + your WorkbenchEvent wire) — CopilotKit's remaining contribution is UX packaging you'd re-wrap anyway.

**The unifying design (the critical groundwork): define each route's collaborative surface ONCE — a zod-schema'd "route toolset" — and project it through three doors.**

```ts
// One definition per route: the collaborative surface
const scheduleToolset = defineRouteToolset({
  artifact: scheduleArtifactSchema,          // zod — the semi-persistent state shape
  tools: {
    set_cell:      { input: z.object({ row: z.number(), col: z.string(), value: z.string(), source: SourceSchema.optional() }),
                     execute: (args, store) => store.stageProposal(args) },
    get_schedule:  { input: z.object({}),    execute: (_, store) => store.snapshot() },
    mark_verified: { input: z.object({ cellKey: z.string() }), execute: (args, store) => store.verify(args.cellKey) },
  },
});
// Door 1 (in-app pea):     toAgentClientTools(scheduleToolset, store)   → agent.stream({ clientTools })
// Door 2 (external MCP):   toMcpServerTools(scheduleToolset, artifactStore) + resources.notifyUpdated
// Door 3 (browser-native): toWebMcpTools(scheduleToolset, store)        → document.modelContext.registerTool
```

Same `{name, description, inputSchema, execute}` shape in all three targets — the projection functions are thin. This is the small, library-agnostic asset that lays the groundwork; every framework evaluated is one *door* to it, not the surface itself.

---

## The four layers, with exact mechanics

### Layer 1 — Artifact (semi-persistent, schema'd)

Two viable homes; pick per artifact scope:

| | mastra working memory | pe artifact store (yours) |
|---|---|---|
| Schema | zod via `workingMemory: { schema }` | zod, yours |
| Persistence | `scope: 'resource'` → across all threads for the user (default) | whatever you choose (doc/project/model-scoped) |
| Agent write | built-in `updateWorkingMemory` tool, **deep-merge** (partial updates, `null` deletes, arrays replace) | your `patch_artifact` tool (JSON-Patch) |
| In-stream reactivity | `useStateSignals: true` → `data-signal` chunks, snapshot **or unified-diff delta**, deduped by SHA-256 | you emit `WorkbenchEvent` patches |
| Post-stream push | **none** — poll `getWorkingMemory()` (HTTP) | your SSE wire → all tabs |
| Multi-user / shared artifact | no (resource = one user) | yes |

**Recommendation:** working memory for *per-user* collaborative state (preferences, in-progress worksheets — and you get the agent-side prompt injection for free, so the agent always "sees" the artifact). A first-class **artifact table + JSON-Patch log** on the pe server for *shared* artifacts (schedules bound to a Revit model) — which also gives you the audit trail the engineers need. Sources: `packages/core/src/memory/types.ts:175-224`, `packages/memory/src/tools/working-memory.ts:95-310` (`deepMergeWorkingMemory`), `packages/memory/src/processors/working-memory-state/processor.ts` (state signals).

### Layer 2 — Write paths (the tool doors)

- **In-app pea (exists today):** `clientTools` on `agent.stream()`. Execution flow (`client-js/src/resources/agent.ts:184-293`): server returns tool-calls → client matches `params.clientTools[toolName]` → `execute(args, ctx)` runs in the browser (ctx has agentId/threadId/resourceId/messages) → result posts back as a `tool-result` → stream continues recursively. The execute closure holds your route store → **mutation is synchronously reactive in the initiating tab**.
- **External MCP agents:** mount `MCPServer` (streamable HTTP: `server.startHTTP({...})` on a route — mastra does **not** auto-mount) exposing the projected route tools + the artifact as an MCP **resource**. Writers get `set_cell`; readers `subscribe` and receive `notifications/resources/updated` via `server.resources.notifyUpdated({uri})`. Approvals mid-tool via **elicitation**: `options.mcp.elicitation.sendRequest({ message, requestedSchema })` → your UI answers `{action: 'accept', content}` → tool resumes. (`packages/mcp/src/server/server.ts`, `resourceActions.ts`, `client/actions/elicitation.ts`.)
- **Browser-native (strategic, not yet):** WebMCP `document.modelContext.registerTool(...)` — same descriptor shape, in-page execute. Chrome 149 origin trial; spec discovery/invocation still partly TODO; today's consumers are Gemini-in-Chrome and the inspector extension. Project the same toolset when it matures — zero rework because of the shared shape.
- **TanStack AI note (June 2026):** `@tanstack/ai-mcp` turns any MCP server into `ServerTool[]` for its `chat()` — server-side only. Relevant if you ever adopt TanStack AI for chat; it consumes the same MCP door.

### Layer 3 — Reactivity (fan-out)

- Initiating tab: free — `clientTools` mutate the store directly; or apply `data-signal` working-memory deltas from the stream.
- All other tabs/clients: the artifact store broadcasts each accepted patch as a `WorkbenchEvent` (`fill_state_updated`, JSON-Patch) over the **existing SSE wire** — the same discipline that keeps assistant-ui a projection. MCP subscribers get `notifyUpdated` in parallel.
- This fan-out layer is the one genuinely missing piece in every option evaluated (mastra has no post-stream push; CopilotKit's state channel is run-scoped; MCP notifies MCP clients only). It's ~a day on your wire, and it's the same event the old report already recommended.

### Layer 4 — Approval (unchanged from RESEARCH.md, now with an MCP door)

Proposals-not-merges still applies: agent tools **stage proposals**, never commit; human approve/edit/reject commits via ordinary optimistic mutation; mastra suspend/resume (`requireApproval`, `listSuspendedRuns`, `sendToolApproval`) gates server-side tools; **MCP elicitation** covers external agents. Push-to-Revit gates on committed cells.

---

## CopilotKit — the fair adoption assessment (since it *is* made for this)

What adopting it on this stack concretely looks like: `@ag-ui/mastra`'s `registerCopilotKit()` mounts CopilotRuntime inside your mastra server; frontend wraps in `<CopilotKit runtimeUrl agent>`; you'd use **headless** (`useAgent`, `useCopilotChatHeadless_c`) and keep assistant-ui rendering chat; route tools become `useFrontendTool` registrations; shared route state becomes `useAgent().state/setState` (STATE_SNAPSHOT/DELTA, RFC-6902).

- **What it genuinely buys:** the in-app loop, packaged and maintained — tool registry + browser execution + bidirectional run-scoped state + HITL render/respond UX, with docs and momentum ($27M, v1.62.x weekly).
- **What it doesn't:** persistence (state lives per run/session — the artifact layer is still yours or working memory's), the external-MCP door (Claude/scripts don't enter through CopilotKit), WebMCP, and multi-tab fan-out beyond its own provider. Plus the known rough edges (#3125 state-sync, #2932 duplicate tool executions post-v2-migration, single runtime context/no tenant isolation) and a second state channel running parallel to WorkbenchState.
- **Net:** if the route-toolset + artifact + fan-out layers get built (they must, for the MCP door alone), CopilotKit's remaining surface is duplicative on this stack. If instead you want the in-app loop **now** with minimal custom code and accept the parallel channel, it works today with mastra — the integration is real (`@ag-ui/mastra` 1.0.3). Recommendation stands: build the three-door surface; revisit CopilotKit only if the in-app door's maintenance becomes a burden.

---

## Suggested spike (1–2 days, proves all four layers)

1. `defineRouteToolset` + the `toAgentClientTools` projection (~100 lines).
2. A lab route where pea fills the FCU schedule **via `set_cell` tool calls** (clientTools) instead of streamed structured output — cells stage as proposals, reactive live.
3. `useStateSignals: true` working memory holding the schedule as a resource-scoped artifact; apply `data-signal` deltas.
4. Mount `MCPServer` with the same toolset; drive `set_cell` from Claude Code (external MCP client) and watch the tab update through the SSE fan-out; wire one elicitation approval.
