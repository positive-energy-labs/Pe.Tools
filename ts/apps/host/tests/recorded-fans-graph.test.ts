import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/http";
import { expect, test, vi } from "vite-plus/test";
import { canonicalJson, HostNativeRead } from "@pe/host-internal/native-read";
import { bindWork, address, type ReadingRequest } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { fansInputRoutes } from "../src/app.ts";
import { HostInputContext } from "../src/input-context.ts";
import { HostFiles } from "../src/host-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { admittedRequestIdentity, RequestIdentity } from "../src/request-services.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { admitNativeCaller } from "../src/native-read-policy.ts";
import { nativeCatalogIdentity, inputBindingKey, inputIdentity, openRecordingWriter, openRecordingReader,
  type HostInputLane, type Taking } from "../src/native-recording.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";

const liveFactories = vi.hoisted(() => ({ sdk: 0, bridge: 0, work: 0, recorded: false }));
vi.mock("../src/sdk-session.ts", async (original) => {
  const actual = await original<typeof import("../src/sdk-session.ts")>();
  const { Effect, Layer } = await import("effect");
  return { ...actual, SdkDriverLive: Layer.effect(actual.SdkDriver, Effect.sync(() => {
    liveFactories.sdk++; throw Error("Live SDK acquired by a recorded graph");
  })) };
});
vi.mock("../src/bridge.ts", async (original) => {
  const actual = await original<typeof import("../src/bridge.ts")>();
  const { Effect, Layer } = await import("effect");
  return { ...actual, RevitBridgeLive: Layer.effect(actual.RevitBridge, Effect.sync(() => {
    liveFactories.bridge++; throw Error("Live bridge acquired by a recorded graph");
  })) };
});
vi.mock("../src/route-document-store.ts", async (original) => {
  const actual = await original<typeof import("../src/route-document-store.ts")>();
  return { ...actual, fileRouteDocumentStore: (...args: Parameters<typeof actual.fileRouteDocumentStore>) => {
    if (liveFactories.recorded) { liveFactories.work++; throw Error("Live Work store constructed by a recorded graph"); }
    return actual.fileRouteDocumentStore(...args);
  } };
});

const source = process.env.PE_RECORDED_FANS_SNAPSHOT ?? "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";
const ref = { session: "captured-chadds", openId: "chadds-open" };
const path = address("C:/Models/Chadds.rvt");
const actualTarget = { processIncarnation: { pid: 42, startedAt: 1000 }, openDocumentLifetime: { openId: ref.openId } };
const identity = { build: "recorded-fans-graph-witness", catalog: nativeCatalogIdentity() };
const bounds = { maxBytes: 512 * 1024 * 1024, maxTakings: 2000 };
const run = Effect.runPromise;
const caller = { kind: "human" as const, via: "local" as const };
const key = (route: string) => bindWork(route, path, undefined, ref);

async function firstFrame(response: Response) {
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(); let text = "";
  try {
    while (true) {
      const read = await reader.read(); if (read.done) throw Error("Resource ended without its snapshot");
      text += new TextDecoder().decode(read.value);
      for (const line of text.split("\n")) if (line.startsWith("data:")) {
        const frame = JSON.parse(line.slice(5));
        if (frame.kind === "snapshot" || frame.kind === "failure") return frame;
      }
    }
  } finally { await reader.cancel(); }
}

