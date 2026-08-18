# param-tables ledger

Arbitrary engineering tables (Basis of Design, Figures of Merit) whose values are *linked to parameters on model elements*. Live effort — frontier and round records in [MAP.md](MAP.md).

## Decided

- 2026-08-17 — The product exists because Revit can do neither half: arbitrary tables aren't a thing (the precedent is "SXL" schedules — Excel pasted into schedule *header cells*: unfilterable, unlinkable, silently stale), and a table value cannot drive a parameter (design facts are retyped into `PE_*` shared params on equipment, and they drift). The acceptance path in every variant is one demo: change heating EWT/LWT in the FOM and the 23 fan coils' `PE_M_PerfHeat_FluidEWT/LWT` update, visibly, in their schedule.
- 2026-08-17 — Round 1 runs on a REAL fixture pulled live from ProjectA_Clone_Aug_11 (`apps/web/src/param-tables/proto/fixture.ts`), not a synthetic one, so honesty problems are forced rather than designed around: FC-1's type genuinely holds heating LWT 90 vs the authored 100, so most variants open with an at-rest drift mark before any edit, and the refused DVWHSA write leaves *residual drift* after apply — refusal is not absorption.
- 2026-08-17 — Three fixture truths no variant may sand off: perf parameters live at **type** scope (one write fans out to sibling instances, and the far side of a bulk verb must be visible before it is enabled); formula-owned targets refuse **per target, with the reason**; and the table is also a **deliverable** that lands on sheet M001 as a print exhibit.
- 2026-08-17 — Precedent vocabulary is inherited, not reinvented: `/parameter-links` owns profile / definition / assignment / relationship / reducer / evaluation / reconcile, evaluation-before-apply, per-issue refusals, and the freshness gate on Apply; `/data-tables` owns name + row-key upsert, txt/num columns, and prune-on-apply. Both of their known confusions (invisible draft/preview/apply state machine, no per-cell unsaved state, invisible destructive prune) are inputs to this round, not things to re-derive.

## Tried & rejected

- 2026-08-17 — Layouts already discarded by their own audits: `/parameter-links`' definition-card UI (nothing in it says "table") and `/data-tables`' inert value cells (no linkage concept at all). Round 1 rebuilt from the fixture instead of extending either.

## Owed

- Round-1 verdicts are unruled — five variants (`/param-tables?variant=a..e`) are built, typecheck-clean and browser-verified, awaiting a kaitpw sitting. Nothing is settled law until a round rules it. See [MAP.md](MAP.md).
- Design-language gaps the round proved by independent re-invention (8 items: no mark for a linked value, no fan-out/staged-writes preview primitive, no binding-status axis or station strip, no old→new staged-transition token, no pinned authored band or type-group header row, unruled cross-pane subscriber highlight, receipt surfaces beyond `OutcomeLine`, no cell-scale parameter picker). Route them into the design-system frontier once the round rules.
- Host-op gap is binding: `revit.apply.schedule` writes header-cell text tables and `revit.apply.parameter-links` writes param links, but nothing writes "table + linkage" atomically, and nothing renders an authored grid as a *placeable* exhibit with live cells.
