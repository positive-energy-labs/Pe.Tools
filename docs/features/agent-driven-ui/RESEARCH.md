# Agent-drivable UI primitives — research & recommendation

**Date:** 2026-07-06 · **Question:** what web primitives should the Pe web product build on so that *pea fills large amounts of structured data (schedules, family parameters) into a UI, and an engineer can audit each value back to its source and approve it before it hits the model* — Occam's razor first, but open to a library if it lays critical groundwork.

**Scope reviewed:** local clones (`mastra`, `assistant-ui`, `ag-ui`), CopilotKit (web docs + source), Vercel AI SDK `useObject`, and the extraction/provenance products (LlamaExtract, Reducto, Extend, Unstructured). Current stack: React 19 · TanStack Router/Start/Query/Form · `@assistant-ui/react` (ExternalStoreRuntime) · `@mastra/client-js` 1.28 · zod 4.

---

> **⚠ Superseded framing:** this report answered "stream structured output into an audit grid." The actual requirement is **tool-driven collaborative UI** — the agent mutates route state through tools/MCP on a semi-persistent artifact. See **[COLLABORATIVE-UI.md](COLLABORATIVE-UI.md)** for the corrected verdict (clientTools, working-memory state signals, MCP resource subscriptions, WebMCP, and the fair CopilotKit re-assessment). The sections below remain valid as reference on each library's mechanics, the provenance/extraction findings, and the approval model.

## TL;DR

**Do not adopt CopilotKit or re-adopt ag-ui. Build the grid flow on what you already have.** You have already re-implemented the load-bearing core of ag-ui/CopilotKit — an event-sourced single store (`WorkbenchState` + `WorkbenchEvent`), first-class tool calls, approvals, and a `WorkbenchProvenance` type (which literally already carries `protocol: "ag-ui"`). The "agent fills a grid" route is a **new per-route store fed by the same wire, projected to a grid, with writes gated on the approval mechanism you already ship** — not a new framework.

Three specific, cheap things worth *stealing* (not buying):

1. **`STATE_DELTA` as an RFC-6902 JSON-Patch event** — the one genuinely good idea in ag-ui's shared-state channel. Add one `WorkbenchEvent` variant so pea can stream partial fills into a per-route object. ~1 afternoon.
2. **A `renderAndWaitForResponse`-shaped approval gate per cell/batch** — you already have `WorkbenchApprovalRequest`; the CopilotKit pattern is just the UX contract (render → `respond(value)` → resume). Reuse your existing `ToolResume` + mastra suspend/resume.
3. **Field-level citations from the extraction layer** — LlamaExtract `cite_sources` / Reducto `generate_citations` / Extend `citationsEnabled` all return per-field `{page, bbox, confidence}` directly. This can *replace* the `estimate.ts` cell-reconstruction you hand-built over raw LlamaParse. **This is the highest-leverage buy in the whole stack, and it's on the extraction side, not the UI side.**

The single most important architectural fact: **your grid must not live inside assistant-ui.** `ExternalStoreRuntime` is message-list-shaped by contract. Chat stays inside assistant-ui (as it does today, a pure projection); the grid is its own TanStack-backed component next to it.

---

## What you already have (this reframes the whole question)

From `packages/agent-contracts/src/contracts.ts` and `apps/web/src/workbench/`:

- **`WorkbenchState`** — a single event-sourced store with slices for `transcript`, `tools`, `approvals`, `plans`, `memory`, `inspector`, `models`, `modes`, `access`. One source of truth.
- **`WorkbenchEvent`** — a discriminated-union event protocol (`tool_call_updated`, `approval_requested`, `approval_resolved`, `message_part_delta`, …). This *is* an ag-ui-class event stream, authored for your domain.
- **`WorkbenchProvenance`** — `{ source, protocol: "acp" | "ag-ui" | "workbench" | "local", sessionId, threadId, messageId, toolCallId, updateType, metadata }`, threaded through message parts and tool calls. Provenance is already a first-class citizen, and the `protocol` field shows you deliberately kept an ag-ui-shaped seam after deleting the web ag-ui runtime.
- **HITL is already wired**: `provider.tsx` defines `ToolResume = string | { action: "approved" | "rejected"; feedback?: string }` and drives it through the mastra agent-controller/session. Approvals render as gates on tool-call parts (`aui-adapter.ts`).
- **assistant-ui is already a pure projection**: `workbenchToThreadMessages(state)` maps `WorkbenchState → ThreadMessageLike[]`; ExternalStoreRuntime holds no copy. The dual-store trap is already solved.

So the honest framing is not "which agent-UI framework do we buy" — it's "we already own the framework; what's the smallest extension for grid-filling."

---

## Capability matrix

