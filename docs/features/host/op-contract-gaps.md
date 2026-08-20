# Op-contract gaps

Adopt-when-touched. Harvested while building curated readonly views for every host op, live-verified
against a 2025 session with the MEP template. The forcing function: a UI can only render what the
contract returns. Every gap below is a place where a view had to guess, join across ops, or quote
the request instead of the response. Landed gaps have been stripped — what remains is open.
Envelope law and glance tier: [ADR 0003](../../adr/0003-read-envelope-and-glance-tier.md).

Format: **op → what the UI needed → what the contract returns → suggested change.**

## Universal

- **Catalog entries → domain grouping → key-prefix heuristic** — the sidebar groups by parsing key
  prefixes (`revit.catalog.*` etc.). Suggest a `domain` (or `group`) field on
  `HostOperationCatalogEntry` so grouping is contract, not convention.
- **Truncation speaks three dialects across ops** — `page{totalCount, returnedCount, isTruncated}`,
  bare `summary.truncated` with no counts, and `issues[]` warning codes. Converge on one page
  envelope.

## Context / testimony ops

- **revit.context.visible-summary → echo of applied budgets → silence** — the response doesn't say
  what budget/truncation was applied; the UI quotes the *request* budget as provenance, which is
  testimony about the question, not the answer. Return `appliedBudget` + `truncated: bool`.
- **revit.resolve.references → confidence semantics → bare int score** — score has no documented
  scale or threshold; the UI infers "ambiguous" from `candidateCount > 1` and normalizes against the
  in-set max. Return a `confidence` enum (resolved/ambiguous/weak) or a documented scale. The coarse
  ints also can't drive a ranking (six of eight candidates tied at 4) — finer scores or a rank field.
- **revit.context.view-rendering-state** — the good example: it returns `confidenceWarnings` and
  `apiLimitations` verbatim, which rendered directly into the most honest card in the route. Other
  ops should copy this pattern.

## Catalog ops

- **revit.catalog.recent-documents → recency → rank only** — no last-opened timestamp, and only
  registry-sourced entries. Return `lastOpenedUtc` when the registry has it.
- **revit.catalog.schedules vs project-index → consistent field counts → projection-dependent
  `fieldCount`** — the two ops disagree depending on projection. Make `fieldCount` mean the same
  thing everywhere or name them differently. Same class: "schedules" is three different numbers
  (browser 134 vs project-index 42) with the difference unnamed.
- **revit.catalog.project-browser → mergeable folder tree → flat `pathLabel` on folder summaries** —
  items carry `browserPath` segments but folder summaries carry a single joined label, so the UI
  can't merge them into one tree reliably. Return segments on both.
- **revit.catalog.load-classifications → demand factor values → `valuesCount` only** — the count is
  returned but not the values. Return the values (bounded).
- **revit.catalog.loaded-families → composition projection → none** — no groupBy, so a category
  count costs all 560 rows (~118 KB) client-side.
- **Document discipline → nothing carries it** — the model hero infers M/E/P from sheet-number
  series and must label it "inferred".

## Detail / matrix ops

- **revit.detail.electrical-panel-schedules → cell semantics → positional strings** — cells lack
  `columnRole`/`slot`/`side`/`phase`; the two-column panelboard reconstruction is a regex heuristic
  and correctness depends on template formatting. The circuits catalog *does* carry `slotIndex`,
  `poles`, `voltage`, `rating` — the UI cross-op joins to recover meaning the schedule op dropped.
  Type the cells.
- **revit.detail.schedules → stable cell identity + display formatting → positional `string[]`
  rows** — no column ids, no numeric/unit typing; the UI sniffs numeric-ness to right-align. Return
  per-column `{ id, kind, unit? }`.
- **revit.detail.sheets → paper extents → viewport rects only** — no sheet outline/paper size or
  unit declaration, so the SVG canvas infers extents from viewport bounds (a sheet with one viewport
  renders as tight crop, not a titleblock). Return `sheetOutline` + units. Also needed: a cheap
  `Thumbnail`-weight projection (titleblock + viewport bounds only) so all 42 sheets are affordable,
  and a first-class sheet series/discipline field (the UI parses the sheet-number prefix today).
- **revit.matrix.loaded-families → params for unplaced families → empty +
  `FamilyFormulaCollectionFailed`** — without `includeTempPlacement` the matrix renders types with no
  parameter columns and a failure issue. Either default temp placement for bounded requests or
  return a structured "requires placement" flag the UI can render as guidance instead of an error.
  Also: category filter is required (409 otherwise) but the catalog metadata doesn't say so — the
  requirement belongs in the request schema.

## Host / session ops

- **host.status → disconnect reason → hard-coded `null`** (`apps/host/src/local-ops.ts`). Populate
  or delete the field.
- **bridge.sessions.list → lane as enum + per-session freshness → free-string lane** — the UI colors
  lanes from a hand-kept map; an unexpected string falls to "unknown". Make lane an enum in the
  contract.
- **host.topology → per-session documents + the host's own address → neither** — the /ops view still
  stages 1 + N `revit.context.document-session` calls, and neither `host.status` nor `host.topology`
  returns the host's own port/baseUrl.
- **settings.tree → absolute base path → relative-only tree** — the UI can't render "where on disk
  is this" without the base. Return it.
- **aps.auth.status** — good: tokens elided server-side; keep it that way.
