# Space selection performance spike

2026-10-21. Saved Chadds R25 copy, exact `/ducts` system/group memberships. Browser source `62acfa96`, native source `1117da1c`; host catalog followup `b036225b` is a separate change. No main checkout changes or calls to the user's Revit process. Native session custody stayed with its owner.

## What crossed the boundary

The proof adapter forwards a trusted click in the real `/space` route to the native owner's actual `/call`, then fetches the returned content-addressed PSC1 artifact. The same trace records capture response, artifact headers/body, decode, geometry construction, render submission, GPU fence and matching compositor screenshots. The returned SHA, metadata requested IDs and rendered widget identify one selection. This adapter proves that chain; it does not prove shipped `/ducts` integration. Reproduction and raw paths are in `.artifacts/runs/browser-20261021-space/web-followup.json` in the isolated web checkout.

First SA7 capture on the native owner's fresh process, attested never to have captured or prepared Space, reached a matching compositor frame in **2089.831 ms**: 544 requested/544 mesh elements, 78,202 triangles, zero omissions. This is **one cold sample**, with the route already open. GPU fences remain separate raw events; neither a fence nor a compositor screenshot proves physical display scanout.

Three rounds each of systems and groups produced 18 native captures and 18 resident returns. Before the catalog fix, system request matching-frame maximum was 6162.814 ms; system return maximum was 100.722 ms. Group request maximum was 739.011 ms; group return maximum was 83.800 ms. Each role has nine samples per trial; nearest-rank p95 equals the maximum at this sample count. These observations do not establish repeated acceptance. The large group renders 302 meshes and explicitly lists five unavailable flex elements; it is not complete geometry for all 307 members.

The native queue was reserved, but the machine was not idle. The user's untouched Revit process consumed about 33 CPU seconds during the 30-second system trial. Record competing process CPU instead of describing this as a quiet-machine percentile. Parent independently reproduced one warm SA7 request at 995.522 ms to a matching compositor frame, with no errors.

## Why the earlier viewer was expensive

The original renderer built 1726 mesh/material objects, recomputed normals for every element and rebuilt on scene replacement. A measured four-view draw used 6921 calls. Batched geometry reduced that captured scene to 21 calls while retaining element picking, visibility and three-axis editing. Source baseline `6f66bc29` also exposed React development logging that enumerated large public typed-array props. Private resident data and stable canvas ordering avoid that enumeration and StrictMode effect reconnection on LRU reorder. These findings concern the supplied capture, not a claim about every model.

The resident cache above `SpaceCanvas` retains exact content-addressed snapshots, with at most three mounted WebGL contexts and a 512 MiB allocation estimate. The estimate includes geometry/normal/batch copies and metadata; it is not a hard RSS or VRAM limit. Inactive canvases do not animate. A resident return performs no HTTP request, decode or geometry build. A new native request retessellates; it must not be reported as a visit-cache return.

An equal native epoch does **not** prove current Revit state: the native owner found a transaction-group rollback that did not advance it. Cached content IDs remain immutable snapshots. The UI says when a snapshot was captured. A fresh system selection must use the actual returned artifact rather than resolving membership to an old SHA by epoch alone.

## Catalog prerequisite and startup limits

Primary native host log evidence for the 6162.814 ms sample shows `host.ops.catalog` from 18:16:13.470 to 18:16:18.590 (5123 ms), then `revit.detail.space-scene` for 370 ms. The full HTTP delay remains part of the selection result. Gateway `operationDefinition` previously fetched the entire live catalog on every native call. The generated contract remains contract authority; the current runtime projection does not expose a shipped metadata table suitable for replacing those checks within this bounded spike.

The host-only followup retains catalog metadata per bridge connection, invalidates on connected/disconnected events and payload/build changes, shares concurrent acquisition, retries failures and rejects late answers from superseded sockets. It retains no native response or receipt. Eligibility and request validation still execute for each call. Sixty focused tests passed, including caller carriage and read-only script/action checks. Native runtime adoption is a separate proof from this deterministic result.

Native adopted the host-only change as `b0e5133f`, keeping native `1117da1c`. Its actual nine-request HTTP proof reduced nine live catalog acquisitions to one. The final browser matrix used the same web code, three rounds each of exact systems and groups: system request matching-frame p50 483.751 ms, p95/max 2974.080 ms; group p50 334.776 ms, p95/max 562.246 ms (nine samples each). System resident return p50 81.945 ms, p95/max 109.155 ms; group p50 82.229 ms, p95/max 112.295 ms (nine each). Thus the sampled warm focus requests met 3 seconds, while the strict under-100-ms return target remains falsified. The 2974.080 ms sample includes a 2627.42 ms native HTTP delay; it is retained. Context readiness and native query preparation remain separate costs, not part of a focus-first acceptance claim.

Five additional hard reloads with real saved geometry reached the route in 2308, 2505, 2397, 2517 and 2779 ms. Navigation commands took 43–63 ms; the slowest completed module resources took 224–317 ms. The earlier 30.9/32.9-second outliers remain preserved and **unexplained**. This bounded run did not reproduce them and did not prove a startup fix. These reloads are not a fresh server/browser startup or already-open `/ducts` client navigation benchmark.

Full `pnpm verify` remains red on 56 pre-existing formatting failures outside Space. Targeted Space checks and 14 state/cache tests passed. The evidence reports retain source IDs, sample counts, CPU records, raw traces, failure cases and owned-resource receipts so later integration can test the same boundaries.
