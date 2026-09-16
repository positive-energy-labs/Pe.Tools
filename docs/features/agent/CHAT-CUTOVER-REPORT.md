# Chat cutover report

## Checkpoint

- 2026-09-16, `unify/chat-cutover` starts at `1406e70` with a clean tree.
- Runtime seams: remove the keyed `WorkbenchProvider`; retain drafts only in `ThreadComposer` Activity children; move draft values to neutral `workbench/prompt.ts`; make one keyed current-thread view owner reset lens and World state; keep the body atom and Suspense boundary inside the transcript only.
- Deletions: the store draft atom and URL mirror, attachment object URLs and revocation effect, provider draft-clearing code, floating-composer layout code, `SidePane` imports from Chat/Lens after the foundation commit.
- Dependency: the shared `Pane`/`Rail`/`Surface` foundation commit is not available in this checkout. Runtime ownership work proceeds without substitute primitives. Layout integration waits for that commit.

## Evidence

- Source and deterministic tests only until root assigns browser proof. No browser or Revit process was started or changed.
- `vp test apps/web/src/chat/composer.test.tsx apps/web/src/workbench/store.test.ts --run`: 11 passed. Covers A/B retained drafts, late completion preserving a later edit, attachment bytes, and internal prompt/turn stripping.
- `vp test apps/web/src/workbench/provider/thread-stream.test.tsx apps/web/src/workbench/provider.test.ts apps/web/src/readings.test.ts apps/web/src/state/atom-inspect.test.ts apps/web/src/workbench/prose.test.tsx --run`: 17 passed. Covers existing stream pending/reconnect behavior, provider verbs, readings, inspector, and prose seams.
- `vp check` on the 17 touched web files passed.
- Runtime unit delta before the report and new neutral/state-owner leaves: +296/-298 tracked lines. The foundation remains required for the in-flow `Pane` layout and transcript-only `PaneBoundary`/`useAtomSuspense` body split. Those files are intentionally untouched until its commit arrives.
