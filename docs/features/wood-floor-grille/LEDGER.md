# wood-floor-grille ledger

## Decided
- 2026-08-25, the table is the product (as `/family`); the drawing is the only pane carrying per-slot information, with an input on every witness line.
- 2026-08-25, wood is drawn as a section hatch, not a brown fill: `design-lang.css` has no material hue, and hatch is the submittal convention.
- 2026-08-25, chart `count` (free % vs qty, a line per opening width) is the chart; free % stays on y because it is the outcome and the target reads as a horizontal line.
- 2026-08-25, layout mirrors `/family`: `PaneWorkspace` with the drawing as a hideable visual pane, the chart beside it as a non-hideable inspector (min 420 px), the sheet full-width below.
- 2026-08-25, export is native print → PDF plus .svg per drawing; the read-only `SpecDrawing` has no `foreignObject` so the .svg stands alone.

## Tried & rejected
- 2026-08-25, thumbnail drawing per table row; noise, and it forces row height.
- 2026-08-25, drawing beside a readout rail (drawing-as-form B); a second pane restating per-slot facts.
- 2026-08-25, `codex/wood-floor-grille-product` round (drawing table / fabricator bench / option wall); harvested: input-on-the-dimension idiom, `--r-*` token discipline. Not kept: `<input type=number>` decimals (fractions are the trade's language), three rival layouts for one selection.

## Owed
- Rule round 3 (`MAP.md`): export unit and title block, section A-A as the home for opening / rib / edge, `MIN_RIB` law-or-lore.
- `MasterTable` row compactness for sheet-like consumers; see `docs/features/design-system/LEDGER.md`.
- `SpecDrawing` fixed 40 px/in scale; fit-to-pane when boards exceed ~24″ (`spec-drawing.tsx` `PX`).
- Persistence: rows live in memory only. Where does a profile library live once the surface settles?
