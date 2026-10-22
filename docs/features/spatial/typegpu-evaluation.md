# TypeGPU full experimental proof

2026-10-22. This report supersedes the bounded evaluation at `b50ff7d8`. The experiment is frozen; no production renderer cutover was made.

## Decision

**Do not switch the current WebGL viewer to WebGPU on the strength of these results alone, even with migration/cutover cost completely excluded.** The current saved scenes render cheaply already. TypeGPU saves roughly 0.6 ms of measured GPU time on the largest plain scene; the Three WebGPU comparator saves roughly 0.4 ms. Neither establishes a visible interaction improvement, a broader platform envelope, or a simpler complete production implementation. Picking latency is a separate CPU concern; the baseline includes the parent's nearest-hit picker.

**The TypeGPU recommendation has nevertheless changed materially:** this is a credible specialized renderer, with equivalent lighting, actual answer geometry, controls and lifecycle behavior, lower measured GPU pass cost, and a smaller loaded JavaScript closure. Rejecting it as merely an incomplete mesh demo is no longer justified. Choose it if explicit buffer ownership and a deliberately narrow spatial rendering/data pipeline are product requirements. This experiment does not establish less persistent application code or a useful CPU-returning query speedup.

Three WebGPU/TSL is a viable alternative foundation, not a demonstrated drop-in upgrade here. Its material/scene abstractions and broader renderer fallback are meaningful advantages, but the experimental comparator is not a complete production adapter. Its parity gaps are listed below. No recommendation here relies on existing investment, rewrite effort, migration risk, or cutover cost.

PROVEN[deterministic replay + real Chromium GPU execution, `.explore/typegpu/evidence/full-*.json` and scripts, copied production baseline `428a97dcb0025e4fd271eaf40b8c670afe0f7c06`, 2026-10-22]. Experimental sources are untracked/ignored on main and must be archived with their hashes; this is not a claim that their implementation lives in that baseline commit. UNPROVEN[full product equivalence, fleet support, end-to-end interaction speedup, current Revit freshness].

## Sources and preservation

All work used `C:/Users/kaitp/source/repos/Pe.Tools` on main. No production source/configuration, Revit host, or original capture was changed. The prototype is `.explore/typegpu/prototype`; raw evidence and reproduction drivers are `.explore/typegpu/evidence`. The parent is preserving these in `C:/Users/kaitp/.t3/worktrees/Pe.Tools/archive-typegpu-20261022`, branch `archive/typegpu-20261022`, base `5ca3c10a`. Archive completion and manifest belong to the parent, not this report's proof claim.

Preserve prototype source, `baseline/`, package files/lock, `public/*.bin`, and all evidence including images, scripts and historical-answer provenance. `node_modules`, `dist`, `dist-vp`, and the upstream clone can be excluded as reproducible outputs. The upstream clone was pinned at `7c853fa3a20b46050f59dd0360e21237f0debf53`. Record SHA-256 hashes when archiving; `.explore` is ignored and this documentation commit alone does not preserve the experiment.

Versions: TypeGPU 0.12.8, unplugin-typegpu 0.12.6, wgpu-matrix 3.4.0, Three 0.186.1, TypeScript 5.9.3, React 19.2.0. The isolated Vite 7.3.1 build and the checkout's Vite+ 0.2.1 / Vite 8.0.16 build both compiled and executed in the browser. Dependencies remain isolated in the prototype.

## Real input and baseline

Original PSC1 files were read-only from `C:/Users/kaitp/AppData/Local/Positive Energy/Pe.Tools/cache/space-scenes/`. Complete hashes and capture stamps are in `full-captures.json`.

| Copy | Native filename (SHA-256) | Elements | Payload triangles |
|---|---|---:|---:|
| `public/context.bin` | `1efd1b47b493eeae5279214eafdfc5678c7036a18bd052538f6b06e5602de840.bin` | 1,979 | 360,448 |
| `public/focus.bin` | `d2a254a5e203a33a2120e38aa4837d8c650a4ebcfbcaf6ea7441e17b6789166c.bin` | 160 | 25,817 |
| `public/sa7.bin` | `4309a298e86718e3631ddd2f2a39cee4669a008f2416c7c43847302821af9d64.bin` | 544 | 78,202 |

