# Ducts interaction performance

2026-10-22. The spatial-kit integration retained batched geometry, scoped native capture and decoded-scene caching. It lost the gesture boundary: camera changes wrote Page and the router on every movement. This reran domain projections and rebuilt UI while the renderer itself used less than 1 ms of CPU per submission.

## Changes and evidence

- [LiveOrbit](../../../ts/apps/web/src/scene/live-orbit.ts) owns the live camera shared by Scene3D and the globe. Pointer release publishes once. Wheel ticks draw immediately and publish after 150 ms without another tick. The regression test also checks that a saved echo does not reset the camera and an external move still works.
- The shared [globe](../../../ts/apps/web/src/components/lang/minimap.tsx) updates LiveOrbit and commits Page once on release. Its displacement is measured from the starting pose, so queued pointer events do not depend on React having committed the previous event. Lost pointer capture cancels the preview.
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

## Shared live camera

The first performance fix gave the renderer and Ducts globe separate transient poses. The globe could not observe canvas motion until release. The shared viewport data type did not establish shared live ownership.

`LiveOrbit` now owns one transient pose for canvas, globe and picture overlays. Page remains the committed snapshot used by history and Pea. Release saves the existing live pose without replaying it. Gesture tokens reject late input after cancellation or an external move. Commit acknowledgements cannot roll back a newer gesture. The actual Page value is tracked separately from a derived fit, so unrelated renders cannot cancel motion. `/ducts`, `/space` and the globe specimen use the same controller. Cut geometry and plane editing remain intact.

PROVEN[browser, Chrome 155 on main frontend 5175, source based on 0c311169 plus this change, 2026-10-22]: trusted 25-move globe and canvas drags on Chadds EX 2 (10 meshes), SA 7 (544 meshes), and `/space` with saved SA 7 artifact `4309a298e86718e3631ddd2f2a39cee4669a008f2416c7c43847302821af9d64` (78,202 triangles). All six drags produced 25 live pose updates, zero history writes during movement and one after release. The globe changed before canvas release. Six post-release cropped model images per drag were identical across more than one second. Twelve SA 7 wheel ticks produced twelve live updates and one history write after quiet. Space Top then 3D preserved the orbit pose. A final SA 7 repeat after the last source edits also passed both drags; a named East stop and browser Back restored the expected poses within URL precision. This proves these sampled interactions; it is not a GPU timing or universal absence-of-stalls claim. The original delayed jump was not captured before editing.

Evidence: `.artifacts/runs/live-orbit-20261022/{ex2,sa7,space}/`, trusted-input scripts and raw pose/history/image records. No Revit document mutation or session restart was performed. The T3 preview failed twice with `Preview automation snapshot timed out after 15000ms`; the owned Chrome fallback was used and stopped after proof; its registry entry is absent.

Focused scene, globe, Space and Ducts tests pass (127 passed, one skipped). The combined canvas/globe test covers both input directions, one release commit and acknowledgement without camera replay. Pure controller tests cover delayed echoes, external moves, token replacement and cancellation. Scoped format/lint/types pass. Full `pnpm verify` passed check, knip, kit build and package tests, then failed the operations catalog provenance guard because the generated catalog is stale against current .NET sources; this change modifies neither .NET nor that catalog. The isolated .NET compile stage was not reached. Selection, hover and layer latency are separate remaining work, not claimed fixed here.

## Nearest retained picking

`createMeshPicker` reads the renderer's packed float32 vertices and per-instance visibility. It uses Three's `Ray.intersectTriangle`, but keeps only the nearest hit accepted by the caller's cuts. The general `BatchedMesh.raycast` also rejects element bounds; the improvement avoids its per-instance mesh setup, unused normal/UV/face results, all-hit allocation and sorting. Bounds wholly beyond the nearest retained hit are skipped. No geometry detail is removed. This specialized path requires the renderer's static, unindexed geometry and identity instance transforms; that boundary is stated at the function.

PROVEN[browser + deterministic, Chrome 155 on main frontend 5175, e6b179ea plus picking change, 2026-10-22]: saved Chadds context `1efd1b47b493eeae5279214eafdfc5678c7036a18bd052538f6b06e5602de840`, 1,979 elements and 360,448 triangles. Across 2,904 rays (perspective and three orthographic views, visible/hidden subsets, two cut predicates and no cut), old and new pickers returned identical element keys and points within 1e-7 ft. Alternating old/new measurements in the same renderer gave 2,333.1 ms aggregate before and 1,361.5 ms after (42% less); p95 3.3 to 2.1 ms. Many grid rays miss geometry, and the clock quantizes fast samples to zero; these are not whole-click or compositor latencies. They are not directly comparable to the earlier T3 Chromium TypeGPU evaluation's 10-22 ms samples.

Trusted pointer clicks selected Pipe 14018679 on `/space` and element 12024501 on `/ducts` SA 7 (544 elements, 78,202 triangles); Ducts persisted that same ID in its URL and selected key. Deterministic tests additionally cover both face directions, an origin inside element bounds, linked identity, all-clipped results and looking past a cut front face in the same element. Focused scene/Space tests: 31 passed. Scoped format, lint and types passed. Full `pnpm verify` stops at formatting in concurrently edited `chat/composer-head.tsx` and `chat/proto-grant.tsx`; those files were untouched by this change. Evidence and reproducible scripts: `.artifacts/runs/picking-20261022/`.
