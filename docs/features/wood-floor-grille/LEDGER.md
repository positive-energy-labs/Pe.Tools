# wood-floor-grille ledger

Surface: `/grilles` (`apps/web/src/routes/grilles.tsx`, `apps/web/src/grilles/`). Rebuilt 2026-08-25 at promotion; git holds the three proto rounds (`proto/wood-grille`).

## Decided
- 2026-08-25, `grilles/math.ts` is a 1:1 port of `PE Custom Wood Floor Grille Calculator.xlsx` sheet `free area calcs`; `math.test.ts` pins rows 7 and 10 to the evaluated cells.
- 2026-08-25, the table is the product (as `/family`): one `MasterTable` row per candidate profile; the drawing is the only pane carrying per-slot information, with an input on every witness line.
- 2026-08-25, layout mirrors `/family`: `PaneWorkspace`, drawing (hideable) | field chart (min 420 px) over the full-width sheet.
- 2026-08-25, the drawing inputs are shared dimensions: one edit writes every row; rib auto-spaces to close the middle unless rib itself is typed (`setAll`, `ribToFill`).
- 2026-08-25, the field chart puts free % on y (the outcome) and qty on x, one line per opening width; a target reads as a horizontal line. Chosen over free-%-vs-rib and an opening × qty lattice.
- 2026-08-25, wood is a section hatch, not a brown fill (`design-lang.css` has no material hue); section A-A is a 2× detail; export names every dimension with the number set large, submittal style.
- 2026-08-25, export is native print → PDF plus .svg per drawing; the read-only `SpecDrawing` has no `foreignObject` so the .svg stands alone.

## Tried & rejected
- 2026-08-25, thumbnail drawing per table row; noise, and it forces row height.
- 2026-08-25, drawing beside a readout rail; a second pane restating per-slot facts.
- 2026-08-25, `<input type=number>` decimals for dimensions; fractions are the trade's language (`InchField`).
- 2026-08-25, magnitude by gradient (performance-sheet lattice); design-lang forbids hue-only fills below word scale; ink area was the non-hue alternative, and the qty chart beat both.

## Owed
- 2026-09-22, the test bar sweep deleted 1 SCAFFOLD test files with no surface replacement. Each behavior they asserted needs a surface test (CDP journey, MCP tool call, host HTTP) or a visible readout. Recover the assertions from git: `grilles/math`.
- Persistence: rows live in memory only. Where does a profile library live (job, document, host state)?
- Export unit: is one page what the architect wants, or a drawing per grille; what must the title block carry (tag, revision)?
- `MIN_RIB` (1/4″) is lore; a fabricator has not ruled it, nor stock widths or kerf.
- `SpecDrawing` fixed px/in scale; fit-to-pane when boards exceed ~24″ (`spec-drawing.tsx` `px`).
- `MasterTable` row compactness for sheet-like consumers; see `docs/features/design-system/LEDGER.md`.
