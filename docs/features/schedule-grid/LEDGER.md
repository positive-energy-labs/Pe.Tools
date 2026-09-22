# schedule-grid ledger

## Decided
- 2026-08-17 — electrical panel-schedule lore consolidated to `GROUNDING-REVIT-ELECTRICAL.md` (from 5 `docs/context/rvt-api` files, 1,666→~150 lines; git history has the long forms).
- 2026-08-16 — Reviewing lives wholly in the pending strip, not in-grid: the cell grammar forbids icons in data cells and `StateCell` row scale is one clipped line, so per-cell approve/deny had nowhere honest to go. Typing in the grid still stages directly.
- 2026-08-16 — Typing over a pea proposal SEVERS it and stages your value (the old grid *masked*, blocking edits until review) — "typing beats proposing" (SURFACE-PHILOSOPHY §3) made an actual sever here first.
- 2026-08-16 — Column-level facts (`isCalculated`, `isCombinedParameter`) ride a header suffix (`· ƒ`, `· comb`) plus the column title — `ColumnBase.reason` was already declined for takeoffs; this route is a second data point, not a re-litigation.
- 2026-08-16 — Snapshot freshness stays a plain fact chip ("read 4m ago"), no invented staleness threshold: freshness has no subject/threshold in the model, so a schedule read yesterday and one read 4s ago must render alike.
- 2026-08-16 — Every `state:` column getting its own 7-word facet is accepted as the language default even on wide schedules (12 columns = 12 mostly-"clean" dropdowns); suppressing facets per column would lose the clause's counting.

## Tried & rejected
- 2026-08-16 — Hand-rolled `ScheduleTable`/`Cell`/`CellAction` with trichotomy tint classes (`bg-cat-green/12`, `bg-cat-clay/12`, `bg-destructive/10`), kiln badges and `Input`-in-cell: ~260 LOC deleted for MasterTable + editable `StateCell`; the tints were viz hues carrying state.
- 2026-08-16 — A per-cell mark for cells that failed a partial push: outcomes have no item links, and the failure list exists only in a transient command result — inventing a mark would have been fiction. Left as `OutcomeLine partial` ("failed cells stay staged").
- 2026-08-16 — A kiln "T" badge for type parameters: a taxonomy hue carrying a fact; dropped to a note.

## Owed
- Units at human surfaces (ruled 2026-09-19 and 2026-09-22, design-system ledger): domains `ScheduleCellBinding.DisplayUnit` exists on `crusade/schedule-display-unit`; the host contract, route Reading, staged `{ value, unit }`, and the commit-time parse are not built. Native proof: one real schedule.
- pin as test: an empty-string commit is REFUSED — blank is not zero and blank is not a stageable value (the old code refused it silently; the refusal is now spoken, and nothing asserts it).
- pin as test: typing over a pea proposal SEVERS it and the severed proposal is DELETED, not retired — this route has no proposal ledger, and deleting is honest (nothing renders a false history) even though it is lossy.
- Partial-push failure attribution: cheapest path is the push handler setting `review: "attention"` (error as note) on each failed cell, which rides the attention-axis ruling (design-system ledger, Owed) and makes failures countable/filterable. Otherwise needs the outcome-link model work.
- "Clear this parameter" is inexpressible — need a model-level staged `{value: null}` = clear, distinct from refusing `""`, and the push op must support clearing first (a contracts question, not a grammar one).
- When a proposal ledger ships, the sever patch should retire the proposal into it rather than deleting it.