| Need | ag-ui | CopilotKit | assistant-ui | Vercel AI SDK | **What you have** |
|---|---|---|---|---|---|
| Single event-sourced store | STATE_SNAPSHOT/DELTA | via ag-ui | ExternalStore (msgs only) | — | **`WorkbenchState`/`WorkbenchEvent`** ✅ |
| Bidirectional shared state | STATE_DELTA (JSON-Patch) | `useAgent`/`useCoAgent` | ✗ (msgs only) | ✗ | slice + 1 new event (~afternoon) |
| Stream partial structured fill | STATE_DELTA | `useCoAgentStateRender` (LangGraph-shaped) | streamed parts | **`useObject` DeepPartial** | mastra `.stream` structured output |
| HITL approve/reject + resume | Interrupt/Resume | `renderAndWaitForResponse` | approval plumbing, **no UI** | ✗ | **`ToolResume` + mastra suspend/resume** ✅ |
| Interactive write-back widget | generative UI | tool `render` + `respond` | tool UI + `addResult` | ✗ | your own grid component |
| Data grid as a primitive | ✗ | ✗ | ✗ (message-shaped) | ✗ | your own (TanStack) |
| Field-level source bbox | ✗ | ✗ | ✗ | ✗ | **extraction layer** (see below) |

Takeaway: every framework's "value" concentrates in the store + shared-state + approval columns — exactly the columns where you already have a working implementation. None of them ship a data grid or provenance; those are yours to build regardless.

---

## Deep dives

### 1. Shared state — ag-ui's one good idea, worth stealing not buying

ag-ui (`sdks/typescript/packages/core/src/events.ts`) defines the event set: `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT`, `RUN_*`, `STEP_*`, `ACTIVITY_*`, `CUSTOM`.

- **`STATE_SNAPSHOT`** = full state replace; **`STATE_DELTA`** = `JsonPatchOperation[]`, **RFC 6902**, applied with `fast-json-patch` (`packages/client/src/apply/default.ts`). Write-back is `agent.setState(...)` → sent on the next `runAgent`.
- CopilotKit surfaces the same channel as **`useCoAgent`** (returns `{ state, setState }`) — in v2 a thin wrapper over **`useAgent`**. It works with mastra agents over `@ag-ui/mastra`.

**Verdict:** the mechanism is good but light. You don't need the RFC-6902 wire, subscriber pattern, or the AbstractAgent/HttpAgent client to get it. Add **one** `WorkbenchEvent` variant, e.g. `{ type: "fill_state_updated", route, patch }`, apply it to a per-route slice, and you have the same "agent streams partial fills, UI reacts, human edits, agent sees the edit" loop without a dependency. JSON-Patch itself (`fast-json-patch`, ~3kb) is worth vendoring if you want granular deltas; a whole-object replace is fine at grid sizes.

### 2. HITL / approvals — you already have the strongest version

- **mastra**: native, **storage-backed, restart-safe** HITL — this is the strongest version in the field and it's already your backend. Concrete client-js surface (`client-sdks/client-js`, core `agent/agent.ts`):
  - `agent.listSuspendedRuns({ threadId, resourceId, page, perPage })` → `{ runs, total }` — discover pending approvals even after a server restart / on another instance (queries the durable `workflows` store, not in-memory).
  - `agent.sendToolApproval({ threadId, resourceId, toolCallId, approved, resumeData?, declineContext? })` — approve/reject; falls back to `listSuspendedRuns` when the run isn't in the active map (post-restart safety).
  - `agent.approveToolCall({ runId, toolCallId })` / `agent.resumeStream(resumeData, { runId, toolCallId })` — resume and continue the agentic loop, returning a fresh stream.
  - Tools gate with `createTool({ inputSchema, outputSchema, suspendSchema, requireApproval, execute })`; workflows suspend with zod `suspendSchema`/`resumeSchema` and `bail()` for a clean rejection (success, no error).
  - Over the wire you get typed chunks: `tool-call-approval`, `tool-call-suspended`, `tool-result`, plus `object`/`object-result` (below). Your `provider.tsx` already drives `ToolResume` through this.
- **CopilotKit `renderAndWaitForResponse`** (and v2 `useHumanInTheLoop`): render a component, agent pauses, `respond(value)` resumes; `respond` is only defined in `status: "executing"`. Clean UX contract — but it's a contract you can implement in ~30 lines against your existing `WorkbenchApprovalRequest`/`approval_resolved` events. (Note: known bug #1455 — can stick in `inProgress`.)
- **assistant-ui**: has the *plumbing* (`ToolCallMessagePart.approval`, `respondToToolApproval`, the `humanTool()` compile-time marker) but **no approval UI** — you render it yourself. Its `AgUiThreadRuntimeCore` also exposes `getPendingInterrupts()`/`submitInterruptResponses()`.

