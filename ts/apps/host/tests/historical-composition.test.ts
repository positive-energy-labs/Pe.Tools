import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { afterEach, expect, test } from "vite-plus/test";
import { sourceProvenanceSchema, type Caller, type WorkKey } from "@pe/agent-contracts";
import { hostDescriptorSchema } from "@pe/host-contracts/host-descriptor";
import { nativeReadResolveEndpoint } from "../../../packages/agent-contracts/src/native-read-endpoint.ts";
import { RouteWorkspace } from "@pe/runtime";
import { historicalRoutes, hostInputGraph } from "../src/app.ts";
import { hostInputs } from "../src/host-program.ts";
import { admitBuild } from "../src/receipt-export.ts";
import { nativeCatalogIdentity, nativeInputIdentity, openRecordingWriter } from "../src/native-recording.ts";
import { admittedRequestIdentity, readSchemas, RequestIdentity } from "../src/request-services.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { threadPointerPort } from "../src/thread-pointers.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const stamp = admitBuild("host", { version: "1.0.0", build: "a".repeat(12), commit: "a".repeat(40) }, randomUUID(), randomUUID())!;
const identity = { build: JSON.stringify({ version: stamp.version, build: stamp.build, commit: stamp.commit }), catalog: nativeCatalogIdentity() };
const scope = { bridgeSessionId: "recorded-session" };
const human: Caller = { kind: "human", via: "local" };
const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
const key = "host.ops.catalog";
const bundle = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-historical-composition-")); dirs.push(dir);
  const writer = await Effect.runPromise(openRecordingWriter(dir, identity, bounds));
  const schemas = await Effect.runPromise(readSchemas(key));
  const input = { input: { kind: "native-read" as const, key, args: "{}" }, scope: JSON.stringify(scope), outputVersion: schemas.version };
  const outcome = { kind: "answered" as const, value: { operations: [], constants: {} }, answer: {
    nativeRequestId: "recorded-native", actualTarget: { processIncarnation: { pid: 7, startedAt: 1000 }, openDocumentLifetime: { kind: "session-only" as const } },
    freshness: { freshnessGeneration: "recorded:g1" }, cost: {}, nativeOutcome: "committed" as const,
  } };
  const taking = await Effect.runPromise(writer.append(input, outcome));
  return { dir, writer, taking, input, outcome };
};
const router = async (dir: string, bindings?: ReadonlyMap<string, string>) => {
  const inputs = await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: dir, at: null, bindings }));
  let liveFactories = 0;
  const graph = hostInputGraph(inputs, () => { liveFactories++; return Layer.effectDiscard(Effect.die("Live graph was constructed")); }, () => historicalRoutes(inputs));
  const web = HttpRouter.toWebHandler(graph, { disableLogger: true });
  const send = (path: string, body?: unknown, caller: Caller = human, selectedScope = scope) => web.handler(new Request(`http://host${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), Context.make(RequestIdentity, admittedRequestIdentity(caller, selectedScope)));
  return { inputs, send, close: web.dispose, liveFactories: () => liveFactories };
};

test("existing native call and resolve replay with zero live graph; provenance is bounded", async () => {
  const { dir } = await bundle(); const app = await router(dir);
  try {
    expect(app.inputs.lane.kind).toBe("recording");
    if (app.inputs.lane.kind === "recording") expect("append" in app.inputs.lane.recordingStore).toBe(false);
    const answer = await app.send("/call", { key, request: {} });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(await answer.json()).toEqual({ operations: [], constants: {} });
    expect(answer.headers.get("x-pe-native-request-id")).toBe("recorded-native");
    const resolved = await app.send(nativeReadResolveEndpoint.path, { operationKey: key, input: {} });
    expect(resolved.status, await resolved.clone().text()).toBe(200);
    expect(await resolved.json()).toMatchObject({ operationKey: key, processIncarnation: { pid: 7, startedAt: 1000 }, freshnessGeneration: "recorded:g1" });
    const features = await app.send("/pe/features");
    expect(hostDescriptorSchema.safeParse(await features.json()).success).toBe(true);
    const source = features.headers.get("x-pe-source")!;
    expect(sourceProvenanceSchema.parse(JSON.parse(source))).toEqual({ kind: "recording", at: null, ...identity, coverage: ["native"] });
    expect(source).not.toMatch(/recordingStore|captureStore|directory|append|observations/);
    expect((await app.send("/call", { key }, { kind: "pea", context: "test-context", thread: "t1" })).status).toBe(200);
    expect(app.liveFactories()).toBe(0);
  } finally { await app.close(); }
});

test("actual caller, scope, coverage, unknown and missing input refuse without live fallback", async () => {
  const { dir } = await bundle(); const app = await router(dir);
  try {
    expect((await app.send("/call", { key }, { kind: "anonymous" })).status).toBe(403);
    expect((await app.send("/call", { key, unexpected: true })).status).toBe(400);
    expect((await app.send("/call", { key }, human, { bridgeSessionId: "today" })).status).toBe(409);
    for (const [path, body, problem] of [
      ["/call", { key: "settings.schema", request: { schemaUrl: "https://example.test/schema" } }, "recording.miss"],
      ["/call", { key: "unknown.operation" }, "read.contract"],
      ["/call", { key: "ducts.snapshot.walk", request: {} }, "recording.coverage"],
      ["/fans", undefined, "recording.coverage"],
      ["/pe/route-state", undefined, "recording.coverage"],
    ] as const) {
      const response = await app.send(path, body);
      expect(response.status, await response.clone().text()).toBe(409);
      expect(await response.text()).toContain(problem);
    }
    expect(app.liveFactories()).toBe(0);
  } finally { await app.close(); }
});

test("equal takings remain ambiguous until an exact root binding is supplied", async () => {
  const { dir, writer, taking, input, outcome } = await bundle();
  await Effect.runPromise(writer.append(input, outcome));
  const ambiguous = await router(dir);
  try { expect(await (await ambiguous.send("/call", { key })).text()).toContain("recording.ambiguous"); }
  finally { await ambiguous.close(); }
  const bound = await router(dir, new Map([[await Effect.runPromise(nativeInputIdentity({ key, input: {}, scope })), taking.id]]));
  try { expect((await bound.send("/call", { key })).status).toBe(200); expect(bound.liveFactories()).toBe(0); }
  finally { await bound.close(); }
});

test("historical mutation doors refuse without append or any live graph", async () => {
  const { dir, writer } = await bundle(); const app = await router(dir);
  const before = await readdir(dir, { recursive: true });
  try {
    for (const [path, body] of [
      ["/call", { key: "ducts.apply", request: {} }],
      ["/call", { key: "scripting.execute", request: {} }],
      ["/call", { key: "revit.matrix.loaded-families", request: {} }],
      [nativeReadResolveEndpoint.path, { operationKey: "revit.matrix.loaded-families", input: {} }],
      ["/actions", { key: "families.apply.preview" }],
      ["/actions", { key: "ducts.apply-losses" }],
      ["/actions", { key: "ducts.plan-losses" }],
      ["/pe/route-state/fans/apply", { kind: "apply" }], ["/pe/route-state/fans/history", { direction: "undo" }],
      ["/pe/route-state/fans/start-fresh", {}], ["/call", { key: "pointers.point", request: {} }],
      ["/call", { key: "pointers.dismiss", request: {} }],
    ] as const) {
      const response = await app.send(path, body);
      expect(response.status, await response.clone().text()).toBe(409);
    }
    expect(await readdir(dir, { recursive: true })).toEqual(before);
    expect(writer.candidates(await Effect.runPromise(nativeInputIdentity({ key, input: {}, scope })))).toHaveLength(1);
    expect(app.liveFactories()).toBe(0);
  } finally { await app.close(); }
});

test("journal, Work and pointer owners refuse before storage or executor access", async () => {
  const { dir } = await bundle(); const inputs = await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: dir, at: null }));
  const journalPath = join(dir, "forbidden-journal.jsonl");
  const journal = new ActionJournal(journalPath, Date.now); journal.bindInputContext(inputs);
  // Policy precedes even envelope decoding: no malformed or resumed command can acquire current inputs.
  await expect(journal.invoke({ id: randomUUID(), key: "ducts.apply-losses", input: {}, target: { kind: "host" } }, { caller: human, basis: null })).rejects.toMatchObject({ problem: "recording.historical" });
  let storage = 0;
  const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => { storage++; return null; }, setState: async () => { storage++; } },
    authorizeMutation: (verb) => { const denied = inputs.check({ kind: "work", verb }); if (denied) throw denied; },
  });
  const work = { route: "/fans" } as WorkKey;
  for (const run of [
    () => workspace.apply(work, "/fans", "human", [], 0),
    () => workspace.step(work, "/fans", "human", "undo", 0),
    () => workspace.step(work, "/fans", "human", "redo", 0),
    () => workspace.publish(work, "/fans", [], 0),
    () => workspace.startFresh(work, "/fans", "human"),
    () => workspace.salvage(work, "/fans"),
  ]) await expect(Promise.resolve().then(async () => { await run(); })).rejects.toMatchObject({ problem: "recording.historical" });
  let mutations = 0; const pointers = threadPointerPort(inputs);
  pointers.bind({ read: () => ({ threadId: "t1", pointers: [] }), point: () => { mutations++; return { threadId: "t1", pointers: [] }; }, dismiss: () => { mutations++; return { threadId: "t1", pointers: [] }; } });
  expect(() => pointers.dismiss("t1", "p1")).toThrow();
  expect(() => pointers.point("t1", { route: "/fans", label: "fan", place: {} })).toThrow();
  expect(storage).toBe(0); expect(mutations).toBe(0);
  expect(await readdir(dir)).not.toContain("forbidden-journal.jsonl");
});

test("historical open creates nothing; identity and point gaps refuse; unrecorded live is explicit", async () => {
  const { dir } = await bundle(); const missing = join(dir, "missing");
  const failure = await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: missing, at: null }).pipe(Effect.flip));
  expect(failure.problem).toBe("recording.missing"); expect(await readdir(dir)).not.toContain("missing");
  expect((await Effect.runPromise(hostInputs(null, { kind: "recording", directory: dir, at: null }).pipe(Effect.flip))).problem).toBe("recording.identity");
  expect((await Effect.runPromise(hostInputs(null, { kind: "live", capture: "automatic" }).pipe(Effect.flip))).problem).toBe("recording.identity");
  expect((await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: dir, at: "point" }).pipe(Effect.flip))).problem).toBe("recording.point");
  const live = await Effect.runPromise(hostInputs(null, { kind: "live", capture: "off" }));
  expect(live.source).toEqual({ kind: "live", capturing: false });
  let built = 0; hostInputGraph(live, () => { built++; return Layer.empty; }, () => { throw Error("historical graph selected"); });
  expect(built).toBe(1);
});
