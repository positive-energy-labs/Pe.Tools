# Chat cutover report

## Checkpoint

- 2026-09-16, `unify/chat-cutover` starts at `1406e70` with a clean tree.
- Runtime seams: remove the keyed `WorkbenchProvider`; retain drafts only in `ThreadComposer` Activity children; move draft values to neutral `workbench/prompt.ts`; make one keyed current-thread view owner reset lens and World state; keep the body atom and Suspense boundary inside the transcript only.
- Deletions: the store draft atom and URL mirror, attachment object URLs and revocation effect, provider draft-clearing code, floating-composer layout code, `SidePane` imports from Chat/Lens after the foundation commit.
- Foundation incorporated through `47fd673` (including parent-sized `Surface`, headerless pane naming, keyboard tutorial, and fixed `PaneSplit` tracks). Chat composes those primitives directly; it carries no local substitute.

## Evidence

- Source and deterministic tests only until root assigns browser proof. No browser or Revit process was started or changed.
- `vp test apps/web/src/chat/manifest.test.ts apps/web/src/workbench/provider/thread-stream.test.tsx apps/web/src/chat/composer-bank.test.tsx apps/web/src/workbench/thread-view.test.tsx apps/web/src/chat/composer.test.tsx apps/web/src/workbench/lens/thread-body.test.tsx apps/web/src/workbench/store.test.ts apps/web/src/workbench/prose.test.tsx apps/web/src/readings.test.ts apps/web/src/state/atom-inspect.test.ts apps/web/src/components/lang/pane.test.tsx --run`: 54 passed. Covers wire bodies without display, delayed SSE approval and send gating, A-to-B isolation, retry/reconnect, exact failed-turn detail, equal-ready thread-body projection identity, composed A/B/unsent-X draft retention through plugin open/close, local composer halo/card keys without duplicate Enter dispatch or IME/Shift+Enter regression, late completion preservation, StrictMode owner disposal, transcript-only Suspense stability, prompt/turn navigation, Markdown, readings, inspection, and Pane behavior.
- `vp check` on the Chat/runtime cutover files passed with no warnings, lint, or type errors.
- No browser or Revit process was started. Browser proof remains root-owned.

## Current state

- Runtime/layout commits: `5658ec1`, `6345064`, `7cd5b66`, `6533201`, `fc073d7`, `47fd673`, `23dd5ad`, `387861d`, `8786ca8`, `1176706`, and `46c6a30`.
- Current owned Chat/runtime delta since `1406e70`: +1242/-676 lines.
- The persistent `WorkbenchProvider` owns the shell and Activity bank. `CurrentThreadViewOwner` now replaces only its transient owner on selection through the shared route-owner lifetime seam; it does not remount children. HTTP bodies are typed without `display`; only a current SSE frame enables send.
- The identity check above is only for an unchanged ready thread-body projection. Equal shared-readings heartbeat identity is receipts-owned after its `useHostCall` correction and is not claimed by this lane.
- No draft persistence, body DOM retention, object URLs, composer height observer, or `SidePane` remain in Chat/Lens. The parent route owns viewport height; the composer uses a deliberate auto-height in-flow Pane row under the transcript. The nested plugin split stays mounted; its absent end is `null`, so the incoming root PaneSplit null-side commit supplies the zero track, gutter, and handle.
- The headerless composer Pane now lives with each retained `ThreadComposer`, so its focused halo/card registers the real local Enter send and slash-menu actions. Textarea Enter remains native because shared Pane hotkeys ignore input elements; IME composition and Shift+Enter stay local to the textarea.
- Remaining integration dependencies: root's PaneSplit null-side commit and its geometry/browser journey; the independently owned `composer-head.tsx` lane still owns the Situation thread picker and shared-rail head treatment. No browser proof is claimed here.
