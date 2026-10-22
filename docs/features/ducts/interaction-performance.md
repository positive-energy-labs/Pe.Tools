# Ducts interaction performance

2026-10-22. The spatial-kit integration retained batched geometry, scoped native capture and decoded-scene caching. It lost the gesture boundary: camera changes wrote Page and the router on every movement. This reran domain projections and rebuilt UI while the renderer itself used less than 1 ms of CPU per submission.

## Changes and evidence

- [Scene3D](../../../ts/apps/web/src/scene/scene3d.tsx) keeps camera motion inside the renderer. Pointer release publishes once. Wheel ticks draw immediately and publish after 150 ms without another tick. The regression test also checks that a saved echo does not reset the camera and an external move still works.
- The Ducts [globe](../../../ts/apps/web/src/ducts/proto/e/canvas.tsx) previews inside the picture and commits Page once on release. Its displacement is measured from the starting pose, so queued pointer events do not depend on React having committed the previous event. Lost pointer capture cancels the preview.
- [SceneMeshes](../../../ts/apps/web/src/scene/types.ts) holds large arrays in private fields. React development prop inspection no longer enumerates the geometry.
- Captured Revit references and fan topology use indexes owned by their immutable snapshot identities. Missing references still refuse targeting; a fresh capture gets a fresh index. Applied equipment inputs use the same snapshot lifetime. Inbox projection depends on the Page fields it reads, not the camera. Chat geometry remeasures on content, mount and resize changes, not unrelated route renders.

PROVEN[browser, controlled SDK dev session `acc-orbit-perf-proof-20261022`, web changes through `b3649e92`, 2026-10-22]: native Chadds R25 copy SHA-256 `7183efe9d9272e3b592257b905601f099ead642051f5f340af56168d14dfbd2d`. The original diagnosis used the user's native EX 2 capture; the isolated proof copy draws the same 10-mesh EX 2 scope. This does not assert that both documents are identical in every other respect.

| Probe | Before | After |
| --- | --- | --- |
| EX 2 orbit, 30 moves | 30 Page/URL writes during drag; median submission gap 918 ms | 0 during, 1 after; median 33 ms |
| EX 2 wheel, 30 ticks | 30 writes; median submission gap 494 ms | 0 during, 1 after; median 50 ms, maximum 67 ms |
| SA 7 orbit, 544 meshes | No matched baseline | 0 writes during, 1 after; median submission gap 34 ms |
| Ducts globe, 30 moves | Source diagnosis only | 0 writes during, 1 after; median submission gap 33 ms |

These are render-submission intervals under injected input, not GPU completion or compositor FPS. The orbit samples retain isolated stalls: maximum gaps were 458 ms for EX 2, 246 ms for SA 7 and 517 ms for the globe. The change removes per-move route work; it does not certify a page with no long tasks.

Three rounds of search/navigation on the actual native route observed these times from Enter to the requested mesh object in the canvas:

| Search | Meshes | Observed range |
| --- | ---: | ---: |
| EX 2 | 10 | 651–883 ms |
| SA 19 | 160 | 901–1,171 ms |
| RA 1 | 302 | 733–1,357 ms |
| Element 12028215, resolved to SA 7 | 544 | 1,305–1,380 ms |

This is an upper bound from browser polling, not a matching-compositor measurement. The samples include CPU profiling and concurrent verification load. They are neither cold-start certification nor evidence of instant revisits. RA 1 retains the native capture's unavailable geometry limits; mesh count is not a completeness claim.

Two final rounds without CPU sampling, after the wheel and globe fixes, observed EX 2 at 477–509 ms, SA 19 at 981–1,208 ms, RA 1 at 733–902 ms, and ID 12028215 at 1,120–1,746 ms. The searched ID was present in the resulting SA 7 mesh set. These use a wider proof window and still overlap verification, so they are a final functional latency check, not a controlled before/after comparison.

The 355-system list was scrolled by real wheel input through 3,200 px, then EX 69 was opened by clicking its row. No Revit mutation was used.

## Remaining cost

Opening all systems still took roughly five seconds in the profiled samples. It mounts 1,229 rows, including 873 inbox rows, with many tooltip and button components. Bounding mounted rows and deferring closed-row controls is further work; reducing mesh detail will not fix it. A browser-only CSS containment trial did not establish a useful improvement and was not shipped.

The final unprofiled all-systems check took 5,338 ms to the UI observation. This remains a failed responsiveness result, despite the camera fixes.

Repeated development profiles accumulated millions of React User Timing measures. Reload between bounded trials; do not call accumulated-profiler timings production performance. The final wheel and globe claims concern gesture publication and visible camera changes, not a claim that all navigation latency is solved.

Raw traces, screenshots, scripts and the aggregate report are disposable evidence under `.artifacts/runs/orbit-diagnose-20261022/`. `proof-report.json` names each sample. Native custody, model hashes and cleanup receipts are under `.artifacts/accept/orbit-perf-proof-20261022/`.

PROVEN[deterministic + compile, `pnpm verify` including repo guards and isolated R25/R24 compile, product source `9ecf3f11`, 2026-10-22]: full chain green; warnings remain. The focused camera, minimap and Ducts run passed 117 tests with one skipped. Cleanup stopped the owned browser, both owned hosts and the controlled Revit session; the copied model hash is unchanged. No user-owned Revit process was stopped.
