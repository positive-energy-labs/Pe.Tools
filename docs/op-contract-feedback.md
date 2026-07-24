# Op-contract feedback from the /ops UI build

> **Status 2026-07-24** — [ADR 0003](adr/0003-read-envelope-and-glance-tier.md) adopted the
> envelope law and glance tier. Landed: `revit.glance.model` (first-class, DefaultVisible,
> observedAtUtc), project-index summary `projectTotals`, nullable request limits (no more
> clamp-to-minimum / self-flagging warnings), and default-visible-only browse in
> `host_operation_search`. Everything else below remains open.

Harvested while building curated readonly views for every host op (branch
`worktree-ops-ui`, live-verified against a 2025 sandbox with the MEP template).
The forcing function: a UI can only render what the contract returns. Every gap
below is a place where a view had to guess, join across ops, or quote the
request instead of the response.

Format: **op → what the UI needed → what the contract returns → suggested change.**

## Universal

- **Every op → "as of when?" → nothing** — no op returns an observation
  timestamp. The UI stamps client receive time, which is honest about the wire
  but not about Revit (the bridge may have snapshotted earlier). Suggest a
  standard envelope field (`observedAtUtc`, set at the Revit side) on every
  read op. This is the single highest-leverage change; freshness-aware
  provenance is a stated product law and currently unimplementable.
- **Catalog entries → domain grouping → key-prefix heuristic** — the sidebar
  groups by parsing key prefixes (`revit.catalog.*` etc.). Suggest a `domain`
  (or `group`) field on `HostOperationCatalogEntry` so grouping is contract,
  not convention.

## Context / testimony ops

- **revit.context.visible-summary → echo of applied budgets → silence** — the
  response doesn't say what budget/truncation was applied; the UI quotes the
  *request* budget as provenance, which is testimony about the question, not
  the answer. Return `appliedBudget` + `truncated: bool` (it already returns
  truncation warnings sometimes; make it structural).
- **revit.resolve.references → confidence semantics → bare int score** — score
  has no documented scale or threshold; the UI infers "ambiguous" from
  `candidateCount > 1` and normalizes scores against the in-set max. Return a
  `confidence` enum (resolved/ambiguous/weak) or a documented score scale.
- **revit.context.view-rendering-state** — the good example: it returns
  `confidenceWarnings` and `apiLimitations` verbatim, which rendered directly
  into the most honest card in the route. Other ops should copy this pattern.

## Catalog ops

- **revit.catalog.recent-documents → recency → rank only** — no last-opened
  timestamp, and only registry-sourced entries. A Home-screen-style card grid
  wants "2 days ago". Return `lastOpenedUtc` when the registry has it.
- **revit.catalog.schedules vs project-index → consistent field counts →
  projection-dependent `fieldCount`** — the two ops disagree depending on
  projection. Make `fieldCount` mean the same thing everywhere or name them
  differently.
- **revit.catalog.project-browser → mergeable folder tree → flat `pathLabel`
  on folder summaries** — items carry `browserPath` segments but folder
  summaries carry a single joined label, so the UI can't merge them into one
  tree reliably. Return segments on both.
- **revit.catalog.load-classifications → demand factor values → `valuesCount`
  only** — the count is returned but not the values; the UI can say "3 values"
  but not show them. Return the values (bounded).

## Detail / matrix ops

- **revit.detail.electrical-panel-schedules → cell semantics → positional
  strings** — cells lack `columnRole`/`slot`/`side`/`phase`; the two-column
  panelboard reconstruction is a regex heuristic, and correctness depends on
  template formatting. The circuits catalog *does* carry `slotIndex`, `poles`,
  `voltage`, `rating` — the UI cross-op joins to recover meaning the schedule
  op dropped. Type the cells.
- **revit.detail.schedules → stable cell identity + display formatting →
  positional `string[]` rows** — no column ids, no numeric/unit typing; the UI
  sniffs numeric-ness to right-align. Return per-column `{ id, kind, unit? }`.
