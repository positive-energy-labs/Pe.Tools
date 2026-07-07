# Family Sheet — collaborative family-parameter mirror (MVP plan)

**Date:** 2026-07-06 (rev 2 — rearchitected on AgentController session state) · **Route:** `/family-sheet` · **Research base:** [COLLABORATIVE-UI.md](../agent-driven-ui/COLLABORATIVE-UI.md), doc-lab POCs (`/lab-sweep-real`, estimate.ts)

**What it is:** an editable mirror of the family document open in Revit's family editor — parameters × types, formulas and all, a functional clone of Revit's Family Types dialog — with three killer features: spec-sheet OCR, pea co-editing the page state through tools, and per-cell review (`good` / `needs attention`) gating a single batched push back to Revit.

---

## The primitive: AgentController session state (native, installed, unused)

Rev 1 of this plan proposed a bespoke worksheet store on the pea server. Dead — the general-purpose primitive already ships in the exact versions we run. The controller pea runs on (`@mastra/core@1.48.0-alpha.4` `AgentController<TState>`) has a **schema'd, server-synced session state** that nobody is using for route state yet:

| Capability | Mechanism (verified in installed dists) |
|---|---|
| Server-held state | `SessionState` — top-level-merge map, writes serialized through an update queue (mutex) |
| Schema + defaults | `stateSchema` (zod) on `AgentControllerConfig`; every write validated; defaults extracted |
| **Tool write path** | tools get `requestContext.get('controller')` → `getState` / `setState` / **`updateState(updater)`** (atomic read-modify-write) + `emitEvent` |
| **Client write path** | `AgentControllerSession.setState(updates)` in `@mastra/client-js@1.28.0` (top-level merge), `state()` for hydration |
| **Fan-out** | every write emits `state_changed { state, changedKeys }` on the session bus → **all SSE subscribers, all tabs** — the same wire the workbench already consumes |
| Scope | one session per resource → all tabs share it; in-memory (semi-persistent: survives reloads, dies with the server — snapshot is one re-read away) |

Pea's `initialState` already carries harness keys (`currentModelId`, `projectPath`, `yolo`) with no `stateSchema` set — a namespaced route key coexists trivially.

**Note on working memory** (the suspected primitive): its synced piece (`useStateSignals` → `data-signal` chunks) only streams *during a live run* to the *initiating stream* — no post-stream push, no tab fan-out — and working memory is prompt-injected every turn (artifact bloat) and schema-locked to the one memory profile. Session state has none of those problems. WM keeps its real job: pea's durable cross-thread knowledge.

## The generic layer: `defineRouteState` — zero per-route server code

Built once, in shared contracts (packages/agent-contracts or sibling):

```ts
const familySheet = defineRouteState({
  key: "route:family-sheet",          // one top-level session-state key per route
  schema: WorksheetSchema,            // zod, loose/nullish per house style
  agentWrites: AgentPatchSchema,      // what pea's tools may touch (proposals, review marks) — enforced in the tool helper, not by prayer
});
```

What the generic machinery provides (my lane, once, ~small):
1. **Web:** `state_changed` added to `wireEventSchema` + adapter → new `WorkbenchState.sessionState` substate → `useRouteState(familySheet)` hook: typed live slice, hydrate via `session.state()`, optimistic `setState` merge for human edits.
2. **Pea server:** a tool helper that wraps `controllerContext.updateState` with the route's `agentWrites` mask — semantic tools become 3-line definitions over it.
3. That's it. No REST endpoints, no store, no patch log service. Future routes bring `{key, schema, agentWrites}` + UI + tool definitions only.

