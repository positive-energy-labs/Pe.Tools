# TanStack Table v9.1.2 fit for `MasterTable`

_Date: 2026-08-15. Primary sources only. Inspected the published `@tanstack/react-table@9.1.2` / `@tanstack/table-core@9.1.2` packages and TanStack/table commit `5304f72`._

## Verdict

**Yes—adopt TanStack Table v9 as `MasterTable`'s headless model/state engine. Do not adopt the official Spreadsheet example as the component.**

The current table is still small enough that a parity-only rewrite is not compelling. The decision becomes worthwhile because the announced next requirements—arbitrarily nested headers, real pinning/sizing/visibility, and cell focus/selection—are exactly the state and geometry TanStack now owns. It will remove custom table algebra and prevent more of it accumulating. It will **not** remove most rendering, editing, keyboard, accessibility, or export code.

Pin `9.1.2` initially rather than using `latest`: v9.0.0 became stable on 2026-08-04 and 9.1.2 was published on 2026-08-09, so it is stable but very new. It is MIT-licensed and has a substantially new explicit-feature API. The published adapter supports React 18+, so this repo's React 19 is in range. [Installation](https://tanstack.com/table/latest/docs/installation), [published package](https://www.npmjs.com/package/@tanstack/react-table/v/9.1.2), [exact package metadata](https://github.com/TanStack/table/blob/%40tanstack/react-table%409.1.2/packages/react-table/package.json)

## Immediately useful