- **revit.detail.sheets → paper extents → viewport rects only** — no sheet
  outline/paper size or unit declaration, so the SVG canvas infers extents
  from viewport bounds (a sheet with one viewport renders as tight crop, not
  a titleblock). Return `sheetOutline` + units.
- **revit.matrix.loaded-families → params for unplaced families → empty +
  `FamilyFormulaCollectionFailed`** — without `includeTempPlacement` the
  matrix renders types with no parameter columns and a failure issue. Either
  default temp placement for bounded requests or return a structured
  "requires placement" flag the UI can render as guidance instead of an error.
  Also: category filter is required (409 otherwise) but the catalog metadata
  doesn't say so — the requirement should be in the request schema.

## Host / session ops

- **host.status → disconnect reason → hard-coded `null`**
  (`apps/host/src/local-ops.ts:73`). Populate or delete the field.
- **bridge.sessions.list → lane as enum + per-session freshness → free-string
  lane, no `observedAt`** — the UI colors lanes from a hand-kept map; an
  unexpected string falls to "unknown". Make lane an enum in the contract and
  add per-session heartbeat/observedAt.
- **settings.tree → absolute base path → relative-only tree** — the UI can't
  render "where on disk is this" without the base. Return it.
- **aps.auth.status** — good: tokens elided server-side; keep it that way.

## From the synthetic (glance.*) layer

The `glance.*` synthetic ops in `apps/web/src/ops/glance/` are prototypes of
contracts that don't exist yet — each fans out 2–4 real ops client-side and
composes one surface. Every one of them is an argument for a first-class op:

- **glance.model → one bounded "what is this model" packet → 4 calls, 3
  truncation dialects** — doc identity + true totals + family composition +
  binding health wants a first-class `revit.glance.model`. Specific gaps found
  while composing it:
  - `revit.catalog.project-index` `summary` counts reflect the *truncated
    page* (viewCount 65 on a default call) while `context.summary.browser`
    says 373 for the same document — summary should carry true project totals
    independent of page budget.
  - `revit.catalog.loaded-families` has no groupBy/composition projection, so
    a category count costs all 560 rows (~118 KB) client-side.
  - Truncation speaks three dialects across ops: `page{totalCount,
    returnedCount, isTruncated}`, bare `summary.truncated` with no counts,
    and `issues[]` warning codes. Converge on one page envelope.
  - "Schedules" is three different numbers (browser 134 vs project-index 42)
    with the difference unnamed — contracts should say what each counts.
  - Nothing anywhere carries document discipline; the hero infers M/E/P from
    sheet-number series and must label it "inferred".
- **glance.attention → trustworthy "what's on screen" → defaults that
  self-sabotage** — `revit.context.visible-summary` with omitted limits clamps
  to the *minimum* ("MaxCategories must be between 1 and 50; using 1"),
  silently under-reporting the view; and `view-rendering-state` emits an
  `AgentContextRequestLimitAdjusted` warning even when the caller supplied no
  request at all. Defaults should be generous and never self-flag.
- **glance.drawing-set → the wall of sheets → no sheet-list op, no thumbnail
  weight** — there is no `revit.catalog.sheets`; the list rides along in
  project-index with handles the glance doesn't need. And thumbnails need
  `revit.detail.sheets` anchor geometry per batch — a cheap `Thumbnail`
  projection (titleblock + viewport bounds only) would make all 42 affordable.
  Sheet entries also lack a first-class series/discipline field (UI parses
  the sheet-number prefix, an untrusted heuristic).
- **glance.session-topology → the operator's map → 2 + N calls** — wants
  `host.topology` (host identity + sessions + per-session documents in one
  snapshot). Found along the way: `host.status` doesn't return the host's own
  port/baseUrl; `bridge.sessions.list` omits the per-session
  `activeDocumentObservedAtUnixMs` that `target.ts` already expects; and the
  resolve lineup's coarse int scores (six of eight candidates tied at 4) can't
  drive a discriminating ranking — finer scores or an explicit rank field.
