import { mkdir, mkdtemp, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import { RevitBridge } from "../src/bridge.ts";
import { NativeReads } from "../src/native-reads.ts";
import { prepareRead } from "../../../packages/host-internal/src/read-admission.ts";
import { detachedBridge, effectTest } from "./effect-test.ts";
import { CurrentInputConsumption, HostInputReadSets, type InputConsumption } from "../src/input-occurrence.ts";
import { HttpRouter } from "effect/http";
import { afterEach, expect, test } from "vite-plus/test";
import { addressSchema, NATIVE_BODY_VERSION_HEADER, DUCTS_REFRESH_HEADER } from "@pe/agent-contracts";
import { canonicalJson, HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import { admittedRequestIdentity, RequestIdentity } from "../src/request-services.ts";
import { admitNativeCaller } from "../src/native-read-policy.ts";
import { hostNativeReadFor, inputBindingKey, nativeInputIdentity, nativeCatalogIdentity,
  openRecordingWriter, openRecordingReader, type HostInputLane, type Taking } from "../src/native-recording.ts";
import { createDuctsBodyBasis, ductBodySubject } from "../src/ducts-body-basis.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { retainedDuctsRead } from "../src/call-route.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { httpProblems } from "../src/http-problems.ts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";

const run = Effect.runPromise;
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const identity = { build: "retained-basis-test", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 20_000_000, maxTakings: 100 };
const scope = { bridgeSessionId: "bridge-a", openDocumentId: "open-a" };
const ref = { session: scope.bridgeSessionId, openId: scope.openDocumentId };
const input: NativeReadInput = { key: "ducts.snapshot.roster", input: { selector: { kind: "roster" } }, scope };
const actualTarget = { processIncarnation: { pid: 42, startedAt: 1000 }, openDocumentLifetime: { openId: ref.openId } };
const row = { ...ref, address: addressSchema.parse("C:/HVAC.rvt") };
const value = Schema.decodeUnknownSync(Schema.Json)(snapshot);
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), "pe-retained-basis-")); dirs.push(dir); return dir; };
const producer = (counts: { reads: number }) => Layer.succeed(HostNativeRead, {
  resolve: (request) => admitNativeCaller(request.key).pipe(Effect.as({ operationKey: request.key, ...actualTarget,
    normalizedInput: canonicalJson(JSON.parse(JSON.stringify(request.input))), freshnessGeneration: "g1", representation: "overview" as const })),
  read: (request) => admitNativeCaller(request.key).pipe(Effect.map(() => ({ value, nativeRequestId: `native-${++counts.reads}`,
    actualTarget, freshness: { freshnessGeneration: "g1" }, cost: {}, outcome: "committed" as const }))),
});
const inventory = Layer.succeed(HostSessionInventory, {
  list: () => Effect.die("inventory not requested"), subscribe: () => () => {},
  attachment: () => Effect.succeed({ sessionId: ref.session }), session: () => Effect.succeed({ sessionId: ref.session }),
  document: () => Effect.succeed(row),
});
function router(lane: HostInputLane, owner: DuctsReadings, counts: { reads: number },
  observed: (taking: Taking) => Effect.Effect<void> = () => Effect.void,
  consumer?: { current: InputConsumption | undefined }) {
  const basis = createDuctsBodyBasis(lane, observed)!;
  const live = lane.kind === "recording" ? Layer.effect(HostNativeRead, Effect.die("Live native factory constructed")) : producer(counts);
  const docs = lane.kind === "recording" ? HostSessionInventory.recorded(lane.recordingStore, lane.bindings) :
    lane.kind === "live" && lane.captureStore ? HostSessionInventory.capturing(lane.captureStore, observed).pipe(Layer.provide(inventory)) : inventory;
  const web = HttpRouter.toWebHandler(HttpRouter.add("POST", "/call", (req) => Effect.gen(function* () {
    const documents = yield* HostSessionInventory;
    const read = retainedDuctsRead(owner, input,
      { version: req.headers[NATIVE_BODY_VERSION_HEADER], refresh: req.headers[DUCTS_REFRESH_HEADER] },
      { document: documents.document, basis });
    // The caller's own retained-call child, provided as the request's consumption (Sol wires this).
    return yield* (consumer?.current ? Effect.provideService(read, CurrentInputConsumption, consumer.current) : read);
  })).pipe(Layer.provide(httpProblems), HttpRouter.provideRequest(Layer.mergeAll(
    hostNativeReadFor(lane, live, basis.observed), docs))), { disableLogger: true });
  return { close: web.dispose, post: (headers: Record<string, string> = {}, anonymous = false) => web.handler(
    new Request("http://host/call", { method: "POST", headers }), Context.make(RequestIdentity,
      admittedRequestIdentity(anonymous ? { kind: "anonymous" } : { kind: "human", via: "local" }, scope))) };
}
async function captured(maxTakings = 100, observer?: (taking: Taking) => Effect.Effect<void>) {
  const dir = await temp(); const writer = await run(openRecordingWriter(dir, identity, { ...bounds, maxTakings }));
  const takes: Taking[] = []; const counts = { reads: 0 }; const owner = new DuctsReadings();
  const web = router({ kind: "live", captureStore: writer }, owner, counts, (taking) =>
    Effect.sync(() => { takes.push(taking); }).pipe(Effect.andThen(observer?.(taking) ?? Effect.void)));
  return { dir, writer, takes, counts, owner, web };
}
const bindings = async (takes: Taking[]) => {
  const map = new Map<string, string>();
  for (const taking of takes) {
    const key = taking.input.kind === "native" ? await run(nativeInputIdentity(input)) : inputBindingKey(taking.input, taking.scope);
    if (map.has(key)) throw Error("Witness read set needs an explicit occurrence");
    map.set(key, taking.id);
  }
  return map;
};

