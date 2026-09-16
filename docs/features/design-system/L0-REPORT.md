# L0 foundation report

## Design tensions

- 2026-09-16, `ArtifactFrame` owns its header geometry. Its `head` prop supplies rail lead content and its `headTrail` prop supplies rail actions. `MasterTable` passes those two slots, never a `Rail`, so each table has one rail.
- 2026-09-16, `PartsBoundary` is local to `workbench/moments.tsx` and cannot serve `Pane`. `Pane` needs a small local boundary. A consumer that changes its rendered target must pass that target identity through `boundaryKey`; the native React key remounts the boundary. Retry resets the current target only.

## Landed

- One coherent foundation commit: tokens, `Rail`, `ArtifactFrame` slots, `Code`, `Section`, `Pane`, `Surface`, `MasterTable`, specimens, and behavior tests.
- `ArtifactFrame` has one rail. `head` supplies lead content and `headTrail` supplies actions. `MasterTable` supplies those slots and never nests `Rail`.
- `SurfaceHandle` re-exports `PaneResizeHandle`. No wrapper was added.
- Net diff before commit: +561/-138 lines.

## Proof

- PROVEN[deterministic]: `vp test src/components/lang/pane.test.tsx src/components/lang/code.test.tsx src/workbench/prose.test.tsx src/components/master-table/master-table.test.tsx` passed 34 tests. New behavior coverage: one rail/no halo, collapsed flank hotkeys, suspension, retry, target-key recovery, header filters, and rail actions.
- PROVEN[deterministic]: `vp run @pe/repo-guards#test` passed 93 tests with no baseline changes.
- FALSIFIED[compile]: `vp check` reports `src/family/workspace-doc-pane.tsx:282` because it passes `headerSurface="artifact"`; `Pane.headerSurface` is now `page | recess`. This consumer must migrate to `recess` or own a different surface composition.
- FALSIFIED[deterministic]: the full `vp run @pe/web#test` had unrelated failures in `scripts/fixture-census.test.ts` and two `src/schedule-grid/seams.test.tsx` cases. The cutover-specific pane and Code failures were repaired and their scoped suite passed.
- UNPROVEN[browser]: no browser route was run.

## Consumer migration

- `family/workspace-doc-pane.tsx`: migrate `headerSurface="artifact"`.
- `takeoff/atlas-visual.tsx` and `takeoff/atlas-table.tsx`: decide titles for currently headerless `Pane` calls; L0 preserves the intentional opt-out.
- Later lanes own `SidePane` callers in `chat/chat-shell.tsx`, `schedule-grid/workspace.tsx`, `workbench/lens/view.tsx`, `routes/data-tables.tsx`, and `routes/parameter-links.tsx`.
- Later lanes own `PaneSplit` callers in `takeoff/atlas-table.tsx` and `runs/browser/view.tsx`, and `PaneWorkspace` callers in `components/anatomy/workspace.tsx`, `routes/grilles.tsx`, and the specimen.
