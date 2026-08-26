# Wood floor grille — product map

## Question

What is the product that carries the math of `PE Custom Wood Floor Grille Calculator.xlsx` (sheet `free area calcs`, rows 7–12) and shows the grille while you edit it?

## Real base

- `apps/web/src/grille-proto/math.ts` is a 1:1 port of the sheet; `math.test.ts` pins rows 7 and 10 to the evaluated cells.
- Rows render through `MasterTable` (canon). Drawing and charts are proto-only SVG. All edits are in memory.
- Route `/grille-proto?chart=rib|count|grid` on worktree `Pe.Tools-grille`, branch `proto/wood-grille`.

## Round 1 (2026-08-25) — ruled

| Variant | Verdict |
| --- | --- |
| A sheet, thumbnail per row | Partial reject: the inlined drawing is noise; row height may never grow for it. |
| B drawing-as-form, side rail | Reject: the drawing is the ONLY pane that reflects per-slot information. |
| C target-first, chart + compact table | Base. The chart is a keeper; more axes wanted. Compact table kept for the concept; `MasterTable` is canon and is not this compact. |

Standing rulings: the table is the product, like `/family`. Input box at every witness line. Colours abide `design-lang.css`; brown reads natural for wood but is not a token. Drawing style: Price submittal / performance sheet.

## Round 2 — on the table

One page shape (sheet → drawing + chart), three CHART forms:

| Chart | Axes | Question it answers |
| --- | --- | --- |
| rib | free % vs rib width | how much free area does buildability cost |
| count | free % vs qty, one line per opening width | how count and width trade |
| grid | opening × qty lattice, ink area = free % | the performance-sheet lattice without its gradient |

Magnitude without hue: ink area (grid). Alternatives not built: hatch density, stroke weight, ranked position.

## Frontier

- Rule the chart form, or a composition.
- Rule the drawing: plan + section A-A with inputs on the witness lines. Is a section the right home for opening / rib / edge?
- Is `MIN_RIB` (1/4″) law or lore? What other fabrication limits bound the field (stock widths, kerf)?
- Is a row a profile option (the sheet) or a grille in a job (a schedule)?