effectTest("an overlapping acquisition keeps its own body after its peer publishes; later readers retain the winner", () => Effect.gen(function* () {
  const owner = new DuctsReadings();
  const subject = ductBodySubject(input);
  const secondReady = yield* Deferred.make<void>();
  const secondEntered = yield* Deferred.make<void>();
  const acquired = (id: string) => ({ value, nativeRequestId: "joined-native", nativeTakingId: id,
    target: { session: ref.session, document: row.address, documentRef: ref } });
  const consumed: string[] = [];
  const second = yield* owner.read(subject, Deferred.succeed(secondEntered, undefined).pipe(
    Effect.andThen(Deferred.await(secondReady)), Effect.as(acquired("second"))), {
    source: { beforeReady: (body) => Effect.sync(() => { consumed.push(body.nativeTakingId!); }) },
  }).pipe(Effect.forkScoped);
  yield* Deferred.await(secondEntered);
  const first = yield* owner.read(subject, Effect.succeed(acquired("first")));
  expect(first.nativeTakingId).toBe("first");
  yield* Deferred.succeed(secondReady, undefined);
  const late = yield* Fiber.join(second);
  expect(consumed).toEqual(["second"]);
  expect(late.nativeTakingId).toBe("second");
  expect(late.reused).toBe(false);
  const retained = yield* owner.read(subject, Effect.die("A retained hit must not acquire"));
  expect(retained).toMatchObject({ nativeTakingId: "first", version: first.version, reused: true });
  owner.changed({ kind: "event", sessionId: ref.session, eventName: "document-changed",
    payloadJson: JSON.stringify({ changedOpenIds: [ref.openId] }) });
  const stale = yield* owner.read(subject, Effect.die("A stale version must not acquire"), { version: first.version }).pipe(Effect.result);
  expect(Result.isFailure(stale)).toBe(true);
}));