Known honesty items, accepted for MVP:
- `state_changed` rebroadcasts the **full state** → keep it lean: the parsed doc (md + bboxes, MBs) stays OUT of session state; the worksheet holds a `docRef` (parse id/URL) and the route + `spec_doc_read` tool fetch from the existing parse cache.
- Client `setState` is whole-key last-write-wins (tools get atomic `updateState`; the client doesn't). Single user + serialized queue → acceptable race. `ponytail: whole-key merge for human edits; if two tabs co-editing ever matters, add one generic patch route on the pea web server that calls session.state.update.`
- In-memory only. `ponytail: worksheet dies with the server; rebuild = re-read family + re-run proposals. Persist to thread settings when that hurts.`

## Worksheet state model (inside the `route:family-sheet` key)

Same trust trichotomy the pdf-audit store proved — *proposal → staged → pushed*, review orthogonal:

```ts
Worksheet = {
  familyId: string, familyName: string,
  snapshot: FamilySnapshot | null,     // baseline from Revit (types[], parameters w/ formulas, groups, storageType, readOnly, per-type values)
  docRef: { parseId: string, fileName: string } | null,
  cells: Record<CellKey, CellState>,   // CellKey = `${param}::${type}`; formulas = `${param}::@formula`
}
CellState = {
  proposal?: { value: string, by: "pea" | "human", source?: SourceRef, note?: string, confidence?: "high" | "low" },
  staged?: string,
  review: "none" | "good" | "attention",
}
SourceRef = { blockId: string, rowIdx?: number, colIdx?: number }   // md coordinates, never bboxes
```

**Non-negotiables:** pea only proposes and marks — never stages (enforced by `agentWrites` mask in the tool helper). Human promotes via accept/edit. Any staged cell with `review: "attention"` blocks push. Provenance lives on the proposal and survives promotion. Formulas are first-class cells with the same lifecycle.

## Pea's tools (semantic, thin, over the generic accessor)

- `worksheet_get` — compact snapshot + cells + review counts (pea's eyes)
- `worksheet_propose` — **batch** `[{param, type, value, source?, note?, confidence?}]` (pea's hands)
- `worksheet_mark` — `{cellKey, review, note}` (pea flags its own low-confidence cells)
- `spec_doc_read` — parsed md blocks + ids from the parse cache (± page filter)
- `spec_doc_parse` — `{url|file}` → LlamaParse (~100s agentic) → sets `docRef`
- `family_refresh` — host RPC `family.editor.snapshot` → updates `snapshot`

Registered alongside `peaProductTools`; an instruction block teaches the workflow (read spec → propose with sources → mark confidence → wait for the human). The OCR division of labor stands: pea sees markdown and proposes with md coordinates; the UI resolves geometry through `estimate.ts:buildTargets` (measured solid / estimated dashed, camera frames the row) — straight port from `/lab-sweep-real`.

## Revit fidelity — promote the inline scripts to real ops

The [family-doc.ts](../../source/pe-tools/apps/web/src/host/family-doc.ts) inline scripts become two registered bridge ops (the file's own TODO):

- **`family.editor.snapshot`** (ReadOnly) — richer than today's script: parameter **group**, **dataType/spec**, `isDeterminedByFormula`, GUID for shared params, unit-faithful `AsValueString` values. Reuse `FamilyParameterSnapshot` contract shapes from the matrix op where they fit.
- **`family.editor.apply`** (WriteTransaction) — batch of `{param, type?, value?} | {param, formula?}`; one transaction, per-edit try/catch, **per-edit results** (`ok | error`). Values: `SetValueString` first (respects units), typed `Set` fallback. Formulas: `FamilyManager.SetFormula`.
- Traps encoded in the op: formula-driven cells read-only; instance-param "values" are per-type defaults; `not-family-document` as typed error.
- After registration: refresh checked-in typegen (`host-ops.generated.ts`) + pass the `--check` gate.
- Skipped: family change events (refetch after push), DocumentKind op filtering, type create/rename/delete.

---

## Execution plan — three lanes

**Phase 0 — contracts keystone (me, Fable, first):** `defineRouteState` shape, Worksheet + AgentPatch zod schemas, tool signatures, `family.editor.*` request/response contracts, mock worksheet for the UI lane.

**Phase 1 — parallel lanes:**

| Lane | Who | Work |
|---|---|---|
| **C# bridge ops** | **codex `gpt-5.5`** (`codex exec`, long slog + compile smashing) | `family.editor.snapshot` + `family.editor.apply` contracts/handlers, registered in `RevitBridgeOps`; build to green across target years; typegen refresh + `--check`. |
| **Route UI** | **Opus 4.8 high** (Agent tool, quick-and-dirty UI) | `/family-sheet` against the mock: Family-Types-dialog grid (group headers, per-type columns, formula column), proposal styling (pea-tint dashed → staged solid), review chips, doc pane with grounding camera (port from sweep-real), header actions (Read family / Parse spec / Push N). |
| **Generic primitive + tools** | **me (Fable)** | `state_changed` through wire/adapter → `sessionState` substate → `useRouteState` hook; tool helper with `agentWrites` enforcement; the six tools + pea instructions; doc parse-cache handoff. |

**Phase 2 — integration + live proof (me):** swap mock for the live slice; end-to-end against a real family in Revit + a real submittal PDF: pea parses, proposes with provenance, human reviews on hover, push lands in Revit, snapshot refetch confirms.

**Deliberately not in the MVP:** MCP server door (same tool shapes project later), WebMCP, working-memory artifacts, state persistence, multi-worksheet binding, family change events, CopilotKit.