Geometry is not decimated or sampled. All paths retain the same triangle positions, face normals, ordered element identity, visibility predicates, and clipping predicates. Identity remains document/link/unique-id qualified. The captures are historical and host-only: captured `fresh:true` does not prove present freshness or linked-model behavior.

`prototype/baseline/renderer.ts` is the actual production WebGL renderer copied after the nearest-hit `createMeshPicker` change, with experimental observation hooks. Its BatchedMesh uses multi-draw; it was not replaced by an artificially slow per-element baseline. The Three WebGPU comparator instead uses a merged indexed mesh with compact visible indices: inspected Three r186 WebGPU BatchedMesh dispatches individual ranges, so using it unchanged would unnecessarily retain per-element submission.

Both WebGPU implementations compact hidden/focus/isolation indices. The one-percent context case submits only 2,098 triangles; all-hidden submits zero. This corrects the previous hidden-triangle waste. They do **not** provide BatchedMesh's per-element frustum culling; a mostly-offscreen workload is distinct and remains unmeasured.

## Feature proof and boundaries

| Area | Implemented and tested | Evidence / boundary |
|---|---|---|
| Lighting and color | Production Lambert hemisphere/directional lights, exact sRGB transfer, selection and hover colors, double-sided meshes, 4x MSAA | `gpu.ts`, `three-webgpu.ts`, actual rendered images; color-mode distinction below |
| Clipping | Three 64-point polygon extrusions, inside/outside intersection, matching CPU picks | `full-picking.json`, cut screenshots; bounded cases, not exhaustive geometry proof |
| Answers | Typed TypeGPU line, point and transparent mesh pipelines; actual native bounds, seven historical levels, three saved HIT/NEAR/CLEAR sweeps | `full-layer-check.txt`, `full-layer-browser.json`, `layers-saved.ts`; no saved real slice/probe/tree fixture was available |
| Camera | Perspective, three orthographic planes, named looks/fit, world rays/projected overlays, rebased precision | `full-camera.json`: 37,328 numeric comparisons, 14,460 projections against actual production helpers and Three |
| Input | Orbit, pan, wheel burst, pointer-centered plane zoom, touch transitions, cancellation, delayed echoes and external moves | Deterministic controls checks; actual CDP orbit/wheel/Escape/click in `full-behavior.json`; touch checked deterministically, not on physical touch hardware |
| Picking/state | Hidden, isolation, focus, selection, cuts; actual element identity retained | 8,712 rays across three captures, zero element mismatches against production `createMeshPicker`; many grid rays miss, so not exhaustive |
| Thumbnails | Three cached GPU views, same device, state invalidation | Ten orbit updates do not rebuild thumbnails; paint does; `full-behavior.json` |
| React/lifecycle | Async mount cancellation, resize, overlay alignment, coalesced redraws, idempotent disposal, device loss/error state, remount recovery | Actual browser behavior: five created/five disposed, three late async disposals; 30 invalidations become one frame |
| Build/distribution | Isolated TS/Vite and checkout Vite+ build plus actual runtime | `full-build.txt`, `full-viteplus-build.txt`, `full-viteplus-browser.json` |

The maximum perspective projection discrepancy was 1.24e-10 pixels, orthographic 1.17e-12, near-pole 5.39e-9. Moving the rebased scene origin by a billion feet produced at most 3.18e-7 pixels discrepancy. This demonstrates CPU matrix/origin handling, **not recovery of precision already lost in upstream float32 world positions**. Both renderers still consume the same native float32 geometry.

The layer differential checks cover 13 fixtures against actual production producers. The standalone GPU test verifies point coverage, depth, transparency, outside background, MSAA and resource disposal; it is not merely a count of submitted items. Full-model screenshots supplement these tests. Historical answer sources are labeled as historical, never substituted for current tool answers.

### Color parity finding

