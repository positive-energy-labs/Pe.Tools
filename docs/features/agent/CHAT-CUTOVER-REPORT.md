# Chat cutover report

## Checkpoint

- 2026-09-16, `unify/chat-cutover` starts at `1406e70` with a clean tree.
- Runtime seams: remove the keyed `WorkbenchProvider`; retain drafts only in `ThreadComposer` Activity children; move draft values to neutral `workbench/prompt.ts`; make one keyed current-thread view owner reset lens and World state; keep the body atom and Suspense boundary inside the transcript only.
- Deletions: the store draft atom and URL mirror, attachment object URLs and revocation effect, provider draft-clearing code, floating-composer layout code, `SidePane` imports from Chat/Lens after the foundation commit.
- Foundation incorporated: `1f4fdc7`, `aa15cf4`, `5596249`, `f0c99e3`, `ff289ac`, and `c2983dc`. Chat now composes the accepted `Surface`, `Pane`, and `PaneSplit` primitives; it carries no local substitute.

## Evidence

- Source and deterministic tests only until root assigns browser proof. No browser or Revit process was started or changed.
- `vp test apps/web/src/workbench/provider/thread-stream.test.tsx apps/web/src/chat/manifest.test.ts apps/web/src/chat/composer.test.tsx apps/web/src/workbench/store.test.ts apps/web/src/workbench/prose.test.tsx apps/web/src/workbench/lens/thread-body.test.tsx apps/web/src/readings.test.ts apps/web/src/state/atom-inspect.test.ts apps/web/src/components/lang/pane.test.tsx --run`: 48 passed. Covers A/B draft-and-attachment retention, late completion preservation, prompt/turn navigation, delayed body with live approval, A-to-B isolation, equal-ready identity, transcript-only Suspense sibling stability, retries, reconnect seams, Markdown, readings, inspection, and Pane behavior.
- `vp check` on the Chat/runtime cutover files passed with no warnings, lint, or type errors.
- No browser or Revit process was started. Browser proof remains root-owned.

## Current state

- Runtime commits: `5658ec1`, `6345064`, `7cd5b66`, `6533201`; current layout refinement is pending commit.
- Current cutover delta since `1406e70`: +874/-527 lines in owned Chat/runtime paths, including the accepted foundation commits. No draft persistence, body DOM retention, object URLs, composer height observer, or `SidePane` remain in Chat/Lens.
- Remaining integration dependency: root's forthcoming `PaneSplit` fixed-track correction. Re-run the deterministic suite after it lands; browser journey remains assigned to root.