- **Nested headers:** nested column definitions produce any number of header rows with calculated `colSpan`, placeholders, and pinning-aware start/center/end header groups. This replaces the current one-level, contiguous-string `clusters()` convention. Do not confuse this with _row grouping_, which is a different optional feature. [Header groups](https://tanstack.com/table/latest/docs/guide/header-groups)
- **Current table algebra:** opt-in filtering, global filtering, multi-sort, faceting, and final row models replace `toggleSort`, `applySort`, and `applyFilters`; `table.getRowModel().rows` can replace the current `onVisibleChange` ordering bridge. V9 makes both features and client-side row models explicit and tree-shakable. [Feature model](https://tanstack.com/table/latest/docs/guide/features), [sorting](https://tanstack.com/table/latest/docs/framework/react/guide/sorting), [filtering](https://tanstack.com/table/latest/docs/framework/react/guide/column-filtering)
- **Column primitives:** visibility state, sizing/resizing state and drag handlers, and start/end pinning offsets are built in. CSS and controls remain ours, but the hard geometry/state does not. [Visibility](https://tanstack.com/table/latest/docs/framework/react/guide/column-visibility), [resizing](https://tanstack.com/table/latest/docs/framework/react/guide/column-resizing), [pinning](https://tanstack.com/table/latest/docs/framework/react/guide/column-pinning)
- **Spreadsheet focus foundation:** v9's `cellSelectionFeature` supplies rectangular selection, drag/Shift/Ctrl semantics, stable row/column IDs, selection edges, roving `getTabIndex()`, and imperative `moveCellSelection` / `extendCellSelection`. This repo already directly depends on `@tanstack/react-hotkeys`, the library used in TanStack's guide/example to bind those APIs. [Cell selection guide](https://tanstack.com/table/latest/docs/framework/react/guide/cell-selection)
- **State ownership and types:** each slice can stay internal or be selectively controlled/external; `createColumnHelper` carries row and accessor-value types, while typed column meta can retain Pe-specific `label`, alignment, title, read-only reason, and cell UI concerns. [Table state](https://tanstack.com/table/latest/docs/framework/react/guide/table-state), [column definitions](https://tanstack.com/table/latest/docs/guide/column-defs)

## Harmful assumptions / real costs

- **It is headless.** TanStack creates models and state; Pe still owns semantic markup, styles, event affordances, and accessibility. The published v9 skill states this explicitly. [V9 core skill](https://github.com/TanStack/table/blob/5304f72da8dd082aa37fc1ee79b09112b2a8264a/packages/table-core/skills/core/SKILL.md)
- **Editing is still ours.** There is no stock editing feature. `TextCell`, `NumberCell`, validation, commit/revert, route mutations, dirty/error state, and optimistic behavior remain application code. The Spreadsheet example implements its own editing state and patch/history model. [Stock features](https://tanstack.com/table/latest/docs/guide/features), [Spreadsheet interaction source](https://github.com/TanStack/table/blob/5304f72da8dd082aa37fc1ee79b09112b2a8264a/examples/react/spreadsheet/src/useGridInteractions.ts)
- **Keyboard bindings are still ours.** Cell selection deliberately ships no keydown handling. The official convention is Arrow keys move/extend selection; Enter/Shift+Enter move down/up; Tab/Shift+Tab move right/left. Inside an editor, arrows remain native while Enter/Tab commit and move. [Guide](https://tanstack.com/table/latest/docs/framework/react/guide/cell-selection#keyboard-navigation), [exact grid bindings](https://github.com/TanStack/table/blob/5304f72da8dd082aa37fc1ee79b09112b2a8264a/examples/react/spreadsheet/src/SpreadsheetGrid.tsx#L77-L114), [exact editor bindings](https://github.com/TanStack/table/blob/5304f72da8dd082aa37fc1ee79b09112b2a8264a/examples/react/spreadsheet/src/useGridInteractions.ts#L461-L472)
- **Spreadsheet Tab behavior needs an accessibility boundary.** W3C's ARIA grid pattern makes arrows the standard cell-navigation keys and puts only one grid descendant in the page Tab sequence. Tab/Shift+Tab may move between widgets while editing, but trapping Tab inside the grid is not required. If Pe follows the spreadsheet example's next-cell Tab behavior, it should release focus at the first/last boundary so keyboard users can leave the composite. [W3C ARIA grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- **The present always-input cells conflict with arrow navigation.** Left/right arrows must edit the input caret while editing, not move cells. A real spreadsheet interaction needs a focused grid-cell mode and a separate editing mode (or a deliberately smaller Enter/Tab-only behavior). TanStack supplies the coordinates, not that mode switch.
- **No XLSX export.** There is no export stock feature. TanStack can provide the chosen visible columns and filtered/sorted row model; workbook creation, formatting, formulas, filenames, and whether export means visible/current-page/all-scope rows remain a separate exporter. Even selection copy returns raw value grids and leaves TSV serialization to the application. [Stock features](https://tanstack.com/table/latest/docs/guide/features), [copy boundary](https://tanstack.com/table/latest/docs/framework/react/guide/cell-selection#copying-a-selection)
- **Current facet law does not match the default.** `MasterTable` intentionally keeps options stable from _all_ rows. TanStack's faceting normally applies every other active filter, so option lists/counts change as filters narrow. Preserve the current raw-row `facetOptions` behavior or supply a custom faceting factory; do not silently switch semantics. [Faceting behavior](https://tanstack.com/table/latest/docs/framework/react/guide/column-faceting#how-column-faceting-responds-to-filters)
- **Virtualization is separate.** TanStack Table does not virtualize; `@tanstack/react-virtual` owns rendering/measurement and adds focus/unmount/layout concerns. Add it only after row counts or profiling justify it. [Virtualization](https://tanstack.com/table/latest/docs/framework/react/guide/virtualization)
- **Do not copy the Spreadsheet example wholesale.** Its reference implementation is about 3,941 lines of TS/TSX plus 895 CSS lines because it includes virtualization, merged cells, selection, clipboard, fill, undo/redo, menus, and editing. It is evidence and recipes, not a primitive. [Spreadsheet example](https://tanstack.com/table/latest/docs/framework/react/examples/spreadsheet)

## Speculatively useful

- Client/server pagination, row selection, row grouping/aggregation, row/column pinning, column ordering, and cell spanning are already optional features when a route actually needs them. Register only what `MasterTable` ships; avoid `stockFeatures`. [Feature inventory](https://tanstack.com/table/latest/docs/guide/features)
- Cell-range copy/paste, multi-range selection, fill, undo/redo, and merged cells are credible later, but only selection geometry and spanning are Table features; clipboard, fill, history, and persistence remain Pe-owned.
- Fine-grained `table.Subscribe` boundaries and later row virtualization can keep cell dragging responsive. A naive selection subscription can rerender every cell for every crossed boundary, so this is an implementation requirement if selection is enabled on large tables. [Selection performance](https://tanstack.com/table/latest/docs/framework/react/guide/cell-selection#performance-with-tablesubscribe)
- V9 is `sideEffects: false`; explicit feature/function imports are designed to tree-shake. TanStack reports roughly 25 kB for every possible v9 capability, with most consumers smaller when they register only what they use. Measure the actual Pe production chunk after implementation rather than treating that ceiling as our bundle delta. [Feature/bundle rationale](https://tanstack.com/table/latest/docs/guide/features#why-the-features-option-is-required), [package metadata](https://github.com/TanStack/table/blob/%40tanstack/react-table%409.1.2/packages/react-table/package.json)

## LOC and complexity change

Measured current raw LOC: `model.ts` 173, `master-table.tsx` 326, `cells.tsx` 210 = **709 product LOC**, plus **134 test LOC**. There are currently two `MasterTable` consumers (`/families` and Takeoff Atlas).

| Area | Current | Expected after parity migration | Change |
| --- | ---: | ---: | ---: |
| Pure model / adapter | 173 | 35–75 | **−98 to −138**; keep number parsing and a small Pe meta/domain adapter, delete sort/filter/header algorithms |
| Renderer | 326 | 300–365 | **−26 to +39**; header/body loops remain, Table setup and feature wiring replace local state algebra |
| Cell primitives | 210 | 210–245 | **0 to +35**; editing remains ours |
| Product source total | **709** | **545–685** | **−24 to −164** for current behavior |
| Tests | 134 | 120–220 | roughly neutral or higher; delete tests of vendor algorithms, add DOM tests for Pe semantics/state wiring |

Adding useful spreadsheet navigation immediately is likely another **70–140 product LOC plus 80–150 test LOC**. That may make total LOC near-neutral versus today; the payoff is capability and deletion of future state/geometry code, not a dramatic small-table code reduction.

Complexity moves rather than vanishes:

- **Algorithm/state complexity: sharply down**—sorting, filtering, nested headers, pinning offsets, sizing, visibility, and selection geometry become library-owned.
- **Configuration/type complexity: moderately up**—explicit v9 feature sets, stable `data`/`columns`, typed meta, and narrow state subscriptions must be understood.
- **Renderer/editor/accessibility complexity: unchanged to moderately up**—especially if converting always-editable inputs into browse/edit grid modes.
- **Future primitive complexity: sharply down** for features in the stock inventory; **unchanged** for XLSX, validation/persistence, clipboard formats, and route-specific scope laws.

## Recommended boundary

Use TanStack directly inside `MasterTable`; do not keep a second generic table engine in front of it. A thin Pe column helper/meta layer is justified for domain vocabulary and dense cell renderers, but TanStack should be the authority for column IDs, nested structure, row order, filters, sort, pinning, sizing, visibility, and selection. Keep route-owned scope/chips and mutation callbacks outside it.

Migrate when implementing the next required primitive, in this order: (1) nested `ColumnDef` headers + existing filter/sort behavior, preserving stable facet vocabularies; (2) pinning/sizing/visibility as demanded; (3) a small focused-cell interaction hook for Enter/Tab/arrows with editor isolation; (4) export as a separate feature using an explicitly chosen Table row model.