**Verdict:** mastra suspend/resume + your approval slice already is the SOTA pattern. Steal CopilotKit's *UX shape* (render-and-wait per cell/batch), not its runtime.

### 3. Streaming a structured fill live

- **Vercel AI SDK `useObject`** (`experimental_useObject`): `object` is `DeepPartial<RESULT> | undefined`, filling field-by-field against a zod schema, paired with server `streamObject`. Canonical "watch a grid fill cell-by-cell" primitive, lightest option that exists. **Design fork worth knowing:** default `partialObjectStream` = true cell-by-cell but partials are **not** schema-validated mid-stream (renderer must tolerate `undefined` everywhere); `array` output / `elementStream` = **whole validated rows one at a time** (no flicker) but not mid-cell. You can't have both mid-cell granularity and validation — pick per surface.
- **mastra** gives the *same* stream natively: `agent.stream(messages, { structuredOutput: { schema } })` → `.processDataStream({ onChunk })` emits `{ type: 'object', object: Partial<OUTPUT> }` deltas then `{ type: 'object-result', object: OUTPUT }`. This is the unvalidated-partial variant. **No new dependency** — it's `@mastra/client-js`.
- **Provenance in the stream:** `useObject`/mastra structured output stream *one root object, values only* — no native slot for per-cell `{page, bbox, confidence}`. Occam's answer: **make each cell `{ value, page, bbox, confidence }` in the schema itself** rather than a scalar. The model streams provenance inline; costs some tokens, zero plumbing. (Out-of-band data parts + index correlation is the alternative — more wiring, skip unless tokens bite.)
- **CopilotKit `useCoAgentStateRender`** streams partial state into the *chat thread* (`status: "inProgress" | "complete"`), but the mid-node emission mechanism (`copilotkit_customize_config(emit_intermediate_state=…)`) is **LangGraph-Python-shaped** — a poor fit for a mastra backend, and it renders in-chat, not in a side grid. (Open bug #2931: inconsistent re-render.)

**Verdict:** use mastra's structured-output stream (AI-SDK `useObject` semantics) to fill the per-route slice. This is the Occam's-razor answer for the live-fill need and requires nothing new.

### 4. Generative UI / tool write-back widgets

- **assistant-ui** tool UIs (`ToolCallMessagePartComponent` with `addResult`/`approve`/`reject`; modern `defineToolkit({ render })`) are genuine interactive widgets that write back. Good for a confirm/pick widget *inside chat*. Not a grid.
- **CopilotKit** `render`/`useComponent`/`useFrontendTool` render components from tool calls with an `inProgress → executing → complete` lifecycle. Same story: in-chat widgets, not a grid primitive.
- Neither ships a data grid. **A schedule/parameter grid is your component regardless of framework choice.**

**Verdict:** grid lives outside the chat runtime, in TanStack. Optionally expose a "confirm batch" tool UI *inside* chat that reflects grid state — but the grid is the source of truth, not a message part.

### 5. Provenance / grounding — the real buy, and it's on the extraction side

Every serious extraction product returns **per-field citations with page + bounding box + confidence**, opt-in via a flag:

| Product | Flag | Citation shape | Coords | Confidence |
|---|---|---|---|---|
| **LlamaExtract** | `cite_sources: true` (+ `expand=["extract_metadata"]`) | `field_metadata.<f>.citation[]` | `{page, matching_text, bounding_boxes:[{x,y,w,h}], page_dimensions}` — **XYWH px** | `confidence_scores: true` |
| **Reducto** | `generate_citations` | top-level `citations` | `{left,top,width,height,page}` — **normalized 0–1, top-left** | categorical (e.g. `"high"`) |
| **Extend** | `citationsEnabled` | per-field `metadata` | `polygon` points + page (convert per file-type) | numeric 0–1, split `logprobsConfidence`+`ocrConfidence`; **grounds inferred/computed values** |
| Unstructured | (hi_res) | per-*element* coords | corner `points`, PixelSpace/Relative | — (block-level only, not field-level) |

**Verdict:** this is the highest-leverage adoption available, and it has nothing to do with the UI framework debate. Your `estimate.ts` reconstructs cell geometry from raw LlamaParse because LlamaParse grounds *blocks*, not *fields*. An extraction API that grounds each extracted value natively hands you the `{page, bbox, confidence}` your sweep/audit UI already consumes — collapsing the estimate/measured distinction into ground truth. Extend additionally grounds *computed* values (e.g. a derived due date), which matters for engineering values pea infers rather than copies. Recommend a spike: run the Enphase/ACME sheets through LlamaExtract `cite_sources` and Reducto `generate_citations` and compare field-bbox quality against the current estimator.

---

## Recommended architecture for "pea fills a grid, human audits"

```
Per-route store (TanStack + your reducer)         assistant-ui (chat, unchanged)
  fillState: { rows: Row[], patchLog }      ◄── same wire ──►  workbenchToThreadMessages()
      ▲  fill_state_updated (new WorkbenchEvent, JSON-Patch)
      │
  mastra agent.stream(structuredOutput)  ──► DeepPartial fills → apply patch → grid reacts
      │
  each filled cell carries Source{page,bbox,confidence,snippet}  ◄── extraction citations
      │
  approval gate (existing WorkbenchApprovalRequest + mastra suspend/resume)
      │  human: approve / edit / reject per cell or per batch  → ToolResume → resume
      ▼
  push-to-model (Revit write transaction) only for approved cells
```

- **State — a `proposals` layer, not a merge.** The agent never writes committed state. It writes a separate `proposals` map keyed by cell (`{ cellId → { value, source: "pea", status: "pending", provenance } }`), fed by a single new `fill_state_updated` event. The grid renders committed values with proposal ghosts/badges beside them. **Co-editing conflict is avoided, not resolved:** if a human edits a cell that has a pending proposal, mark the proposal `stale` — no timestamps race, no lost edits, no CRDT, no shared-state last-write-wins. This is a sibling slice under the same wire discipline that keeps assistant-ui a projection.
- **Fill:** mastra structured-output stream (`object` chunks) → apply to `proposals` → grid reacts. No new dep.
- **Provenance:** each cell's `Source{page, bbox, confidence, snippet}` comes from the extraction layer's field citations (buy this), folded into the cell schema so it streams inline. Render with the hover/sweep UX you've already prototyped in `src/lab/` — the rendering half is a plain absolutely-positioned div over the PDF page image; no highlight library needed.
- **Approval = accept-with-modified-value.** Reuse `WorkbenchApprovalRequest` + mastra `sendToolApproval`/`resumeStream`. Model the three decisions as one ordered `decisions[]` (borrowed from LangChain's HITL `interrupt_on`): **approve** → proposal commits via an ordinary TanStack Query optimistic mutation (`onMutate`/`cancelQueries`/rollback); **edit** → *approve with a modified value* (resume the run with the corrected `resumeData`, don't model edit as a side channel); **reject** → `bail()`/decline. Confidence-threshold auto-routing (Extend's pattern): auto-accept high-confidence cells, flag low-confidence for review. Gate the Revit push on committed (approved) cells only.
- **Chat:** unchanged. If you want an in-chat "confirm batch" affordance, expose it as an assistant-ui tool UI that reflects (not owns) grid state.

---

## When this recommendation flips (buy triggers)

Re-open the build-vs-buy question only if:

- You need to host **3+ heterogeneous agent backends** (LangGraph, CrewAI, custom) behind one UI → ag-ui's normalization earns its weight.
- You want CopilotKit's **managed cloud** (AG-UI Cockpit analytics, Shield, hosted chat history) — the OSS core is MIT/self-hostable; the lock-in is the cloud tier (~$1k/seat reported), not the library.
- You standardize the backend on **LangGraph** — then CopilotKit's `useCoAgentStateRender` + predictive-state-updates become first-class instead of LangGraph-shaped friction on a mastra backend.

None of these match the current single-mastra-backend, single-app reality.

---

## Sources (primary)

- ag-ui: `sdks/typescript/packages/core/src/events.ts`, `.../client/src/apply/default.ts`, `.../core/src/types.ts` (Interrupt/Resume); https://docs.ag-ui.com/concepts/state
- CopilotKit: https://docs.copilotkit.ai/ (headless, backend/ag-ui, generative-ui, human-in-the-loop); `@ag-ui/mastra` https://www.npmjs.com/package/@ag-ui/mastra; https://mastra.ai/docs/frameworks/agentic-uis/copilotkit; frontend-action.ts / use-coagent-state-render.ts on `main`; v1.62.2 (2026-07-02); $27M Series A (2026-05); prod-writeup https://ranjankumar.in/copilotkit-in-production-where-the-abstraction-holds-and-where-you-are-on-your-own; issues #3125, #2931, #1455.
- assistant-ui: `packages/core/src/runtimes/external-store/*`, `.../react/model-context/*` (tool UI, human-tool), `packages/react-ag-ui/src/useAgUiRuntime.ts`.
- Vercel AI SDK: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-object (`experimental_useObject`, `DeepPartial<RESULT>`).
- Provenance: LlamaExtract https://developers.llamaindex.ai/python/cloud/llamaextract/features/extensions/ ; Reducto https://docs.reducto.ai/v/legacy/extraction/citations ; Extend https://docs.extend.ai/product/extraction/citations-bounding-boxes ; Unstructured https://docs.unstructured.io/open-source/concepts/document-elements.
- Local stack: `packages/agent-contracts/src/contracts.ts`, `apps/web/src/workbench/{provider,aui-adapter,adapter}.tsx`.
