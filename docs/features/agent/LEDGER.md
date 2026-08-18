# agent ledger

Posture and rationale live in [PHILOSOPHY.md](PHILOSOPHY.md) (authority doc). This ledger is the decision record.

## Decided

- 2026-07 — Revit agent context is a progressive ladder, not one context dump: `Context` (orient) → `Catalog` (inventory) → `Resolve` (fuzzy phrase → stable handle) → `Matrix` (joins/coverage) → `Detail` (known handle) → `Apply` (after proof). Missing layers get added as small bounded projections. All 39 `revit.*` public ops in `host-ops.generated.ts` follow it.
- 2026-07 — Host-operation metadata IS Pea's capability map. Pea discovers/ranks/zooms through generated metadata (`host_operation_search` + generic execution) instead of one tool per Revit task or broad prompt lore. Adding tools to solve discoverability recreates the context-size problem in code form.
- 2026-07 — The hand-maintained C# client ladder (`PeHostClient.Revit.Context/Catalog/Matrix/Detail/Resolve`) stays small and blessed for script/repo callers; `ExecuteAsync<TReq,TResp>` is the escape hatch. It is NOT replaced by generic schema compression, and no generated TS wrapper universe is built for it.
- 2026-07 — Default responses stay cheap: counts, top candidates, labels, stable ids/uniqueids, provenance (active document / active view / selection / explicit lookup / derived), truncation diagnostics, and next-query hints. Full element tables / parameter bags / schedule rows only on explicit export-or-audit intent.
- 2026-07 — `revit.catalog.project-browser` is human navigation and provenance vocabulary, NOT BIM truth. Model facts come from semantic catalog/matrix/detail ops. (Browser paths are the classic thing an agent mistakes for authority.)
- 2026-07 — Panel schedules stay their own electrical domain (`PanelScheduleView`, `revit.detail.electrical-panel-schedules`); they are never normalized into generic schedule discovery. Revit API semantics differ enough that merging would make the agent world less trustworthy.
- 2026-07 — Schedule facts split into three projections, never one object: definition/catalog facts, rendered row/cell detail, and coverage-matrix joins.
- 2026-07 — Parameter identity is a first-class join key; name-only joins are allowed only as explicit `NameFallback` evidence. Evidence/bindings ops run before coverage when identity is uncertain.
- 2026-07 — Pea/Peco web surfaces stay thin projections over Mastra-backed thread data. No Pe-owned history tables, migrations, or shadow ledgers for UI state; direct SQLite reads only as a read-only latency fast path.
- 2026-07 — TOON (or any compressed rendering) is a prompt renderer, never a transport or a public host-operation response format. Source of truth stays typed JSON DTOs + generated metadata. The `Toon` C# project landed as an available renderer/scripting library, not a contract.
- 2026-07 — Pea's public identity is "a self-managing autonomous code executor for Revit work", not a chatbot with Revit tools; Pods are source-first shareable scripting workspaces (`pod.json` declares id + entrypoints, all `src/**/*.cs` must compile, generated/runtime/IDE/DLL payloads excluded from archives). Landed verbatim in `packages/runtime/src/pea-instructions.ts`.
- 2026-07 — Build the operating loop and the available world into the harness and fat skills; keep the harness and the injected context minimal. Prefer generating doc-like artifacts on demand over standing prompt text.

## Tried & rejected

- 2026-07 — One broad "context dump" operation for Revit orientation: expensive, stale-prone, and it removes the agent's ability to choose a zoom path. Replaced by the bounded-projection ladder.
- 2026-07 — Exposing raw Revit API object graphs / all-model dumps to Pea: `FilteredElementCollector` rewards native filters before extraction, and a dump path is both slow and architecturally wrong.
- 2026-07 — A generated TypeScript wrapper per Revit host operation: recreates the context-size problem in code. Metadata-driven discovery + generic execution won.
- 2026-07 — A shared `CompressedProjection` package/contract up front: premature until two or more consumers need the same projection model. Render from existing metadata/DTOs at the consumer edge first.

## Owed

- Compressed agent-facing capability/document maps are still unbuilt — the `Toon` library landed but nothing generates a compressed host-capability or Revit-document map. Specs: [plans/agent-schema-compression.plan.md](plans/agent-schema-compression.plan.md) (renderer + host-capability map), [plans/revit-document-progressive-discovery.plan.md](plans/revit-document-progressive-discovery.plan.md) (project/schedule/parameter/electrical map shapes). Verification bar in both: a compressed map must lead Pea to the same next operation a developer would pick from the C# client docs, and must not hide truncation/absence.
- Request-shape normalization is unfinished: some schedule/query requests still wrap separate query objects while newer RevitData contracts use the `Filter / Scope / References / Projection / Budget / Options` envelope. Do not block compression on it; use the map to surface the inconsistencies.
- Open ladder questions: is active-view context a standalone operation or folded into document-session context; what is the smallest useful visible-context summary for a graphical view without becoming a model scrape; how much project-browser structure is exposed directly vs as search/navigation projections; which UI-session facts can be mirrored in a DA-friendly document-owned shape vs staying desktop-bridge-only.
- User-facing Pea copy (startup page, help/onboarding: what Pea is and is not, good tasks, prompting guidance, "inspect · plan · apply · verify" safety rule) is drafted but unshipped — no surface carries it. Draft deleted 2026-08-17; recover from git history (`docs/features/agent/pea-core-knowledge-draft.md`).
- Skill-trigger reliability: our ports of Matt Pocock's skills trigger less reliably than his originals (`grill-me`, `design-an-interface`) — diagnose the description/frontmatter difference. (verify — user-reported, unmeasured.)
- Wishlist with wide reach, unbuilt: a skill teaching Pea the public FamilyFoundry service + how to read BIM-manager requests so it runs migrations itself; auto-generated UI over JSON with live updates for dependent-provider properties.
