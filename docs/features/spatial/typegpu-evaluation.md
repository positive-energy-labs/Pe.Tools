# TypeGPU cutover evaluation

2026-10-22. **Reject an immediate production cutover. Keep the current Three.js backend.**

The requested decision was whether an idiomatic TypeGPU implementation could replace the real spatial renderer with less code and better performance. The experiment renders saved Chadds geometry successfully and shows lower GPU pass times for a simpler material. It does not establish an equivalent-feature code reduction or an end-to-end product improvement. Those are the adoption criteria, so the prototype is not a ready replacement.

PROVEN[isolated browser and deterministic replay, saved Chadds PSC1, baseline main `0c311169acd693c1803679183cc09578ad838b34`, 2026-10-22]: typed shaders, native mesh rendering, element identity, clipping, CPU intersection and resource teardown work within the limits below. UNPROVEN[full production feature parity, installed browser fleet, fresh Revit state, equivalent-feature speedup]. No Revit operation or production source/configuration change was made. Parent camera work landed separately in `ed78ad3f`; `renderer.ts` stayed unchanged. The candidate does not integrate the new `LiveOrbit` owner.

## Sources and exact versions

Official upstream is cloned at `.explore/typegpu/upstream`, commit `7c853fa3a20b46050f59dd0360e21237f0debf53`. Published packages used: `typegpu@0.12.8`, `unplugin-typegpu@0.12.6`, `wgpu-matrix@3.4.0`. The comparison uses `three@0.186.1`, matching this checkout's catalog. Prototype TypeScript is 5.9.3. Dependencies are pinned in `.explore/typegpu/prototype/package-lock.json`.

Grounding was the upstream `apps/typegpu-docs/src/examples/rendering/phong-reflection`, `rendering/two-boxes`, `common/setup-orbit-camera.ts`, `rendering/jelly-slider/slider.ts`, and documentation source under `src/content/docs`. Relevant current official pages were also opened on the web:

