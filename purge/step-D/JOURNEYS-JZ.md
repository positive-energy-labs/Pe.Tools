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

PROVEN[deterministic HTTP surface, host-read-graph.test.ts all seven tests pass on the committed branch source, fix/read-capacity-lifetime, 2026-11-07]. Final run: seven passed, test execution 11.77 s, total 19.22 s. The host config's existing 15 s per-test timeout was unchanged.

Focused guards, from `ts/tests/repo-guards`:

```powershell
vp test run --maxWorkers=1 src/host-door.guard.test.ts src/package-direction.guard.test.ts src/test-isolation.guard.test.ts src/utf8.guard.test.ts
```

Result: four files, 12 tests passed. Logs live under `.artifacts/runs/read-capacity-20261107/` in the implementation checkout; the takeover report contains the exact head SHA and copied logs.

The release map holds at most 128 IDs. Admission captures its release sequence before awaiting read-set open. Eviction advances a scalar floor, so an admission older than a discarded release fence fails closed. Evaluations already running require the original slot object and cannot publish into a replacement slot. An unrelated admission delayed across enough releases can also be superseded conservatively. New requests reusing an ID after its tombstone was evicted are new lifetimes; permanent replay rejection for arbitrary retired IDs is not provided by this bounded history. The journey proves a running flight across eviction, not a read-set-open stall across eviction.

UNPROVEN[native or installed behavior, arbitrary retired-ID replay protection, byte-limit stress and a controlled read-set-open stall; outside this journey's evidence].
