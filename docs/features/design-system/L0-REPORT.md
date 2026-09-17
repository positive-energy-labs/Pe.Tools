# L0 foundation report

## Design tensions

- 2026-09-16, `ArtifactFrame` owns its header geometry. Its `head` prop supplies rail lead content and its `headTrail` prop supplies rail actions. `MasterTable` passes those two slots, never a `Rail`, so each table has one rail.
- 2026-09-16, `PartsBoundary` is local to `workbench/moments.tsx` and cannot serve `Pane`. `Pane` needs a small local boundary. A consumer that changes its rendered target must pass that target identity through `boundaryKey`; the native React key remounts the boundary. Retry resets the current target only.
- 2026-09-16, `Rail.edge` is the one correction to its minimal contract. `ArtifactFrame.foot` needs `top` to preserve its separator; headers retain the default bottom edge.
- 2026-09-16, `RootComponent` owns the route viewport. `Surface` uses parent-relative `size-full`; `PaneSplit` always reserves `var(--gutter)` and leaves pane outlines unclipped.
- 2026-09-16, `Rail` owns `ActionChrome`. Every rail slot keeps disabled commit refusals in the button title, including `ArtifactFrame.headTrail`.

## Landed

- One coherent foundation commit: tokens, `Rail`, `ArtifactFrame` slots, `Code`, `Section`, `Pane`, `Surface`, `MasterTable`, specimens, and behavior tests.
- `ArtifactFrame` has one rail. `head` supplies lead content and `headTrail` supplies actions. `MasterTable` supplies those slots and never nests `Rail`.
- `PaneSplit` owns resize handles. `Surface` owns only the shared perimeter and optional scroll-away head.
- Net diff before commit: +561/-138 lines.

## Proof

- PROVEN[deterministic]: `vp test src/components/lang/pane.test.tsx src/components/lang/code.test.tsx src/workbench/prose.test.tsx src/components/master-table/master-table.test.tsx` passed 40 tests. New behavior coverage: one rail/no halo, collapsed flank hotkeys, suspension, retry, target-key recovery, default header opt-out, Surface parent fill, fixed and resizable split gutters, outer gutter geometry, footer edge, header filters, rail actions, and disabled commits in `ArtifactFrame.headTrail`.
- PROVEN[deterministic]: `vp run @pe/repo-guards#test` passed 93 tests with no baseline changes.
- FALSIFIED[compile]: `vp check` reports `src/family/workspace-doc-pane.tsx:282` because it passes `headerSurface="artifact"`; `Pane.headerSurface` is now `page | recess`. This consumer must migrate to `recess` or own a different surface composition.
- PROVEN[deterministic, baseline `527048f`]: `scripts/fixture-census.test.ts` and both `src/schedule-grid/seams.test.tsx` failures predate L0. Root ran the exact files against production-equivalent `main1406e70` (docs-only after `527048f`): 3 failed, 4 passed. The failures match exactly: fixture census expected 0 canonical fixtures but received 1; schedule receipt resolution is blocked by the missing `captures/schedules/837acb27a0b40e690b5a8435ad905d4395ea5b103577e2ca4985d461cfafc682.json`; and the apply queue sees `stale-revision` after the document moves to `r2`.
- UNPROVEN[browser]: no browser route was run.

## Consumer migration

- `family/workspace-doc-pane.tsx`: migrate `headerSurface="artifact"`.
- `takeoff/atlas-visual.tsx` and `takeoff/atlas-table.tsx`: decide titles for currently headerless `Pane` calls; L0 preserves the intentional opt-out.
- Every `Pane` now renders a header unless `headerless` is explicit. The two unnamed production callers above must add a title or `headerless` in their consumer lane.
- `SidePane` callers migrated in root `3a74472`; the obsolete primitive and duplicate specimen coverage are deleted below.
- Later lanes own `PaneSplit` callers in `takeoff/atlas-table.tsx` and `runs/browser/view.tsx`, and `PaneWorkspace` callers in `components/anatomy/workspace.tsx`, `routes/grilles.tsx`, and the specimen.

## Follow-up

- 2026-09-16, root browser evidence at `Pe.Tools-unify-workspaces/.artifacts/runs/root-browser-20260916/takeoffs-normal.png` showed the Takeoffs `MasterTable` body expanding below its bounded split track. `PaneSplit` side wrappers now form `min-h-0` flex columns, so both a `Pane` and a direct `ArtifactFrame` can fill the track and leave scrolling to the table body.
- 2026-09-16, `Rail` remains 24px high. Lead text truncates, while actions remain accessible through a no-scrollbar horizontal scroller that reveals keyboard focus. Takeoffs moves its field mode button to `MasterTable.modes`; its summary holds facts only and its existing pane help/shortcuts hold keyboard instructions.
- Owed consumer migration: `grilles/sheet.tsx` still passes its `+ profile` `Press` through `MasterTable.summary`. Move it to `MasterTable.actions` in the Grilles lane; this follow-up did not alter that route.
- 2026-09-16, production census found no `SidePane` import or JSX caller. Deleted `components/lang/side-pane.tsx` (172 LOC), its `UiLayoutSpecimens` block (19 LOC), its `recipe-grid.test.tsx` registration (2 LOC), and the dead `AnnotationVariant` member (1 LOC). `PickList` now names `Pane`; `Pane`, `PaneSplit`, and `PaneWorkspace` specimens cover the shared layout contract.
- 2026-09-16, `Surface` now has direct flex-column children and one `var(--gutter)` padding owner. The 13 production single-cell callers no longer use `columns`, `rows`, or `SurfaceCell`; the specimen uses `PaneSplit` for a split. This cutover is +62/-101 source LOC. `chatColumn` declares `grid-cols-[minmax(0,1fr)]`, so its 386px width does not create a 550px implicit column.
