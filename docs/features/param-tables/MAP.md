# Param tables — live effort map

Frontier of an open find-the-product effort. Delete this file when the effort ends; rulings graduate to [LEDGER.md](LEDGER.md).

Find-the-product loop for the **parameter-links × data-tables hybrid**: arbitrary engineering
tables (Basis of Design, Figures of Merit) whose values are **linked to parameters on model
elements**. Round 1 opened 2026-08-17. No surface has caught up to anything here yet — nothing
is settled law until a round rules it.

## What this product is

Revit cannot do either half of this:

- **Arbitrary tables don't exist.** The precedent workaround in ProjectA_Clone_Aug_11 is "SXL"
  schedules — Excel content pasted into schedule *header cells*. `SXL - FOM HWCH Plant` is a
  5×11 grid of merged header text; `SXL - M_BOD_MainHouse` (sheet M001) concatenates label and
  value into one string per row ("Outdoor Design Temperature (Winter DB) (°F):  9.4"). Dead
  text: unfilterable, unlinkable, silently stale.
- **A table value cannot drive a parameter.** The design facts in those tables (IDT, ODT,
  loop temps) are *retyped* into PE_* shared parameters on equipment, where the real schedules
  (e.g. `Hydronic Fan Coil Unit Performance Schedule`) read them. Nothing connects the two;
  they drift.

The product: author the table once, link its values to parameters on selected equipment, and
the linkage is live — **change heating EWT/LWT in the FOM and the 23 fan coils'
`PE_M_PerfHeat_FluidEWT/LWT` update, visibly, in their schedule**. That acceptance path is the
round-1 demo in every variant.

## Precedents (what the problem is; layouts already discarded)

- `/parameter-links` ([ledger](LEDGER.md), "Linkage core") —
  owns the linkage vocabulary: profile / definition / assignment / relationship / reducer /
  evaluation / reconcile, evaluation-before-apply, per-issue refusals, the freshness gate on
  Apply. Its confusion list: the draft/preview/apply state machine is invisible (audit #2), a
  whole-document unsaved state has no grammar (#1), and its UI is definition-cards — nothing
  says "table".
- `/data-tables` ([ledger](LEDGER.md), "Authored synthetic tables") — owns authored-synthetic-table
  mechanics: name + row-key upsert, txt/num columns, prune-on-apply. Its confusion list: no
  baseline so no per-cell unsaved state (#1), destructive prune invisible (#2), and its cells
  are inert values — no linkage concept at all.
- Family elements: perf parameters live at **type** scope (an edit to "FC-4" hits 13 sibling
  MSVT18 tags), and some types formula-own their temps (writes must refuse per-target).

## Shared fixture (real, pulled live 2026-08-17)

`apps/web/src/param-tables/proto/fixture.ts` — from ProjectA_Clone_Aug_11: the FOM HWCH Plant
grid, 18 BOD MainHouse entries, 23 fan-coil schedule rows with element ids and type names,
parameter identities with per-type read-only facts, and the demo linkage (heating EWT/LWT →
`PE_M_PerfHeat_FluidEWT/LWT`).

Known truths any variant must not sand off:

1. Type-scope fan-out: one write, many tags. The far side of the write must be visible
   (§2 "a bulk verb is disabled unless you can see its far side").
2. Read-only (formula-owned) targets refuse, per target, with the reason.
3. The table is also a *deliverable* — it lands on sheet M001 as a print exhibit.

## Round 1 — 2026-08-17 — five answers to "what is this page"

Route `/param-tables?variant=a..e` (throwaway, proto folder). Variants built ignorant of each
other, on the shared fixture, overreaching by instruction:

| key | thesis | page is a… |
|---|---|---|
| a | the table is the product; linking is a property of a cell | spreadsheet-grade grid editor |
| b | the link is the product; the table is just a source substrate | two-pane table + binding ledger |
| c | the deliverable is the product; the page is the M001 exhibit, alive | print-styled document |
| d | the named design fact is the product; tables and params both subscribe | dataflow of facts → subscribers |
| e | there is no new page; this is a mode of the canonical equipment table | equipment grid with lenses |

All five built 2026-08-17, whole-web typecheck clean, render + demo path browser-verified
(dev lane `web-only`). Builder notes worth keeping regardless of verdict:

- **a (live sheet)**: link state carried entirely by `StateCell` grammar — no provenance
  column ever appears; a raw corner-tab mark (solid=outbound, hollow=inbound) because the
  fold/square/squiggle slots are all taken. Apply is structurally gated on the fan-out strip
  being visible.
- **b (binding ledger)**: the linkage lifecycle drawn as a station strip (fresh · drift ·
  stale · staged · staged-stale) with verbs *between* stations — the freshness gate
  /parameter-links hid (its audit #2) becomes a place a binding sits. Evaluation snapshots
  the source; editing after evaluate derives `staged-stale` and disarms commit with reason.
- **c (exhibit)**: the page is M001 — print serif, three exhibits, footnote-mark provenance
  (¹² outbound, ᵃᵇ inbound), the fan-out and commit live only in the drill-in binding panel,
  receipts land as rows in the sheet's REVISION strip.
- **d (design facts)**: a registry of ~25 named facts is the only editable surface; authored
  tables and PE_* type params are both read-only subscribers with per-fact blast radius
  (`6t/23`). Bet: cell→param is N×M spaghetti; fact→subscribers is a star.
- **e (lenses)**: no new page — the equipment grid is the substrate; FOM/BOD are pure
  projections; staged/drift/locked are *derived* per render, never stored. The FOM lens
  exposes its printed Load figure as stale against the live row sum.

Free honesty wins the real fixture forced everywhere: FC-1's type genuinely holds heating
LWT 90 vs the authored 100, so a/b/c/e all open with an at-rest drift mark before any edit;
the refused DVWHSA write leaves *residual drift* after apply in b/d — refusal is not
absorption.

**Lang-gap census across builders** (component-repair evidence, deduped):
1. No mark for a *linked* value (outbound/inbound provenance) — four independent raw
   inventions (corner tab, footnote marks, ⌁ glyph, column-head-only).
2. No fan-out / staged-writes preview primitive ("this edit becomes these N typed writes
   over there") — every variant hand-rolled one.
3. No binding-status axis or station-strip state machine (fresh/drift/stale/staged/
   staged-stale) in the language.
4. No old→new staged-transition token (struck-old → bold-new; StateCell's ghost is
   reserved for drift).
5. No pinned authored band on a machine-operated table; no type-group "these rows stage
   together" header row.
6. Cross-pane subscriber highlight (selection propagation) is unruled.
7. Receipt surfaces beyond OutcomeLine: a drawing's receipt is its revision strip (c).
8. No cell-scale parameter picker (doc-picker is document-scoped).

Verdicts: *(pending user ruling)*

## Settled

*(nothing yet — round 1 open)*

## Frontier

- What is the unit of linkage: the cell, the named fact, or the definition?
- Where does the write ceremony live when a table edit fans out to N types?
- Is the exhibit (sheet placement) the same surface as the editor or a projection?
- Which host op gap is binding: today `revit.apply.schedule` writes header-cell text tables
  and `revit.apply.parameter-links` writes param links, but nothing writes "table + linkage"
  atomically, and nothing renders an authored grid as a *placeable* exhibit with live cells.
