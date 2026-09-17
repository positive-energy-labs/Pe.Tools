# Chat cutover report

## Checkpoint

- 2026-09-16, `unify/chat-cutover` starts at `1406e70` with a clean tree.
- Runtime seams: remove the keyed `WorkbenchProvider`; retain drafts only in `ThreadComposer` Activity children; move draft values to neutral `workbench/prompt.ts`; make one keyed current-thread view owner reset lens and World state; keep the body atom and Suspense boundary inside the transcript only.
- Deletions: the store draft atom and URL mirror, attachment object URLs and revocation effect, provider draft-clearing code, floating-composer layout code, `SidePane` imports from Chat/Lens after the foundation commit.
- Foundation incorporated through `47fd673` (including parent-sized `Surface`, headerless pane naming, keyboard tutorial, and fixed `PaneSplit` tracks). Chat composes those primitives directly; it carries no local substitute.

## Evidence

- Source and deterministic tests only until root assigns browser proof. No browser or Revit process was started or changed.
- `vp test apps/web/src/chat/manifest.test.ts apps/web/src/workbench/provider/thread-stream.test.tsx apps/web/src/chat/composer-bank.test.tsx apps/web/src/workbench/thread-view.test.tsx apps/web/src/chat/composer.test.tsx apps/web/src/workbench/lens/thread-body.test.tsx apps/web/src/workbench/store.test.ts apps/web/src/workbench/prose.test.tsx apps/web/src/readings.test.ts apps/web/src/state/atom-inspect.test.ts apps/web/src/components/lang/pane.test.tsx --run`: 53 passed. Covers wire bodies without display, delayed SSE approval and send gating, A-to-B isolation, retry/reconnect, exact failed-turn detail, equal-ready identity, composed A/B/unsent-X draft retention, late completion preservation, StrictMode owner disposal, transcript-only Suspense stability, prompt/turn navigation, Markdown, readings, inspection, and Pane behavior.
- `vp check` on the Chat/runtime cutover files passed with no warnings, lint, or type errors.
- No browser or Revit process was started. Browser proof remains root-owned.

## Current state

- Runtime/layout commits: `5658ec1`, `6345064`, `7cd5b66`, `6533201`, `fc073d7`, `47fd673`, `23dd5ad`, and `387861d`; the final state/readout polish is pending commit.
- Current cutover delta since `1406e70`: +1237/-559 lines in owned Chat/runtime paths, including accepted foundation integration.
- The persistent `WorkbenchProvider` owns the shell and Activity bank. `CurrentThreadViewOwner` now replaces only its transient owner on selection through the shared route-owner lifetime seam; it does not remount children. HTTP bodies are typed without `display`; only a current SSE frame enables send.
- No draft persistence, body DOM retention, object URLs, composer height observer, or `SidePane` remain in Chat/Lens. The parent route owns viewport height; the composer uses a deliberate in-flow Pane row under the transcript.
- Remaining integration dependency: root-owned browser journey only. No browser proof is claimed here.