effectTest("overlapping HTTP retained readers share one dispatch and link only their own taking", () => Effect.gen(function* () {
  const dir = yield* Effect.promise(temp);
  const writer = yield* openRecordingWriter(dir, identity, bounds);
  const lane = { kind: "live", captureStore: writer } as const;
  const basis = createDuctsBodyBasis(lane)!;
  const nativeReady = yield* Deferred.make<void>();
  const indexed = yield* Deferred.make<void>();
  const ownTakings = new Map<string, string>();
  let dispatches = 0;
  const bridge = detachedBridge({ invokeHandle: (_key, _input, _session, _open, requestId) => Effect.sync(() => {
    dispatches++;
    return { answer: Deferred.await(nativeReady).pipe(Effect.as({ value, nativeRequestId: requestId!, actualTarget,
      freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" as const }, cost: {}, outcome: "native-acknowledged" as const })),
      terminal: Deferred.await(nativeReady).pipe(Effect.as("native-acknowledged" as const)) };
  }) });
  const services = yield* Layer.build(NativeReads.layer.pipe(Layer.provide(Layer.succeed(RevitBridge, bridge))));
  const reads = Context.get(services, NativeReads);
  const prepared = yield* prepareRead({ operationKey: input.key, operation: { key: input.key, intent: "Read" },
    ...actualTarget, freshnessGeneration: "g1", representation: "overview", responseSchemaVersion: "1" },
    { selector: { kind: "roster" } }, Schema.Json, Schema.Json);
  const live = Layer.succeed(HostNativeRead, {
    resolve: () => Effect.succeed({ operationKey: input.key, ...actualTarget,
      normalizedInput: canonicalJson(input.input), freshnessGeneration: "g1", representation: "overview" as const }),
    read: () => reads.join(prepared, ref.session),
  });
  // Both exact takings must be indexed before either link: choosing first/latest cannot pass.
  const observed = (taking: Taking) => basis.observed(taking).pipe(Effect.andThen(Effect.gen(function* () {
    if (taking.input.kind !== "native") return;
    const consumer = yield* Effect.serviceOption(CurrentInputConsumption);
    if (consumer._tag === "None") return yield* Effect.die("Native capture lost its reader");
    ownTakings.set(consumer.value.id, taking.id);
    if (ownTakings.size === 2) yield* Deferred.succeed(indexed, undefined);
    yield* Deferred.await(indexed);
  })));
  const sets = Context.get(yield* Layer.build(HostInputReadSets.layer(lane)), HostInputReadSets);
  const root = yield* sets.open({ key: "joined-retained", input: {}, scope: canonicalJson(scope) }, null);
  yield* Effect.addFinalizer(() => root.close);
  const children = [0, 1].map(() => {
    const child = root.child({ key: "ducts.retained", input: { key: input.key }, scope: canonicalJson(scope) });
    if (Result.isFailure(child)) throw child.failure;
    return child.success;
  });
  const owner = new DuctsReadings();
  const web = HttpRouter.toWebHandler(HttpRouter.add("POST", "/call", (req) => {
    const consumer = children.find((child) => child.id === req.headers["x-test-reader"])!;
    return retainedDuctsRead(owner, input, {}, { document: () => Effect.succeed(row), basis }).pipe(
      Effect.provideService(CurrentInputConsumption, consumer));
  }).pipe(Layer.provide(httpProblems), HttpRouter.provideRequest(hostNativeReadFor(lane, live, observed))), { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(web.dispose));
  const reader = (consumer: InputConsumption) => Effect.promise(() => web.handler(new Request("http://host/call", {
    method: "POST", headers: { "x-test-reader": consumer.id },
  }), Context.make(RequestIdentity, admittedRequestIdentity({ kind: "human", via: "local" }, scope)))).pipe(
    Effect.flatMap((response) => Effect.promise(async () => {
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get("x-pe-ducts-reused")).toBe("false");
      expect(await response.json()).toEqual(value);
      return { reader: consumer.id, request: response.headers.get("x-pe-native-request-id") };
    })));
  const pending = yield* Effect.all(children.map(reader), { concurrency: "unbounded" }).pipe(Effect.forkScoped);
  while ((yield* reads.retained).joiners !== 2 || dispatches === 0) yield* Effect.yieldNow;
  expect(dispatches).toBe(1);
  yield* Deferred.succeed(nativeReady, undefined);
  const results = yield* Fiber.join(pending);
  expect(writer.capture.truncated()).toBeNull();
  expect(ownTakings.size).toBe(2);
  expect(new Set(results.map((entry) => entry.request)).size).toBe(1);
  yield* root.seal;
  const recorded = yield* openRecordingReader(dir, identity, bounds);
  for (const entry of results) {
    const stored = yield* recorded.readSets.get(entry.reader);
    expect(stored.state).toBe("complete");
    const own = ownTakings.get(entry.reader);
    expect(stored.takingLinks.native).toBe(own);
    expect(stored.inputs.filter((item) => item.input.kind === "native").map((item) => item.takingId)).toEqual([own]);
    const basisTaking = stored.inputs.find((item) => item.input.kind === "document" && item.input.scope.includes("ducts-body-basis"))!;
    expect(yield* recorded.observation(recorded.taking(basisTaking.takingId)!)).toMatchObject({ nativeTakingId: own });
  }
}));

test("same retained handler captures miss/hit and replays original version, native taking, target and reuse without live construction", async () => {
  const c = await captured();
  const first = await c.web.post(); expect(first.status, await first.clone().text()).toBe(200);
  const firstSet = [...c.takes]; const firstBindings = await bindings(firstSet);
  const version = first.headers.get(NATIVE_BODY_VERSION_HEADER)!;
  expect(first.headers.get("x-pe-native-body-version"), "the producer publishes the generic wire header").toBe(version);
  const hit = await c.web.post({ [NATIVE_BODY_VERSION_HEADER]: version });
  expect(hit.status).toBe(200); expect(hit.headers.get("x-pe-ducts-reused")).toBe("true");
  expect(c.counts.reads).toBe(1);
  const hitSet = c.takes.slice(firstSet.length);
  expect(hitSet).toHaveLength(1); // basis only: the original native/document acquisition is retained
  const secondBindings = new Map(firstBindings); for (const [key, id] of await bindings(hitSet)) secondBindings.set(key, id);
  const basisTakes = c.takes.filter((taking) => taking.input.kind === "document" && taking.input.scope.includes("ducts-body-basis"));
  expect(basisTakes).toHaveLength(2);
  const originals = await Promise.all(basisTakes.map((taking) => run(c.writer.observation(taking))));
  expect(originals[0]).toEqual(originals[1]); expect(JSON.stringify(originals)).not.toContain('"nodes"');
  expect(originals[0]).toMatchObject({ version, nativeRequestId: "native-1",
    nativeTakingId: firstSet.find((taking) => taking.input.kind === "native")!.id, target: { documentRef: ref } });
  await c.web.close();
  const reader = await run(openRecordingReader(c.dir, identity, bounds)); const owner = new DuctsReadings(); const counts = { reads: 0 };
  for (const [index, selected] of [firstBindings, secondBindings].entries()) {
    const web = router({ kind: "recording", recordingStore: reader, at: null, bindings: selected }, owner, counts);
    try {
      const answer = await web.post(); expect(answer.status, await answer.clone().text()).toBe(200);
      expect(answer.headers.get(NATIVE_BODY_VERSION_HEADER)).toBe(version);
      expect(answer.headers.get("x-pe-native-request-id")).toBe("native-1");
      expect(answer.headers.get("x-pe-resolved-session")).toBe(ref.session);
      expect(answer.headers.get("x-pe-ducts-reused")).toBe(String(index > 0));
      expect(await answer.json()).toEqual(await first.clone().json());
      expect((await web.post({ [DUCTS_REFRESH_HEADER]: version })).status).toBe(409);
      expect((await web.post({}, true)).status).toBe(403);
    } finally { await web.close(); }
  }
  expect(counts.reads).toBe(0);
  const unbound = new Map(firstBindings); unbound.delete(inputBindingKey(basisTakes[0]!.input, basisTakes[0]!.scope));
  const web = router({ kind: "recording", recordingStore: reader, at: null, bindings: unbound }, new DuctsReadings(), counts);
  try { expect(await (await web.post()).text()).toContain("recording.ambiguous"); } finally { await web.close(); }
});

test("full native or basis capture stops recording but preserves the live miss and later retained hit", async () => {
  for (const max of [0, 2]) {
    const c = await captured(max);
    try {
      const answer = await c.web.post(); expect(answer.status, await answer.clone().text()).toBe(200);
      expect(c.writer.capture.truncated()?.reason).toBe("full");
      const count = c.takes.length;
      const hit = await c.web.post(); expect(hit.status).toBe(200); expect(hit.headers.get("x-pe-ducts-reused")).toBe("true");
      expect(c.counts.reads).toBe(1); expect(c.takes).toHaveLength(count);
    } finally { await c.web.close(); }
  }
});

test("admitted stale validation keeps its typed refusal through capture, cold replay, full and I/O loss", async () => {
  let original: unknown;
  for (const mode of ["record", "full", "io"] as const) {
    const c = await captured(mode === "full" ? 3 : 100);
    try {
      const first = await c.web.post(); expect(first.status).toBe(200);
      const version = first.headers.get(NATIVE_BODY_VERSION_HEADER)!;
      const before = c.takes.length;
      expect((await c.web.post({}, true)).status).toBe(403);
      expect(c.takes).toHaveLength(before); // admission denies before any basis capture
      c.owner.changed({ kind: "event", sessionId: ref.session, eventName: "document-changed",
        payloadJson: JSON.stringify({ changedOpenIds: [ref.openId] }) });
      if (mode === "io") {
        await rename(join(c.dir, "takings.jsonl"), join(c.dir, "saved-takings.jsonl"));
        await mkdir(join(c.dir, "takings.jsonl"));
      }
      const refused = await c.web.post({ [NATIVE_BODY_VERSION_HEADER]: version });
      expect(refused.status).toBe(409);
      const problem = await refused.json(); expect(problem.problem).toBe("read.retained");
      if (mode === "record") original = problem; else expect(problem).toEqual(original);
      expect(c.counts.reads).toBe(1);
      if (mode !== "record") {
        expect(c.writer.capture.truncated()?.reason).toBe(mode === "full" ? "full" : "io");
        expect((await c.web.post()).status).toBe(200); // capture loss cannot break fresh acquisition
        continue;
      }
      const failed = c.takes.slice(before);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.outcome).toMatchObject({ kind: "refused", failure: { tag: "InvalidRequest", problem: "read.retained" } });
      const reader = await run(openRecordingReader(c.dir, identity, bounds));
      const counts = { reads: 0 };
      const cold = router({ kind: "recording", recordingStore: reader, at: null, bindings: await bindings(failed) }, new DuctsReadings(), counts);
      try {
        const replay = await cold.post({ [NATIVE_BODY_VERSION_HEADER]: version });
        expect(replay.status).toBe(409); expect(await replay.json()).toEqual(problem);
        expect((await cold.post({}, true)).status).toBe(403);
      } finally { await cold.close(); }
      expect(counts.reads).toBe(0);
    } finally { await c.web.close(); }
  }
});

test("document invalidation during durable basis observation never publishes ready", async () => {
  const gate = Promise.withResolvers<void>(); let pending = false;
  const c = await captured(100, (taking) => taking.input.kind === "document" && taking.input.scope.includes("ducts-body-basis")
    ? Effect.promise(() => { pending = true; return gate.promise; }) : Effect.void);
  const frames: string[] = []; const stop = c.owner.observe(ductBodySubject(input), (frame) => frames.push(frame.state));
  try {
    const answer = c.web.post(); await expect.poll(() => pending).toBe(true);
    expect(frames, JSON.stringify(c.writer.capture.truncated())).not.toContain("ready");
    c.owner.changed({ kind: "event", sessionId: ref.session, eventName: "document-changed", payloadJson: JSON.stringify({ changedOpenIds: [ref.openId] }) });
    expect(frames.at(-1), JSON.stringify(frames)).toBe("stale");
    gate.resolve();
    expect((await answer).status).toBe(409); expect(frames).not.toContain("ready");
  } finally { gate.resolve(); stop(); await c.web.close(); }
});

test("foreign native binding, corrupt basis target/version and missing basis refuse without acquisition", async () => {
  const c = await captured();
  try {
    expect((await c.web.post()).status).toBe(200);
    const selected = await bindings(c.takes);
    const basisTaking = c.takes.find((taking) => taking.input.kind === "document" && taking.input.scope.includes("ducts-body-basis"))!;
    const original = await run(c.writer.observation(basisTaking));
    const nativeKey = await run(nativeInputIdentity(input));
    for (const corrupt of [
      (v: any) => { v.nativeTakingId = basisTaking.id; },
      (v: any) => { v.target.documentRef.openId = "foreign"; },
      (v: any) => { v.version = ""; },
      (v: any) => { v.native.scope = "{}"; },
    ]) {
      const changed = structuredClone(original); corrupt(changed);
      const taking = await run(c.writer.append({ input: basisTaking.input, scope: basisTaking.scope, outputVersion: basisTaking.outputVersion },
        { kind: "observed", value: changed }));
      const bound = new Map(selected); bound.set(inputBindingKey(taking.input, taking.scope), taking.id);
      const reader = await run(openRecordingReader(c.dir, identity, bounds));
      const web = router({ kind: "recording", recordingStore: reader, at: null, bindings: bound }, new DuctsReadings(), { reads: 0 });
      try { const response = await web.post(); expect(response.status).toBe(409); expect(await response.text()).toContain("recording.mismatch"); }
      finally { await web.close(); }
    }
    const reader = await run(openRecordingReader(c.dir, identity, bounds));
    const foreign = new Map(selected); foreign.set(nativeKey, basisTaking.id);
    const web = router({ kind: "recording", recordingStore: reader, at: null, bindings: foreign }, new DuctsReadings(), { reads: 0 });
    try { expect((await web.post()).status).toBe(409); } finally { await web.close(); }
    const empty = await temp(); const writer = await run(openRecordingWriter(empty, identity, bounds));
    const native = c.takes.find((taking) => taking.input.kind === "native")!;
    if (native.outcome.kind !== "answered") throw Error("Missing answered fixture dependency");
    const { observation: _, kind: __, ...answer } = native.outcome;
    const copied = await run(writer.append({ input: native.input, scope: native.scope, outputVersion: native.outputVersion },
      { kind: "answered", value: await run(c.writer.observation(native)), answer }));
    const missing = router({ kind: "recording", recordingStore: await run(openRecordingReader(empty, identity, bounds)), at: null,
      bindings: new Map([[nativeKey, copied.id]]) }, new DuctsReadings(), { reads: 0 });
    try { expect(await (await missing.post()).text()).toContain("recording.miss"); } finally { await missing.close(); }
    const conflictOwner = new DuctsReadings();
    const seeded = router({ kind: "recording", recordingStore: reader, at: null, bindings: selected }, conflictOwner, { reads: 0 });
    try {
      const good = await seeded.post(); expect(good.status).toBe(200);
      expect((await seeded.post({ [NATIVE_BODY_VERSION_HEADER]: "foreign-version" })).status).toBe(409);
      await expect(run(conflictOwner.read(ductBodySubject(input), Effect.die("must not acquire"),
        { source: { revision: "conflicting-original" } }))).rejects.toMatchObject({ problem: "recording.mismatch" });
    } finally { await seeded.close(); }
  } finally { await c.web.close(); }
});

test("I/O loss after native capture marks incomplete and still serves the live body", async () => {
  let dir = "";
  const c = await captured(100, (taking) => taking.input.kind === "native"
    ? Effect.promise(async () => { await rename(join(dir, "observations"), join(dir, "saved-observations")); await writeFile(join(dir, "observations"), "blocked"); }) : Effect.void);
  dir = c.dir;
  try {
    const answer = await c.web.post(); expect(answer.status, await answer.clone().text()).toBe(200);
    expect(c.writer.capture.truncated()?.reason).toBe("io");
    expect((await c.web.post()).status).toBe(200); expect(c.counts.reads).toBe(1);
  } finally { await c.web.close(); }
});

test("invalidation during deferred basis capture fences ready publication", async () => {
  const owner = new DuctsReadings({ entries: 2, bytes: 1_000_000, idleMs: 1000 });
  const gate = Promise.withResolvers<void>(); const frames: string[] = [];
  const subject = ductBodySubject(input); const stop = owner.observe(subject, (frame) => frames.push(frame.state));
  const result = run(owner.read(subject, Effect.succeed({ value, nativeRequestId: "fenced-native", target: {
    session: ref.session, document: row.address, documentRef: ref,
  } }), { source: { beforeReady: () => Effect.promise(() => gate.promise) } }));
  const refused = expect(result).rejects.toMatchObject({ status: 409 });
  try { await expect.poll(() => frames.includes("loading")).toBe(true); owner.refresh(ref); gate.resolve(); await refused; expect(frames).not.toContain("ready"); }
  finally { gate.resolve(); stop(); }
});

test("retained calls in their own child contexts link the original native taking; replay needs no bindings", async () => {
  const dir = await temp(); const writer = await run(openRecordingWriter(dir, identity, bounds));
  const takes: Taking[] = []; const counts = { reads: 0 }; const consumer = { current: undefined as InputConsumption | undefined };
  const web = router({ kind: "live", captureStore: writer }, new DuctsReadings(), counts,
    (taking) => Effect.sync(() => { takes.push(taking); }), consumer);
  const sets = Context.get(await run(Effect.scoped(Layer.build(HostInputReadSets.layer({ kind: "live", captureStore: writer })))), HostInputReadSets);
  const recipe = { key: "ducts.sheet", input: { fan: "F-1" }, scope: canonicalJson(ref) };
  const retained = (role: string) => ({ key: "ducts.retained", input: { key: input.key, role }, scope: canonicalJson(scope) });
  const root = await run(sets.open(recipe, null));
  const child = (role: string) => { const made = root.child(retained(role)); if (Result.isFailure(made)) throw made.failure; return made.success; };
  consumer.current = child("acquire");
  const first = await web.post(); expect(first.status, await first.clone().text()).toBe(200);
  const version = first.headers.get(NATIVE_BODY_VERSION_HEADER)!;
  consumer.current = child("validate");
  const hit = await web.post({ [NATIVE_BODY_VERSION_HEADER]: version });
  expect(hit.headers.get("x-pe-ducts-reused")).toBe("true");
  await run(root.seal); await web.close();
  const native = takes.filter((taking) => taking.input.kind === "native");
  expect(native).toHaveLength(1); // the hit added no native taking
  const reader = await run(openRecordingReader(dir, identity, bounds));
  const stored = await run(reader.readSets.get(root.id));
  const children = await Promise.all(stored.children.map((entry) => run(reader.readSets.get(entry.readSetId))));
  expect(children.map((entry) => entry.takingLinks.native)).toEqual([native[0]!.id, native[0]!.id]);
  const basisIds = children.map((entry) => entry.inputs.find((item) => item.input.kind === "document")!.takingId);
  expect(new Set(basisIds).size).toBe(2);
  // Replay: the same consumers, no binding map, no live factory.
  const lane = { kind: "recording", recordingStore: reader, at: null } as const;
  const historical = Context.get(await run(Effect.scoped(Layer.build(HostInputReadSets.layer(lane)))), HostInputReadSets);
  const replayedRoot = await run(historical.open(recipe, root.id));
  const replayCounts = { reads: 0 }; const replayed = { current: undefined as InputConsumption | undefined };
  const again = router(lane, new DuctsReadings(), replayCounts, undefined, replayed);
  try {
    for (const role of ["acquire", "validate"]) {
      const made = replayedRoot.child(retained(role)); if (Result.isFailure(made)) throw made.failure;
      replayed.current = made.success;
      const answer = await again.post(role === "validate" ? { [NATIVE_BODY_VERSION_HEADER]: version } : {});
      expect(answer.status, await answer.clone().text()).toBe(200);
      expect(answer.headers.get(NATIVE_BODY_VERSION_HEADER)).toBe(version);
    }
  } finally { await again.close(); }
  expect(replayCounts.reads).toBe(0);
});

test("a cold hit-only child selects its stored native link for resolve and read; a foreign link refuses", async () => {
  const dir = await temp(); const writer = await run(openRecordingWriter(dir, identity, bounds));
  const takes: Taking[] = []; const consumer = { current: undefined as InputConsumption | undefined };
  const web = router({ kind: "live", captureStore: writer }, new DuctsReadings(), { reads: 0 },
    (taking) => Effect.sync(() => { takes.push(taking); }), consumer);
  const sets = Context.get(await run(Effect.scoped(Layer.build(HostInputReadSets.layer({ kind: "live", captureStore: writer })))), HostInputReadSets);
  const recipe = { key: "ducts.sheet", input: { fan: "F-1" }, scope: canonicalJson(ref) };
  const retained = (role: string) => ({ key: "ducts.retained", input: { key: input.key, role }, scope: canonicalJson(scope) });
  const root = await run(sets.open(recipe, null));
  const child = (consumption: InputConsumption, role: string) => {
    const made = consumption.child(retained(role)); if (Result.isFailure(made)) throw made.failure; return made.success;
  };
  consumer.current = child(root, "acquire");
  const first = await web.post(); const version = first.headers.get(NATIVE_BODY_VERSION_HEADER)!;
  consumer.current = child(root, "validate");
  expect((await web.post({ [NATIVE_BODY_VERSION_HEADER]: version })).headers.get("x-pe-ducts-reused")).toBe("true");
  await run(root.seal); await web.close();
  const reader = await run(openRecordingReader(dir, identity, bounds));
  const lane = { kind: "recording", recordingStore: reader, at: null } as const;
  const historical = Context.get(await run(Effect.scoped(Layer.build(HostInputReadSets.layer(lane)))), HostInputReadSets);
  // Only the hit-only child, cold: a fresh owner must acquire, from the original native taking.
  const replayedRoot = await run(historical.open(recipe, root.id));
  child(replayedRoot, "acquire");
  const counts = { reads: 0 }; const replayed = { current: child(replayedRoot, "validate") };
  const cold = router(lane, new DuctsReadings(), counts, undefined, replayed);
  try {
    const answer = await cold.post();
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(answer.headers.get(NATIVE_BODY_VERSION_HEADER)).toBe(version);
    expect(answer.headers.get("x-pe-native-request-id")).toBe("native-1");
    expect(await answer.json()).toEqual(await first.clone().json());
  } finally { await cold.close(); }
  expect(counts.reads).toBe(0);
  // A forged child whose native link names a taking of another input refuses; nothing is chosen instead.
  const stored = await run(reader.readSets.get(root.id));
  const validate = await run(reader.readSets.get(stored.children[1]!.readSetId));
  const foreign = takes.find((taking) => taking.input.kind !== "native")!;
  const forged = { ...validate, id: crypto.randomUUID(), takingLinks: { native: foreign.id } };
  const again = await run(openRecordingWriter(dir, identity, bounds));
  await run(again.readSets.keep(forged));
  const forgedReader = await run(openRecordingReader(dir, identity, bounds));
  const forgedLane = { kind: "recording", recordingStore: forgedReader, at: null } as const;
  const forgedSets = Context.get(await run(Effect.scoped(Layer.build(HostInputReadSets.layer(forgedLane)))), HostInputReadSets);
  const bad = router(forgedLane, new DuctsReadings(), counts, undefined,
    { current: await run(forgedSets.open(forged.recipe, forged.id as never)) });
  try {
    const refused = await bad.post();
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("recording.mismatch");
  } finally { await bad.close(); }
  expect(counts.reads).toBe(0);
});
