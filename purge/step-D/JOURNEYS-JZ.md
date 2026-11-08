# JZ: Read subscription lifetime

Branch: `fix/read-capacity-lifetime`, based on `integ/round5` at `fb2ee710a59d5369769e4b77bd560c4a8f171350`.

Witness: `ts/apps/host/tests/host-read-graph.test.ts:50`, test `JZ read subscriptions reclaim capacity through release and reject released flights`.

The journey uses the public `POST /pe/reads/value` handler for reads and releases. A registered host recipe supplies controlled numeric data and one gated evaluation. No test calls `Publications` directly. The existing fixture supplies the real host routing, invocation and read-set services; it supplies controlled native inputs, without Revit.

1. Read and release 600 distinct argument keys on one subscription with increasing generations. At base, the 513th read returns HTTP 500 with `Read key capacity reached`.
2. Hold an evaluation, release its subscription, and reject the same generation as superseded.
3. Read and release 160 distinct subscription IDs while the old evaluation is held. This crosses both the live slot count and the release tombstone bound.
4. Publish the successor generation, finish the old evaluation, and verify it is superseded. Re-read the successor through the public door.
5. Share a key across two subscriptions. Release one and verify the other retains its version lineage.
6. Keep 128 subscriptions open. Refuse the 129th with `Read subscription capacity reached`. Release one and admit the previously refused subscription.

Commands run from `ts/apps/host`, sequentially, without timeout changes:

```powershell
vp test run tests/host-read-graph.test.ts -t 'JZ read subscriptions' --maxWorkers=1
vp test run tests/host-read-graph.test.ts --maxWorkers=1
```

FALSIFIED[deterministic HTTP surface, base fb2ee710 rejects ordinary released-key churn with Read key capacity reached, 2026-11-07]. Base reproducer: one failed journey, six skipped; execution 608 ms. Only the witness was added to base before this run.

The first landing, `58a8e387`, passed seven tests (11.77 s execution, 19.22 s total), but partner review found that its global eviction floor could supersede an unrelated opening pane. That landing is superseded by the exact admission fix below.

Focused guards, from `ts/tests/repo-guards`:

```powershell
vp test run --maxWorkers=1 src/host-door.guard.test.ts src/package-direction.guard.test.ts src/test-isolation.guard.test.ts src/utf8.guard.test.ts
```

Result: four files, 12 tests passed. Logs live under `.artifacts/runs/read-capacity-20261107/` in the implementation checkout; the takeover report contains the exact head SHA and copied logs.

## Exact admission witness

Witness: `ts/apps/host/tests/host-read-graph.test.ts`, test `JZ input-open admissions survive unrelated release churn`.

The journey still drives only the public read/release HTTP handler. It gates the real input service's `HostInputReadSets.open` with `vi.spyOn`, then delegates to the original implementation. It does not call Publications or admission methods.

1. Hold two subscriptions before their read sets open. Release only one.
2. Release 160 other IDs. Let both opens finish. The live subscription must publish `current`; the released subscription must return `superseded`.
3. Hold a recipe flight, release its last slot, then start another subscription for the same key. Let both independent input sets finish. The first is superseded and the late joiner is current at version 2. This proves the running key owner survived release; equal-input flight dedupe is not separately forced by this live-input journey.

```powershell
vp test run tests/host-read-graph.test.ts -t 'JZ input-open' --maxWorkers=1
vp test run tests/host-read-graph.test.ts --maxWorkers=1
```

FALSIFIED[deterministic HTTP surface, 58a8e387 returns superseded for the live opening subscription after unrelated release churn, 2026-11-07]. One failed, seven skipped; 241 ms test execution, 7.66 s total. Only the witness was added before this run.

The corrected source passes all eight tests: 10.64 s execution, 17.64 s total. The host config's existing 15 s per-test timeout remains unchanged. Exact head and stamps are in the takeover report. Logs: `exact-red.log`, `exact-green.log` under the implementation checkout's `.artifacts/runs/read-capacity-20261107/`.

The release map keeps every ID with an outstanding admission plus at most 128 recent unpinned IDs. Admissions are counted per ID before awaiting read-set open. Closing a ticket decrements only its own ID and prunes unpinned tombstones. Publication, factory failure and request finish all close tickets idempotently. There is no global eviction floor. Running evaluations also require their original slot object. Key owners remain while any flight is running and are pruned when flights settle.

New requests reusing an ID after its unpinned tombstone was evicted remain new lifetimes. Permanent replay rejection for arbitrary retired IDs is outside the accepted bounded-history contract.

UNPROVEN[native or installed behavior, arbitrary retired-ID replay protection and process heap reclamation under byte-limit stress; outside these journeys' evidence].
