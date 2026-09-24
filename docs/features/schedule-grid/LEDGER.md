# schedule-grid ledger

## Decided
- 2026-08-17 — electrical panel-schedule lore consolidated to `GROUNDING-REVIT-ELECTRICAL.md` (from 5 `docs/context/rvt-api` files, 1,666→~150 lines; git history has the long forms).
- 2026-09-23 — Schedule proposal/staged review belongs in the Situation head, as on Families. Cell selection supports range fill and focused-cell clipboard actions; editing stages locally and never implicitly pushes to Revit.
- 2026-09-23 — Schedule undo/redo reverses local review edits, one committed batch per step. Native input undo stays native; a changed target, reading, external Work revision, or push ends the local history so it cannot undo newer model or agent work.
- 2026-09-23 — Keep global text search alongside explicit column conditions combined with AND. Header controls and editable chips share TableState; filters and value sorting follow the displayed staged/proposed value. Plain numeric fields support ordered comparison; measured-unit comparison requires an explicit unit contract.
- 2026-08-16 — Typing over a pea proposal SEVERS it and stages your value (the old grid *masked*, blocking edits until review) — "typing beats proposing" (SURFACE-PHILOSOPHY §3) made an actual sever here first.
- 2026-08-16 — Column-level facts (`isCalculated`, `isCombinedParameter`) ride a header suffix (`· ƒ`, `· comb`) plus the column title — `ColumnBase.reason` was already declined for takeoffs; this route is a second data point, not a re-litigation.
- 2026-09-23 — Freshness is the stale mark on the read verb (design-system MAP ruling 5); the "read 4m ago" chip of 2026-08-16 is gone.
- 2026-09-23 — One query grammar filters by value and by cell state (design-system MAP ruling 22); the per-column `state:` facet of 2026-08-16 is gone.

- 2026-09-22 (C7, user: whole-document mark) — Freshness has teeth: schedule Work records `takenAt`, the host-clock time of the basis Reading (written with `basis`, and by `rebindScheduleWork`); `schedule.grid.push` refuses undispatched when the document's change mark is newer, in one sentence: `Revit changed this document after the read your staged cells rest on; read again, then apply.` `r` (bound by the read verb, which wears the stale mark; `ChangedInRevit` is deleted) reads again. Proof: journey `ts/tests/e2e/st4-changed.ts` (demo lane, RED then GREEN), `apps/host/tests/document-marks.test.ts` push case.

## Tried & rejected
- 2026-08-16 — Hand-rolled `ScheduleTable`/`Cell`/`CellAction` with trichotomy tint classes (`bg-cat-green/12`, `bg-cat-clay/12`, `bg-destructive/10`), kiln badges and `Input`-in-cell: ~260 LOC deleted for MasterTable + editable `StateCell`; the tints were viz hues carrying state.
- 2026-08-16 — A per-cell mark for cells that failed a partial push: outcomes have no item links, and the failure list exists only in a transient command result — inventing a mark would have been fiction. Left as `OutcomeLine partial` ("failed cells stay staged").
- 2026-08-16 — A kiln "T" badge for type parameters: a taxonomy hue carrying a fact; dropped to a note.

## Owed
- Units at human surfaces: built 2026-09-22 (design-system ledger). Revit-backed proof owed: `pe-revit test --project dotnet/Pe.Revit.Tests --filter Schedule_cell_binding_display_unit_is_the_unit_the_column_renders` and `--filter Typed_text_is_read_by_the_document_and_answered_in_the_unit_the_surface_renders`, then one real schedule: type "300 L/s" in a CFM column and read back Revit's answer.
- pin as test: an empty-string commit is REFUSED — blank is not zero and blank is not a stageable value (the old code refused it silently; the refusal is now spoken, and nothing asserts it).
- pin as test: typing over a pea proposal SEVERS it and the severed proposal is DELETED, not retired — this route has no proposal ledger, and deleting is honest (nothing renders a false history) even though it is lossy.
- Partial-push failure attribution: cheapest path is the push handler setting `review: "attention"` (error as note) on each failed cell, which rides the attention-axis ruling (design-system ledger, Owed) and makes failures countable/filterable. Otherwise needs the outcome-link model work.
- "Clear this parameter" is inexpressible — need a model-level staged `{value: null}` = clear, distinct from refusing `""`, and the push op must support clearing first (a contracts question, not a grammar one).
- When a proposal ledger ships, the sever patch should retire the proposal into it rather than deleting it.