- [Getting started](https://docs.swmansion.com/TypeGPU/getting-started/) and [build plugin](https://docs.swmansion.com/TypeGPU/tooling/unplugin-typegpu/): shader authoring uses a build transform. This is an added toolchain requirement, not a replacement for TypeScript validation.
- [Pipelines](https://docs.swmansion.com/TypeGPU/apis/pipelines/): resource realization is lazy; first drawing or unwrapping can pay shader/pipeline setup cost.
- [Timestamp queries](https://docs.swmansion.com/TypeGPU/advanced/timestamp-queries/): `withPerformanceCallback` reports GPU timestamps when the device enables `timestamp-query`. Upstream labels this timing API experimental.
- [WebGL backend](https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-gl/): experimental, partial API; it does not support storage buffers, compute shaders or bind groups. This candidate uses storage buffers, so that package is **not its fallback**.
- [Chrome's WebGPU overview](https://developer.chrome.com/docs/web-platform/webgpu/overview): support depends on browser, OS and GPU capabilities. A successful local Chromium run does not establish deployment support.

## Actual data, not a demo mesh

Originals were read from `C:/Users/kaitp/AppData/Local/Positive Energy/Pe.Tools/cache/space-scenes/` and left unchanged. Copies live in the prototype's `public/` folder.

- Context: `1efd1b47b493eeae5279214eafdfc5678c7036a18bd052538f6b06e5602de840.bin`, 14,129,784 bytes, 1,979 elements, **360,448 payload triangles**, 160 focus elements. Captured 2026-10-22T16:21:27.9591286Z.
- Focus: `d2a254a5e203a33a2120e38aa4837d8c650a4ebcfbcaf6ea7441e17b6789166c.bin`, 1,024,272 bytes, 160 elements, 25,817 triangles. Captured 2026-10-22T16:21:28.5646073Z.

Both stamps name the detached `MEP_YoramLePairArchitects_ChaddsFord_R25_standalone_20261019.rvt`, epoch 0, frame `host-internal-ft`. These are immutable historical captures, not claims about current model freshness. The context source inventory says 389,085 triangles and 1,419 skipped elements; that is not the rendered payload count and was not substituted for it.

Both browser paths hash the complete PSC1 bytes. The decoder retains the original positions and ordered element ranges. GPU positions use the same float32 subtraction of the bounds centre as the existing renderer; no decimation, vertex welding, triangle omission, or identity remapping to bare element IDs is used. Identity remains `[documentKey, linkInstanceId, uniqueId]`. The tested captures contain host elements; linked-element rendering semantics have not been behavior-tested.

## What was built and what remains different

The self-contained package is `.explore/typegpu/prototype`. `gpu.ts` uses `tgpu.vertexFn`, `tgpu.fragmentFn`, typed storage buffers, uniforms and `createRenderPipeline`; there is no hand-written WGSL. A single draw reads the original unindexed triangles plus a vertex-to-element index buffer. `camera.ts` uses `wgpu-matrix`, not Three.js. Three.js is loaded only by the separate baseline path and the deterministic reference test.

Implemented and exercised:

- Mesh depth testing, double-sided faces, 4-sample MSAA, context/focus color distinction, per-element selection color and visibility.
- All three 64-point even-odd polygon extrusions: XY, minus-X/Z, YZ, with keep-inside/keep-outside flags and intersection semantics. Clipping occurs per fragment without changing the stored geometry. CPU picks apply the same cut predicate and search through discarded hits.
- Perspective and three orthographic views, world-to-screen projection, screen rays, exact triangle intersections, and element identity on picks.
- Explicit resize, redraw invalidation, buffer/texture/root disposal, and an explicit error if WebGPU initialization fails. Device loss is recorded and stops drawing.

`check.ts` compares 24 fixed native-scene ray/cut combinations against Three.js `BatchedMesh` intersections using the same ray, with matching element identity and a 0.002-foot point tolerance. It also checks hidden-element rejection, binary hash, identity uniqueness and malformed/truncated input rejection. This is a bounded replay, not exhaustive geometry validation.

Browser image-readback probes observed 39,516 non-background pixels in the top context view, 6,264 in focus-only state, zero when all elements were hidden, 4,364 with three inside cuts, and 20,949 with three outside cuts. Selection changed pixel colors without changing coverage. These probes supplement the intersection checks; pixel counts alone do not prove all clip boundary cases. A direct canvas readback image is `.explore/typegpu/evidence/context.jpg`.

Still missing or different from production:

- Material parity: the candidate uses derivative flat normals, a simple diffuse term and approximate gamma; production uses Three.js Lambert shading, hemisphere/directional lights and its color management. The images are not equivalent.
- `Layer3D.build(THREE.Group)` and the producers in `space/layers.ts`: lines, points, transparent meshes, levels, slices, probes and sweeps. No compatibility shim or hidden second renderer was added.
- Axis thumbnails and their caching; full fit/named-look behavior; complete OrbitControls input behavior, touch and gesture cancellation; exact pointer-centred plane zoom; production selection/hover/isolation semantics and DOM/Revit menu ownership. Prototype buttons and mouse controls exercise the backend but do not replace these contracts.
- Async mount cancellation, resize observation, error presentation after device loss, recovery policy and full React/`LiveOrbit` integration. Manual resize/dispose was tested; those lifecycle integrations were not.
- The candidate submits hidden triangles and discards their fragments. It does not yet implement the existing batch's visible draw ranges/culling behavior. Large mostly-hidden models could therefore reverse its measured advantage.
- CPU camera matrices use float32 math. At one central perspective hit the two camera constructions differed by about 0.012 feet, although same-ray triangle results agreed. Exact production projection behavior must be retained or re-proved before integration.

These omissions are costs, not LOC wins.

## Measurements and their limits

Browser: T3 Code Nightly, Electron 44.4.5, Chromium 152.0.7977.130, Windows, AMD Radeon 890M/RDNA 3. WebGL reported ANGLE D3D11; WebGPU reported AMD/RDNA 3. Both had GPU timer support. Backend-only runs used 1000 x 700 canvases, matched orbit angles/distance and 40 sequential samples after an initial draw. Timings include instrumentation. They are not frame-rate measurements or product interaction latency.

Production Vite-build medians:

- Context TypeGPU: **0.600 ms CPU submission, 0.655 ms GPU pass**. Three.js: **0.900 ms CPU submission, 2.037 ms GPU elapsed**. An earlier development run measured Three.js at 0.800/1.191 ms and TypeGPU at 0.500/0.655 ms. This variation is why no fixed speedup ratio is claimed.
- Focus TypeGPU: **0.650 ms CPU submission, 0.066 ms GPU pass**. Three.js: **0.500 ms CPU submission, 0.295 ms GPU elapsed**. WebGPU timestamps were visibly quantized in 0.065536-ms steps.
- Three.js rendered both payloads in **one draw call**, with the full payload triangle count and `WEBGL_multi_draw` available. A per-element draw-call baseline would have been misleading.

TypeGPU timing uses actual GPU timestamps. Three.js timing uses `EXT_disjoint_timer_query_webgl2`, discards disjoint results, and polls completion with a bounded loop. Neither is inferred from JavaScript submission time. These APIs do not necessarily delimit identical driver work, and the shaders differ. The results show potential for this narrower renderer; they do not isolate a TypeGPU-inherent speed advantage.

Startup is not free. The first observed TypeGPU context run took 299 ms for adapter/device initialization, 21 ms preparation, 30 ms synchronous pipeline unwrap, and 368 ms from unwrap start through the first completed submission. Later production context samples had 57–204 ms init, 18–45 ms preparation and 101–103 ms first-submission completion. The production Three.js sample took 409 ms construction plus 52 ms first draw/`gl.finish`. Focus measured 181 + 3 + 119 ms for TypeGPU versus 119 + 19 ms for Three.js. These are individual observations with shared driver caches and different work boundaries, not a cold-start distribution. `unwrapMs` includes shader generation/driver setup; isolated shader compiler time was not measured.

The first CPU picker allocated vectors per triangle and took 97–127 ms. Element bounds reduced this to about 26–60 ms. Replacing per-triangle allocations with scalar intersection arithmetic reduced warm picks to **2.3–5.4 ms**, with a 20-ms first call. The matching central Three.js perspective pick measured 10.2–21.7 ms. This improvement is CPU code and can be implemented without TypeGPU. It is not evidence for changing the graphics API.

Resize 1000x700 → 640x480 → 1000x700 and explicit drawing after disposal produced no WebGPU validation errors; drawing after disposal made zero new submissions. The hidden T3 tabs did not service ordinary RAF callbacks reliably. Thus manual submission/lifecycle behavior is tested, but the zero idle-frame observation is **not** proof of foreground redraw scheduling or gesture responsiveness. Two `preview_snapshot` attempts failed with `Preview automation snapshot timed out after 15000ms.` The image was inspected through canvas readback instead; no compositor/frame-presentation latency is claimed.

## Code size and distribution

There is **no measured equivalent-feature LOC reduction**. The full replacement was deliberately not finished once the benefit failed to justify migration. The following numbers expose the boundary rather than estimate missing code:

- After applying the same Prettier 3.6.2 formatter, candidate `gpu.ts` + `camera.ts` are 428 physical lines. Baseline `renderer.ts` + `projection.ts` + `picking.ts` are 614 lines, including three experiment-only instrumentation lines. The apparent 183-line reduction excludes the parity gaps above and is not an adoption benefit.
- Candidate decoder/geometry preparation adds 106 lines, and the browser harness adds 159. Baseline orbit and plane helpers add 271, types/contracts add 90. Helpers and route adapters cannot be deleted merely because a smaller backend omits their behavior. `scene3d.tsx`, the parent's `LiveOrbit`, and layer producers are outside these backend counts.
- Existing source-level interfaces expose `THREE.Camera`, `BatchedMesh`, `OrbitControls`, and `THREE.Group`. Replacing the import in `renderer.ts` cannot remove Three.js from the shipped app. A complete equivalent-feature delta would need to include those callers and the added backend/input/layer implementations. Claiming a numerical full-product reduction now would invent evidence.

Isolated build evidence is positive. `tsc --noEmit` and Vite 7.3.1 build passed. The checkout's actual `vite-plus@0.2.1` executable also built the isolated package with Vite 8.0.16/Rolldown; native exit code was 0. Its minified output rendered the focus capture with no WebGPU validation errors. The first PowerShell pipeline reported a native stderr warning as an error; a redirected invocation confirmed the actual exit code. No shared config or lockfile was changed. This is compatibility with the small isolated config, not a full production build/plugin-order proof.

Using that Vite+ output and Node zlib's default gzip settings, the candidate's loaded JS closure is **339,465 raw / 95,700 gzip bytes**. The baseline closure is **594,002 raw / 150,278 gzip bytes**. HTML and binary geometry are excluded. Both closures include the same harness/decoder; resource inspection confirmed that the candidate loaded no Three.js chunk. The apparent saving is 254,537 raw / 54,578 gzip bytes for an incomplete feature set. If the current Three.js layers remain, adding this backend adds its bundle instead of realizing that saving.

TypeGPU still generates/resolves shader code and creates GPU resources at runtime. The build plugin does not make browser shader compilation disappear. Its current official documentation says Vite/Rollup and Babel are actively maintained/tested; other exported bundler adapters have more limited stability. This experiment used the Vite adapter successfully under both builders.

WebGPU worked in this one browser/device configuration. Installed Edge/PWA, other GPUs, remote/virtualized desktops, Safari and Firefox were not tested. Keep an explicit unsupported/error state unless those target environments are verified. `@typegpu/gl` cannot silently rescue this storage-buffer design; preserving support would require a second implementation or a different resource design and renewed parity tests.

## Agent authoring experience and decision

Writing the typed shaders was tractable with current upstream source open. The first TypeScript failure was an invalid spread into `d.mat4x4f`; `mat4.copy(source, d.mat4x4f())` fixed it. There were no runtime shader-generation or WGSL-validation revisions for the mesh/three-axis polygon shaders. Other revisions fixed isolated-baseline package imports, a guessed nonexistent `fitOrbit` helper, and Node types for the test script. The expensive revisions were ordinary renderer engineering: allocation-heavy CPU picking, camera precision, lifecycle contracts and parity accounting. Agent productivity is demonstrated for this bounded backend, not for automatic full migration.

The current backend already batches meshes and redraws on change. TypeGPU can make custom GPU compute, indirect/culling workflows and typed shader authoring more direct, but none of those capabilities is needed to solve the measured route/camera work. Removing state publication churn, repeated geometry preparation, allocations or unnecessary redraws benefits either backend. The existing [viewer performance research](viewer-performance.md) and parent's `LiveOrbit` fix address different costs from the GPU passes measured here.

Stop at rejection: do not change production imports, dependencies or package configuration. Reconsider only when a concrete GPU-bound workload remains after app-side bottlenecks are removed, or a required compute feature warrants the additional renderer ownership. Any future adoption gate must include matching material/clip/pick output, layers/thumbnails/input semantics, projection precision, device-loss behavior, target browser support, and end-to-end measurements. This prototype is a reproducible experiment, not a backend to ship.

## Evidence and reproduction

Everything below is under the main checkout; `.explore` is ignored and intentionally not promoted as product code:

- `.explore/typegpu/prototype/`: source, lockfile, copied read-only baseline, saved capture copies, standalone Vite config. `npm ci`, `npm run build`, `bun check.ts`; `npm run dev` binds only 127.0.0.1:6193. `npx vite preview --host 127.0.0.1 --port 6194 --strictPort` serves the build. `?backend=three&scenePerf` selects baseline; `?scene=focus` selects the smaller capture. Stop these servers after the run.
- `.explore/typegpu/evidence/source-hashes.json`: SHA-256 for experiment sources; `formatted-loc.json`, `size.json`, `viteplus-size.json`: explicit size boundaries.
- `evidence/initial.json`, `gpu-context.json`, `three-context.json`, `production-context.json`, `production-three-context.json`, `production-focus.json`, `production-three-focus.json`: raw samples, stamps, versions and timing phases. `production-context.json` predates only the final CPU picker allocation fix; shaders did not change.
- `evidence/final-lifecycle.json`, `pixels.json`, `features.json`, `deterministic.json`, `viteplus-browser.json`: behavioral checks and their limits. `candidate-probe.js` and `three-probe.js` retain browser measurement expressions. `context.jpg` is a direct canvas image, not a T3 screenshot.
- `evidence/compile-1.txt`, `compile-2.txt`, `build-1.txt`, `build-2.txt`, `build-final.txt`, `vite-plus-build.txt`: failures and successful build revisions.

No PR was created. Only this research decision is intended for a durable commit. The parent owns any one-line integration into the spatial ledger. Experimental servers and browser tabs are retired at handoff; original captures and the user's runtime are untouched.