A significant early answer-layer difference was real: production WebGL blends encoded output, while the Three WebGPU output path blends in linear light. Comparing them without accounting for this would repeat the earlier unequal-shading mistake.

The candidate now has explicit modes: default production-compatible encoded blending, and `?color=linear` with sRGB render-target views and linear shader output. Against Three WebGPU, the linear candidate's context top view has mean RGB error **0.124/255** over nonbackground pixels; the answer-layer view is **0.231/255**, with **zero pixels exceeding 5/255** maximum-channel error. See `full-linear-difference.json` and `full-gpu-linear-{top,layers}.png` beside `full-three-webgpu-{top,layers}.png`.

Against production WebGL, the default candidate's top/layers/cut nonbackground mean errors are approximately 1.01/0.79/0.98 out of 255. The perspective view is less close, 6.61/255, with edge/coplanar-depth differences. This is good bounded visual correspondence, not universal pixel identity. Changing production to WebGPU's linear blend would itself be a visible color behavior change requiring a product decision.

## Render measurements

Chrome 155.0.8059.85 on this Windows machine; active reported graphics adapter AMD Radeon 890M, driver 32.0.13046.1001. WebGL is ANGLE D3D11. No other browser/GPU/driver was tested. Canvas 1,000 x 700 at DPR 1. Four warmup iterations then 30 samples per state/backend/scene. Thumbnails disabled in backend benchmarks; actual thumbnail caching checked separately. Seven states: full, focus, one-percent, hidden, inside cuts, outside cuts, real layers. Raw arrays: `full-bench-*.json`; reduction: `full-summary.json`.

| Scene/state | TypeGPU GPU median / p95 ms | Three WebGL GPU median / p95 ms | Three WebGPU GPU median / p95 ms |
|---|---:|---:|---:|
| Context, full | 0.459 / 0.852 | 1.066 / 1.272 | 0.655 / 0.786 |
| Context, real layers | 0.918 / 1.114 | 1.430 / 1.641 | 1.180 / 1.245 |
| Context, one-percent | below timestamp resolution / 0.066 | 0.172 / — | 0.066 / — |
| Focus, full | 0.066 / — | 0.212 / — | 0.197 / — |
| SA7, full | 0.197 / — | 0.411 / — | 0.262 / — |

The closer color-matched **linear TypeGPU** context rerun measured 0.459 ms full and 0.721 ms layers median, with layer p95 1.114 ms (`full-bench-gpu-linear-context.json`). Run ordering/cache variation prevents attributing the default-versus-linear timing difference to color mode itself.

Context full CPU medians/p95: TypeGPU 0.5/0.7 ms, WebGL 0.6/0.8 ms, Three WebGPU 1.0/1.3 ms. Context layer CPU medians: 0.6, 0.6, 1.25 ms respectively. These boundaries differ: the copied WebGL timer brackets rendering, while the WebGPU timers include camera/uniform preparation. Do not interpret their ratio as a clean CPU efficiency comparison.

GPU scopes also differ: Three can include background/output work outside the candidate's direct pass. WebGPU timestamps are quantized to 0.065536 ms; zero is below measurement resolution, not free execution. Completion-wall timings include different polling/mapping mechanisms and are **not user latency or FPS**. Sequential microbenchmarks do not prove whole-app responsiveness or battery benefit. An early inefficient per-box Three answer adapter was corrected to batched geometry; those earlier layer timings are excluded.

Startup observations are not clean cold-cache distributions. Context TypeGPU reported init 31.7 ms, preparation 15.9 ms, lazy unwrap 5.3 ms, first completion 42.2 ms (unwrap is included in first completion). Three WebGPU reported init 33.4, preparation 86.8, compile 82.9, first completion 24.1, total 227.5 ms. WebGL constructor time was 137 ms without an equivalent isolated driver-compilation phase. These show where work occurs; they do not establish comparable cold-start ratios.

## Compute and useful future queries

`queries.ts` implements actual typed GPU AABB overlap with full candidate indices and immutable capture provenance. The browser compared masks/indices with an independent scalar CPU oracle for all three native scenes at 1, 32 and 256 regions, cold plus five warm runs: 54 matching runs, plus seven boundary cases. See `full-queries.json` and `full-query-summary.json`.