test.skipIf(!existsSync(source))("real Fans roster and admitted Work resources replay without live inputs; repeated sheet basis stays ambiguous", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-fans-graph-"));
  const all: Taking[] = []; let nativeCalls = 0, poisoned = 0;
  const raw = JSON.parse(readFileSync(source, "utf8").replace(/^\uFEFF/, ""));
  const snapshot = Schema.decodeUnknownSync(Schema.Json)(raw.result ?? raw);
  await mkdir(join(dir, "catalogs")); await writeFile(join(dir, "firm.json"), JSON.stringify(FIRM_SEED));
  const writer = await run(openRecordingWriter(join(dir, "bundle"), identity, bounds));
  const inputs = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live", captureStore: writer }))));
  const native = Layer.succeed(HostNativeRead, {
    resolve: (input) => admitNativeCaller(input.key).pipe(Effect.as({ operationKey: input.key,
      ...actualTarget, ...(input.key === "ducts.tables" ? { openDocumentLifetime: { kind: "session-only" as const } } : {}),
      normalizedInput: canonicalJson(JSON.parse(JSON.stringify(input.input))), freshnessGeneration: "captured:g1", representation: "overview" as const })),
    read: (input) => admitNativeCaller(input.key).pipe(Effect.map(() => ({
      value: input.key === "ducts.tables" ? { folder: "captured-native", tables: {}, missing: (input.input as {ids:string[]}).ids, unsupported: {} } : snapshot,
      nativeRequestId: `native-${++nativeCalls}`, actualTarget: input.key === "ducts.tables" ?
        { ...actualTarget, openDocumentLifetime: { kind: "session-only" as const } } : actualTarget,
      freshness: { freshnessGeneration: "captured:g1" }, cost: {}, outcome: "committed" as const,
    }))),
  });
  const row = { ...ref, address: path };
  const livePorts = {
    native, files: HostFiles.layer({ firm: join(dir, "firm.json"), catalogs: join(dir, "catalogs") }),
    marks: Layer.succeed(HostDocumentMarks, hostMarks({ observedSince: 100, changedAt: () => 300, subscribe: () => () => {} })),
    inventory: Layer.succeed(HostSessionInventory, { document: () => Effect.succeed(row),
      session: () => Effect.succeed({ sessionId: ref.session }), attachment: () => Effect.succeed({ sessionId: ref.session }) }),
  };
  const live = HttpRouter.toWebHandler(Layer.unwrap(Effect.gen(function* () {
    yield* TestClock.setTime(200);
    return fansInputRoutes(inputs, { live: livePorts, store: fileRouteDocumentStore(join(dir, "work")),
      observed: (taking) => Effect.sync(() => { all.push(taking); }),
      initialize: async (workspace) => {
        for (const [revision, cfm] of [[0, 250], [1, 300]] as const)
          expect(await workspace.apply(key("fans"), "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm } } }], revision)).toMatchObject({ ok: true });
        expect(await workspace.apply(key("ducts"), "ducts", "human", [], 0)).toMatchObject({ ok: true });
      },
    });
  })).pipe(Layer.provide(TestClock.layer())), { disableLogger: true });
  const send = (web: typeof live, url: string, body?: unknown) => withInvocationContext({ caller, hostBaseUrl: "http://host" }, () => web.handler(new Request(`http://host${url}`, {
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), Context.make(RequestIdentity, admittedRequestIdentity(caller, { bridgeSessionId: ref.session, openDocumentId: ref.openId }))));
  const cases: { url: string; body?: any; value: any; bindings: Map<string,string>; stream?: boolean; ambiguous: string[] }[] = [];
  const dependencies = new Map<string,string>();
  const capture = async (url: string, body?: unknown, stream = false) => {
    const start = all.length; const response = await send(live, url, body);
    if (!stream) expect(response.status, await response.clone().text()).toBe(200);
    const value = stream ? await firstFrame(response) : await response.json();
    const consumed = new Map<string, Taking[]>();
    for (const taking of all.slice(start)) {
      const k = taking.input.kind === "native" ? inputIdentity(taking.input) : inputBindingKey(taking.input, taking.scope);
      consumed.set(k, [...(consumed.get(k) ?? []), taking]);
    }
    const ambiguous: string[] = [];
    for (const [k, takings] of consumed) {
      if (takings.length === 1) dependencies.set(k, takings[0]!.id);
      else { dependencies.delete(k); ambiguous.push(k); }
    }
    // Carry only previously consumed dependencies, replacing them solely with this request's
    // explicitly observed occurrence. This is a request read set, never a bundle search.
    cases.push({ url, body, value, bindings: new Map(dependencies), stream, ambiguous }); return value;
  };
  let historical: typeof live | undefined;
  try {
    const roster = await capture("/pe/ducts/roster", { target: ref });
    expect(roster.rows.length).toBeGreaterThan(0);
    const rosterCalls = nativeCalls;
    const resource: ReadingRequest = { kind: "ducts-snapshot", target: ref, selector: { kind: "roster" } };
    const envelope = await capture(`/pe/resources?keys=${encodeURIComponent(JSON.stringify([resource]))}`, undefined, true);
    expect(envelope).toMatchObject({ kind: "snapshot", changed: true, value: { state: "ready", version: expect.any(String) } });
    expect(envelope.value.version).toBe(envelope.value.revision);
    expect(nativeCalls).toBe(rosterCalls);
    const fan = roster.rows.find((row: any) => row.unitId === 14577391) ?? roster.rows[0];
    const request = { target: ref, mode: "fan", unitId: fan.unitId, portIndex: fan.portIndex };
    const overview = await capture("/pe/ducts/sheet", request);
    expect(overview.kind).toBe("overview");
    expect(cases.at(-1)!.ambiguous.length).toBeGreaterThan(0);
    const fans = builtinEnrollments.find((entry) => entry.routeKey === "fans")!;
    const fingerprint = workFingerprintSchema.parse(`builtin-closure:${fans.closure.fingerprint}`);
    for (const route of ["fans", "ducts"]) {
      const reading: ReadingRequest = { ...key(route), kind: "work", admission: { routeKey: "fans", fingerprint,
        ...(route === "ducts" ? { reading: "ductsWork" } : {}) } };
      const frame = await capture(`/pe/resources?keys=${encodeURIComponent(JSON.stringify([reading]))}`, undefined, true);
      expect(frame.kind).toBe("snapshot"); expect(frame.changed).toBe(true);
      expect(frame.value.handle.key.route).toBe(route); expect(frame.value.history).toBeDefined();
    }
    await live.dispose();
    liveFactories.recorded = true;
    const liveFiles = vi.spyOn(HostFiles, "layer").mockImplementation(() => { poisoned++; throw Error("Live file readers constructed"); });
    const reader = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
    expect(reader.truncation).toBeNull();
    const calls = nativeCalls;
    for (const recorded of cases) {
      const lane: HostInputLane = { kind: "recording", recordingStore: reader, bindings: recorded.bindings, at: null };
      const context = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer(lane))));
      // Each request has an explicit trusted read set; repeated occurrences have no guessed binding.
      historical = HttpRouter.toWebHandler(Layer.unwrap(Effect.gen(function* () {
        yield* TestClock.setTime(10000);
        return fansInputRoutes(context, { get live(): never { poisoned++; throw Error("live inputs constructed"); },
          get store(): never { poisoned++; throw Error("live Work store constructed"); }, initialize: async () => { poisoned++; throw Error("live initializer called"); } });
      })).pipe(Layer.provide(TestClock.layer())), { disableLogger: true });
      const response = await send(historical, recorded.url, recorded.body);
      if (recorded.ambiguous.length) {
        expect(response.status, await response.clone().text()).toBe(409);
        expect(await response.json()).toMatchObject({ problem: "recording.ambiguous" });
      } else {
        const provenance = JSON.parse(response.headers.get("x-pe-source")!);
        expect(provenance).toMatchObject({ kind: "recording", at: null, ...identity,
          coverage: expect.arrayContaining(["native", "document", "work", "files", "marks"]) });
        expect(JSON.stringify(provenance)).not.toContain(dir);
        const replay = recorded.stream ? await firstFrame(response) : await response.json();
        expect(replay).toEqual(recorded.value);
      }
      const refused = await send(historical, "/pe/route-state/fans/apply?open=captured-chadds/chadds-open", { patches: [], expectedRevision: 2, press: crypto.randomUUID() });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ problem: "recording.historical" });
      const missing = await send(historical, "/pe/ducts/roster", { target: { ...ref, openId: "unrecorded-open" } });
      expect(missing.status).toBe(409);
      expect(await missing.json()).toMatchObject({ problem: "recording.miss" });
      await historical.dispose(); historical = undefined;
    }
    expect(poisoned).toBe(0); expect(nativeCalls).toBe(calls);
    expect(liveFactories).toMatchObject({ sdk: 0, bridge: 0, work: 0 });
    liveFiles.mockRestore();
  } finally { vi.restoreAllMocks(); await historical?.dispose(); await live.dispose(); await rm(dir, { recursive: true, force: true }); }
}, 180000);