| Context workload | Candidate pairs | CPU oracle median ms | GPU kernel median ms | Upload + dispatch wall + readback + decode median ms |
|---|---:|---:|---:|---:|
| 1 region | 1,979 | 0.1 | below resolution | 7.9 |
| 32 regions | 63,328 | 0.7 | below resolution | 7.8 |
| 256 regions | 506,624 | 5.1 | 0.066 | 8.1 |

For focus/SA7 at 256 regions the CPU medians were 0.4/1.3 ms, versus GPU-path medians 6.8/7.5 ms. Readback and scheduling dominate these sizes. **No useful speedup for queries returning these results to JavaScript was demonstrated.** Keeping masks GPU-resident for visibility, fusing queries, or reading fewer results could help, but none is a measured product gain here.

This is a broadphase, not exact clash detection, distance/sweep authority, or a freshness mechanism. Query results must retain the capture/document/link/epoch contract regardless of rendering library. Three TSL also has compute/storage/workgroup/atomic and indirect-draw facilities: compute is not an exclusive TypeGPU advantage or a reason rendering must switch first.

## Distribution, owned code, and authoring

Actual loaded JavaScript closures after native layers loaded, including the shared React harness/decoder/camera but excluding capture binaries and unused query module:

| Backend | Raw bytes | Sum gzip bytes |
|---|---:|---:|
| TypeGPU | 564,094 | 169,844 |
| Three WebGL | 1,048,094 | 287,096 |
| Three WebGPU | 1,376,720 | 392,042 |

`full-loaded-closure.json` records URLs; `full-bundle-size.json` records accounting. The TypeGPU closure contains no Three surface. These are experimental entrypoint closures, not a prediction of final production chunk savings. Shared experimental camera infrastructure is included in every backend, including the WebGL adapter.

Prettier-normalized source accounting is in `full-loc.json` with per-file hashes. Candidate core is 1,973 physical lines (renderer 535, camera 445, controls 364, GPU layers 279, layer data 350), integration/model 366, optional compute 336. Copied production reference core is 1,027; production scene React adapter/LiveOrbit/layers add 829. The broad totals 2,339 versus 1,856 are **not equal-feature product totals**: the candidate includes test UI, while the production adapter includes native observation/menu domain integration that is not ported. The reference also delegates control machinery to library code.

There is no measured equivalent-feature LOC reduction. The persistent ownership difference is concrete: TypeGPU makes camera/control/material/color/pipeline behavior application code; Three supplies more of that machinery. This is a maintenance/capability distinction, not an argument about past investment or the cost of rewriting.

TypeGPU's typed buffers and shader functions are well suited to explicit data layouts and direct GPU resource ownership; the prototype uses idiomatic typed functions rather than hand-written WGSL. The transform/build and browser validation both matter: passing TypeScript alone does not prove generated shaders, limits, bindings, disposal or driver execution. Vite+ execution closes the earlier build-system uncertainty for this isolated entrypoint, not the whole production app integration.

Observability was implemented through validation scopes, uncaptured errors, device loss, submission/visibility counters and GPU timestamps. Three additionally provides scene/material abstractions, renderer.info and shader inspection. Neither removes the need for real browser evidence. Primary source notes and exact inspected code references are in `foundations.txt`.

## Three WebGPU parity gaps and platform boundary

The Three WebGPU comparator **does prove** native geometry, production Lambert/color semantics, selection/hover state, three-axis cuts, compact hidden submission, perspective/orthographic matrices, actual layer rendering and measured GPU execution. It uses efficient merged geometry rather than relying on native BatchedMesh range loops.

It **does not prove**:

- Complete production `scene3d` integration, native observation updates, menus, or freshness/identity lifecycle under live host changes.
- Its own independent production picking/control implementation: it shares the candidate camera/picker. The production picker was independently used as the replay oracle, not swapped into a full WebGPU product adapter.
- The candidate's full DOM wheel/pan/cancel, thumbnail-cache, React race/disposal and device-loss/remount suite on the Three WebGPU backend. Those browser behavior checks target TypeGPU. Constructor error handling and disposal code are not equivalent evidence.
- Full product overlays and thumbnails on the Three WebGPU backend, per-element frustum culling parity, transparency behavior across arbitrary overlapping answers, or WebGL fallback of this storage-buffer comparator.
- Complete cold startup, final production chunk size, installed-client fleet compatibility, mobile/physical-touch behavior, or linked native captures.

The [Three WebGPU renderer documentation](https://threejs.org/manual/pages/webgpurenderer) describes WebGPU/WebGL2 fallback and TSL's shader backends. That does not make arbitrary storage/compute resource graphs portable. The [TypeGPU WebGL backend](https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-gl/) is experimental and lacks the storage/compute/bind-group capabilities used here; it cannot run this candidate unchanged.

Concrete unsupported environments for this candidate are clients without `navigator.gpu`, without an obtainable compatible adapter/device, or without required resource limits/features. Firefox and Safari are **untested here**, not categorically unsupported; see [Chrome's platform overview](https://developer.chrome.com/docs/web-platform/webgpu/overview) for the platform-dependent support boundary. Timestamp support is a measurement capability, not a reason to promise universal measurement availability.

An injected missing-WebGPU startup test was not executed: automatic approval review rejected the combined second-server/injection command with `blocked by policy`. The safer Vite+ runtime check used the existing owned server successfully. Missing-WebGPU behavior remains code-inspected rather than browser-proven; deliberate device destruction and recovery were browser-proven.

## Reproduction and handoff

Run shell commands with working directory explicitly set to `C:/Users/kaitp/source/repos/Pe.Tools`, or the parent's completed archival checkout after copying fixtures and restoring dependencies. The deterministic camera/layer checks import production reference helpers, so preserve the matching checkout revision as well as the copied baseline. Browser drivers expect their own Chrome CDP port 9351 and preview port 6195; do not attach them to another user's session.

```powershell
npm --prefix .explore/typegpu/prototype ci
npm --prefix .explore/typegpu/prototype run build
bun .explore/typegpu/prototype/camera-check.ts
bun .explore/typegpu/prototype/full-pick-check.ts
bun .explore/typegpu/prototype/layers-test.ts
node .explore/typegpu/prototype/comparator-check.mjs
```

For browser replay, start the isolated Vite preview with prototype root, host `127.0.0.1`, port 6195, strict port, and an owned Chrome debugging session on 9351. Python drivers require `websocket-client`; image metrics require Pillow/NumPy. `full-suite.py bench`, `full-visuals.py`, `full-linear.py`, `full-behavior.py`, and `full-queries.py` are the exact browser drivers. `full-metrics.py` reduces saved results; `prototype/measure-source.mjs` performs normalized LOC accounting. Review driver paths before using a different checkout. The standalone layer browser fixture uses `/public/context.bin`; its preview staging must include that alias, as recorded in the raw run.

Most useful evidence to open first:

- `evidence/full-browser-interaction.png`: actual native model, overlays and thumbnails.
- `evidence/full-gpu-linear-layers.png` and `full-three-webgpu-layers.png`: closest equal-color answer comparison.
- `evidence/full-summary.json` plus `full-bench-*.json`: summaries and raw render samples.
- `evidence/full-behavior.json`, `full-camera.json`, `full-picking.json`: behavior and differential assertions.
- `evidence/full-layer-check.txt`, `full-layer-browser.json`: production producer and GPU rendering checks.
- `evidence/full-queries.json`, `full-query-summary.json`: complete compute correctness/timing results.
- `evidence/full-viteplus-browser.json`, `full-bundle-size.json`, `full-loc.json`, `foundations.txt`: build, distribution, ownership and source grounding.

Source was frozen at the user's stop request. Own Chrome PID 38692/port 9351 and Vite preview PID 4280/port 6195 were stopped; own T3 preview tab was already closed. No user/Revit host was stopped. The parent owns archive creation/hash manifest and any TypeGPU/pathfinder Owed entry; this run does not edit the spatial ledger.
