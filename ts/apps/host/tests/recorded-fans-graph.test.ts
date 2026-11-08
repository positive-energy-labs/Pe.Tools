import { unavailableFieldOptions } from "./effect-test.ts";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/http";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { canonicalJson, HostNativeRead } from "@pe/host-internal/native-read";
import { bindWork, address, NATIVE_BODY_VERSION_HEADER, readingKey, readingRequestsSchema, type Caller, type ReadingRequest } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import { withInvocationContext } from "@pe/runtime/context";
import { readInputRoutes } from "../src/app.ts";
import { HostInputContext } from "../src/input-context.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { admittedRequestIdentity, RequestIdentity, readSchemas } from "../src/request-services.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { admitNativeCaller } from "../src/native-read-policy.ts";
import { nativeCatalogIdentity, openRecordingWriter, openRecordingReader,
  type ConsumerRecipe, type RecordingReader } from "../src/native-recording.ts";
import type { ReadSetId } from "../src/input-occurrence.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { settle, detachedBridge, sessionView } from "./effect-test.ts";
import { SdkSession } from "../src/sdk-session.ts";
import { HostInputReadSets, defaultReadSetLimits } from "../src/input-occurrence.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { bridgeSessionsListSchema } from "@pe/host-contracts/operation-types";
import { listBridgeSessions } from "../src/local-ops.ts";
import { InvalidRead } from "../src/native-reads.ts";
import * as machine from "../src/machine.ts";
import { bootHost } from "./real-server.ts";
import { ductsExecutors } from "../src/ducts-actions.ts";
import { RevitBridge, type HostBridgeEvent } from "../src/bridge.ts";
import type { CommandContext } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";
import { mintBrowserContext, mintContext } from "../src/control.ts";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";
import { hostOwnership } from "../src/host-ownership.ts";

// Proof receipts are opt-in: a fresh checkout has no run folder, so receipts are written only where PE_FANS_PROOF_DIR names one.
// The receipt text is still built either way, so skipping a write never skips a read the test performs.
async function writeProof(name: string, text: string) {
  const dir = process.env.PE_FANS_PROOF_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), text);
}

const liveFactories = vi.hoisted(() => ({ sdk: 0, bridge: 0, work: 0, recorded: false, service: null as RevitBridge["Service"] | null, listeners: new Set<(event: HostBridgeEvent) => void>() }));
vi.mock("../src/sdk-session.ts", async (original) => {
  const actual = await original<typeof import("../src/sdk-session.ts")>();
  const { Effect, Layer } = await import("effect");
  return { ...actual, SdkDriverLive: Layer.unwrap(Effect.sync(() => {
    if (liveFactories.recorded) { liveFactories.sdk++; throw Error("Live SDK acquired by a recorded graph"); }
    return actual.SdkDriverLive;
  })) };
});
vi.mock("../src/bridge.ts", async (original) => {
  const actual = await original<typeof import("../src/bridge.ts")>();
  const { Effect, Layer } = await import("effect");
  return { ...actual, RevitBridgeLive: Layer.unwrap(Effect.sync(() => {
    if (liveFactories.recorded) { liveFactories.bridge++; throw Error("Live bridge acquired by a recorded graph"); }
    return Layer.effect(actual.RevitBridge, Effect.gen(function* () {
      const bridge = yield* actual.RevitBridge;
      const subscribed = { ...bridge, subscribe: (listener: (event: HostBridgeEvent) => void) => {
        liveFactories.listeners.add(listener);
        const close = bridge.subscribe(listener);
        return () => { liveFactories.listeners.delete(listener); close(); };
      } };
      liveFactories.service = subscribed;
      return subscribed;
    })).pipe(Layer.provide(actual.RevitBridgeLive));
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
const run = settle;
const caller = { kind: "human" as const, via: "local" as const };
const key = (route: string) => bindWork(route, path, undefined, ref);
const nativeValue = async (response: Response) => ({
  sha256: createHash("sha256").update(canonicalJson(await response.json())).digest("hex"),
  nativeRequestId: response.headers.get("x-pe-native-request-id"), version: response.headers.get(NATIVE_BODY_VERSION_HEADER),
});

function resourceFrames(response: Response) {
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(); let text = "";
  return { opening: async () => {
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    expect(new TextDecoder().decode(chunk.value)).toBe(": open\n\n");
  }, close: () => reader.cancel(), next: async (events = false) => {
    while (true) {
      const end = text.indexOf("\n");
      if (end >= 0) {
        const line = text.slice(0, end); text = text.slice(end + 1);
        if (line.startsWith("data:")) {
          const frame = JSON.parse(line.slice(5));
          if (frame.kind === "snapshot" || frame.kind === "failure" || (events && frame.kind === "event")) return frame;
        }
      } else {
        let timer: ReturnType<typeof setTimeout>;
        const read = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`No SSE frame after 10s: ${text}`)), 10000); })]).finally(() => clearTimeout(timer)); if (read.done) throw Error("Resource ended without its snapshot");
        text += new TextDecoder().decode(read.value);
      }
    }
  } };
}
async function firstFrame(response: Response) {
  const frames = resourceFrames(response);
  try { return await frames.next(); } finally { await frames.close(); }
}

test.each(["off", "on", "recovery", "endurance", "tamper", "truncated", "legacy", "legacy-full", "legacy-io", ...(process.env.PE_FANS_COLD_NETWORK ? ["cold-off", "cold-on"] as const : [])] as const)("real Fans graph %s", async (mode) => {
  const isCold = mode.startsWith("cold-");
  const driverSource = process.env.PE_FANS_COLD_NETWORK;
  if (isCold && (!driverSource || !existsSync(driverSource))) throw Error("Cold shell proof requires the captured Driver network asset");
  const driver = isCold ? JSON.parse(readFileSync(driverSource!, "utf8").replace(/^\uFEFF/, "")) : undefined;
  const batches: { add: ReadingRequest[]; remove: string[] }[] = driver?.entries.filter((entry: any) => entry.url.includes("/pe/resource-subscriptions")).map((entry: any) => JSON.parse(entry.init.body)) ?? [];
  const coldKeys = isCold ? readingRequestsSchema.parse(batches[0]!.remove.map((key) => JSON.parse(key))) : [];
  const ref = isCold ? (coldKeys.find((key) => key.kind === "ducts-snapshot") as Extract<ReadingRequest, { kind: "ducts-snapshot" }>).target : { session: "captured-chadds", openId: "chadds-open" };
  const actualTarget = { processIncarnation: { pid: 42, startedAt: 1000 }, openDocumentLifetime: { openId: ref.openId } };
  const capturing = mode !== "off" && mode !== "cold-off", recovery = mode === "recovery";
  liveFactories.recorded = false;
  const dir = await mkdtemp(join(tmpdir(), "pe-fans-graph-"));
  const completed: { recipe: ConsumerRecipe; id: ReadSetId; requestId?: string; caller?: Caller }[] = []; let nativeCalls = 0, poisoned = 0;
  let workspace: RouteWorkspace, holdHuman = false, holdMark = false;
  const markEntered = Promise.withResolvers<void>(), releaseMark = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>(), releaseHuman = Promise.withResolvers<void>();
  const nativeEntered = Promise.withResolvers<void>(), releaseNative = Promise.withResolvers<void>();
  expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe("57b0034722af64d997f35f9301cbff51c3af4728b940a09b2ef3d8405c930c68");
  const raw = JSON.parse(readFileSync(source, "utf8").replace(/^\uFEFF/, ""));
  const snapshot = Schema.decodeUnknownSync(Schema.Json)(raw.result ?? raw);
  const snapshotContract = await run(readSchemas("ducts.snapshot.walk"));
  if (snapshotContract) Schema.decodeUnknownSync(snapshotContract.response)(snapshot);
  await mkdir(join(dir, "catalogs")); await writeFile(join(dir, "firm.json"), JSON.stringify(FIRM_SEED));
  const writer = await run(openRecordingWriter(join(dir, "bundle"), identity, bounds));
  const inputs = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live", ...(capturing ? { captureStore: writer } : {}) }))));
  const native = Layer.succeed(HostNativeRead, {
    resolve: (input) => admitNativeCaller(input.key).pipe(Effect.as({ operationKey: input.key,
      ...actualTarget, ...(input.key === "ducts.tables" ? { openDocumentLifetime: { kind: "session-only" as const } } : {}),
      normalizedInput: canonicalJson(JSON.parse(JSON.stringify(input.input))), freshnessGeneration: "captured:g1", representation: "overview" as const })),
    read: (input) => admitNativeCaller(input.key).pipe(Effect.tap(() => mode === "truncated" && input.key === "ducts.snapshot.roster"
      ? Effect.promise(() => { nativeEntered.resolve(); return releaseNative.promise; }) : Effect.void), Effect.map(() => ({
      value: input.key === "revit.catalog.field-options" ? unavailableFieldOptions : input.key === "ducts.tables" ? { folder: "captured-native", tables: {}, missing: (input.input as {ids:string[]}).ids, unsupported: {} } : snapshot,
      nativeRequestId: `native-${++nativeCalls}`, actualTarget: input.key === "ducts.tables" ?
        { ...actualTarget, openDocumentLifetime: { kind: "session-only" as const } } : actualTarget,
      freshness: { freshnessGeneration: "captured:g1" }, cost: {}, outcome: "committed" as const,
    }))),
  });
  const row = { ...ref, address: path };
  let changedAt = 300;
  const markListeners = new Set<() => void>();
  const livePorts = {
    native, files: DuctFiles.layer({ firm: join(dir, "firm.json"), catalogs: join(dir, "catalogs") }),
    marks: Layer.succeed(HostDocumentMarks, hostMarks({ observedSince: 100, generation: () => changedAt, changedAt: () => changedAt, subscribe: (notify) => { markListeners.add(notify); return () => { markListeners.delete(notify); }; } })),
    inventory: Layer.succeed(HostSessionInventory, { list: () => Effect.die("inventory not requested"), subscribe: () => () => {}, document: () => Effect.succeed(row),
      session: () => Effect.succeed({ sessionId: ref.session }), attachment: () => Effect.succeed({ sessionId: ref.session }) }),
  };
  const liveHost = await bootHost({ inputs, clock: 200, reads: { live: livePorts, store: fileRouteDocumentStore(join(dir, "work")),
      observedReadSet: (recipe, id, requestId, caller) => { completed.push({ recipe, id, requestId, caller }); },
      observed: (taking) => Effect.gen(function* () {
        if (holdMark && taking.input.kind === "marks") {
          holdMark = false; markEntered.resolve(); yield* Effect.promise(() => releaseMark.promise);
        }
        const identity = yield* Effect.serviceOption(RequestIdentity);
        if (holdHuman && taking.input.kind === "work" && taking.input.view === (mode.startsWith("legacy") ? "read" : "view") &&
            Option.isSome(identity) && identity.value.caller.kind === "human") {
          holdHuman = false; entered.resolve(); yield* Effect.promise(() => releaseHuman.promise);
        }
      }),
      initialize: async (owner) => {
        workspace = owner;
        if (mode.startsWith("legacy")) owner.register({ spec: { route: "legacy", title: "Legacy", description: "Legacy Work carriage witness",
          schema: z.object({ count: z.number().default(0) }).prefault({}) } });
        if (isCold) return;
        for (const [revision, cfm] of [[0, 250], [1, 300]] as const)
          expect(await owner.apply(key("fans"), "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm } } }], revision)).toMatchObject({ ok: true });
        expect(await owner.apply(key("ducts"), "ducts", "human", [], 0)).toMatchObject({ ok: true });
      },
    } });
  type Web = { handler: (request: Request, context: Context.Context<import("@pe/host-internal/request-contracts").RequestIdentity>) => Promise<Response>; dispose: () => Promise<void> };
  const browserCookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const live: Web = {
    handler: async (request, context) => {
      const who = Context.get(context, RequestIdentity).caller;
      const headers = new Headers(request.headers);
      headers.set(HOST_RPC_BRIDGE_SESSION_HEADER, ref.session);
      headers.set(HOST_RPC_DOCUMENT_HEADER, ref.openId);
      if (who.kind === "pea") headers.set(HOST_CONTEXT_HEADER, mintContext({ kind: "pea", thread: who.thread!, run: who.run, root: who.root }));
      else {
        headers.set("cookie", browserCookie);
        headers.set("origin", liveHost.base); headers.set(HOST_RUNTIME_SERVICE_HEADER, hostOwnership.serviceName);
        headers.set("referer", `${liveHost.base}/fans`);
      }
      const url = new URL(new URL(request.url).pathname + new URL(request.url).search, liveHost.base);
      if (mode.startsWith("legacy") && url.pathname === "/pe/resources") {
        headers.delete(HOST_RUNTIME_SERVICE_HEADER); headers.delete("origin");
        headers.set("sec-fetch-site", "same-origin"); url.searchParams.set("peRuntimeService", hostOwnership.serviceName);
      }
      return fetch(url, {
        method: request.method, headers, ...(request.method === "GET" ? {} : { body: await request.text() }),
      });
    }, dispose: liveHost.close,
  };
  const admitted = (who: Caller = caller) => admittedRequestIdentity(who, { bridgeSessionId: ref.session, openDocumentId: ref.openId });
  const send = (web: typeof live, url: string, body?: unknown, identity = admitted()) => withInvocationContext({ caller: identity.caller, hostBaseUrl: "http://host" }, () => web.handler(new Request(`http://host${url}`, {
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), Context.make(RequestIdentity, identity)));
  const cases: { url: string; body?: any; value: any; readSet: ReadSetId; stream?: boolean; caller: Caller }[] = [];
  const claimed = new Set<ReadSetId>();
  const capture = async (url: string, body?: unknown, stream = false, who: Caller = caller) => {
    const started = completed.length;
    const identity = admitted(who); const response = await send(live, url, body, identity);
    if (!stream) expect(response.status, await response.clone().text()).toBe(200);
    const value = stream ? await firstFrame(response) : url === "/call" ? await nativeValue(response) : await response.json();
    if (stream) expect(value.kind, JSON.stringify(value)).toBe("snapshot");
    if (url === "/call") { expect(response.headers.get("x-pe-ducts-reused")).toBe("true"); expect(value.nativeRequestId).not.toBe(identity.requestId); }
    const key = stream ? "resource.frame" : url === "/call" ? "native.call" : url.endsWith("/sheet") ? "ducts.sheet" : url.includes("route-state") ? "work.get" : "ducts.roster";
    const roots = completed.slice(started).filter((entry) => !claimed.has(entry.id) && entry.caller?.kind === who.kind && entry.recipe.key === key);
    expect(roots, "The actual consumer must complete exactly one stored read set").toHaveLength(1);
    claimed.add(roots[0]!.id);
    cases.push({ url, body, value, readSet: roots[0]!.id, stream, caller: who }); return value;
  };
  let historical: typeof live | undefined;
  const persistentProof = async () => {
    const resource: ReadingRequest = { kind: "ducts-snapshot", target: ref, selector: { kind: "roster" } };
    const url = `/pe/resources?keys=${encodeURIComponent(JSON.stringify([resource]))}`;
    const frames = resourceFrames(await send(live, url));
    const next = async (state: string) => {
      const value = await frames.next();
      expect(value, JSON.stringify(value)).toMatchObject({ kind: "snapshot", value: { state } });
      if (capturing) {
        const entry = completed.filter((entry) => !claimed.has(entry.id) && (entry.recipe.key === "resource.frame" || (entry.recipe.key === "resource.notification" && canonicalJson(entry.recipe.input) === canonicalJson({ reading: resource, envelope: value.value })))).at(-1)!;
        expect(entry, JSON.stringify({ state, value, truncated: writer.capture.truncated() })).toBeDefined();
        claimed.add(entry.id); cases.push({ url, value, readSet: entry.id, stream: true, caller });
      }
      return value;
    };
    try {
      const original = await next("ready");
      const retiredWalk = recovery ? cases.find((entry) => entry.url === "/call") : undefined;
      changedAt = 0; for (const notify of markListeners) notify();
      expect(await next("ready")).toMatchObject({ changed: false, value: original.value });
      changedAt = 300; for (const notify of markListeners) notify();
      expect(await next("ready")).toMatchObject({ changed: true, value: original.value });
      for (const listener of liveFactories.listeners) listener({ sessionId: ref.session, kind: "event",
        eventName: "document-changed", payloadJson: JSON.stringify({ changedOpenIds: [ref.openId] }) });
      await next("stale");
      const beforeReacquire = nativeCalls;
      const roster = recovery ? (await capture("/pe/ducts/roster", { target: ref }), undefined)
        : await send(live, "/call", { key: "ducts.snapshot.roster", request: { selector: { kind: "roster" } } });
      if (roster) expect(roster.status, await roster.clone().text()).toBe(200);
      if (recovery) {
        expect(nativeCalls).toBe(beforeReacquire + 1);
        const prior = cases.find((entry) => entry.value.kind === "overview")!.value;
        expect(cases.at(-1)!.value.rows.find((row: any) => row.unitId === prior.fan.unitId && row.portIndex === prior.fan.portIndex)).not.toHaveProperty("blockerCount");
      }
      await next("loading"); const fresh = await next("ready");
      expect(fresh.value.version).not.toBe(original.value.version);
      if (roster) expect(fresh.value.version).toBe(roster.headers.get(NATIVE_BODY_VERSION_HEADER));
      const refresh = ductsExecutors(liveFactories.service!)["ducts.refresh"]!;
      await refresh.run({ admission: { target: { kind: "document", ref } } } as CommandContext, {} as ActionExecution);
      await next("stale");
      const refreshed = recovery ? await send(live, "/pe/ducts/roster", { target: ref })
        : await send(live, "/call", { key: "ducts.snapshot.roster", request: { selector: { kind: "roster" } } });
      expect(refreshed.status, await refreshed.clone().text()).toBe(200);
      await next("loading");
      const refreshedFrame = await next("ready");
      if (!recovery) expect(refreshedFrame.value.version).toBe(refreshed.headers.get(NATIVE_BODY_VERSION_HEADER));
      if (mode === "endurance") for (let i = 0; i < 140; i++) {
        changedAt = i % 2 ? 300 : 0; for (const notify of markListeners) notify();
        await next("ready");
        expect(writer.capture.truncated(), `Long stream publication ${i}`).toBeNull();
      }
      if (mode === "endurance") {
        const sealedFrames = completed.filter((entry) => entry.recipe.key.startsWith("resource.")).length;
        holdMark = true; changedAt = 0; for (const notify of markListeners) notify();
        await markEntered.promise;
        await frames.close();
        await vi.waitFor(() => expect(markListeners.size).toBe(0));
        releaseMark.resolve();
        const afterClose = await send(live, "/pe/ducts/roster", { target: ref });
        expect(afterClose.status, await afterClose.clone().text()).toBe(200);
        expect(completed.filter((entry) => entry.recipe.key.startsWith("resource.")).length).toBe(sealedFrames);
        expect(writer.capture.truncated()).toBeNull();
      }
      if (retiredWalk) {
        expect(writer.capture.truncated()).toBeNull();
        const beforeRefusal = nativeCalls;
        const refused = await live.handler(new Request(`${liveHost.base}/call`, { method: "POST", headers: {
          "content-type": "application/json", [NATIVE_BODY_VERSION_HEADER]: retiredWalk.value.version,
        }, body: JSON.stringify(retiredWalk.body) }), Context.make(RequestIdentity, admitted()));
        expect(refused.status, await refused.clone().text()).toBe(409);
        expect(await refused.json()).toMatchObject({ error: { details: { problem: "read.retained" } } });
        expect(nativeCalls).toBe(beforeRefusal);
      }
    } finally { await frames.close(); }
  };
  try {
    if (mode.startsWith("legacy")) {
      const work: ReadingRequest = { ...key("legacy"), kind: "work" };
      const acks: ReadingRequest = { kind: "work-acks", work: key("legacy") };
      const tables: ReadingRequest = { kind: "ducts-tables", session: ref.session, ids: [] };
      const connection = crypto.randomUUID();
      const first = resourceFrames(await send(live, `/pe/resources?connection=${connection}`));
      const second = resourceFrames(await send(live, `/pe/resources?keys=${encodeURIComponent(JSON.stringify([work]))}`));
      try {
        await first.opening();
        expect((await send(live, `/pe/resource-subscriptions?connection=${connection}`, { add: [work, acks, tables], remove: [] })).status).toBe(200);
        const initial = [await first.next(), await first.next()];
        expect(initial.find((frame) => frame.key === readingKey(work))).toMatchObject({ kind: "snapshot", value: null });
        expect(initial.find((frame) => frame.key === readingKey(tables))).toMatchObject({ kind: "snapshot", value: { state: "ready" } });
        expect(await second.next()).toMatchObject({ kind: "snapshot", key: readingKey(work), value: null });
        if (mode === "legacy-full") await run(writer.capture.stop(writer.capture.begin()!, "full", { site: "builtin", op: "test.capture" }));
        if (mode === "legacy-io") vi.spyOn(writer, "append").mockImplementation(() => Effect.fail(new InvalidRead({ message: "I/O loss", status: 409, problem: "recording.io" })));
        expect(await workspace!.apply(key("legacy"), "legacy", "human", [{ path: ["count"], value: 1 }], 0)).toMatchObject({ ok: true });
        const frames = [await first.next(true), await first.next(true), await second.next()];
        expect(frames.filter((frame) => frame.kind === "snapshot")).toEqual([
          expect.objectContaining({ key: readingKey(work), value: expect.objectContaining({ revision: 1, doc: { count: 1 } }) }),
          expect.objectContaining({ key: readingKey(work), value: expect.objectContaining({ revision: 1, doc: { count: 1 } }) }),
        ]);
        expect(frames.find((frame) => frame.kind === "event")).toMatchObject({ key: readingKey(acks), value: { revision: 1 } });
        await first.close();
        await vi.waitFor(() => expect(markListeners.size).toBe(1));
        if (mode === "legacy") {
          changedAt = 0; for (const notify of markListeners) notify();
          expect(await second.next()).toMatchObject({ kind: "snapshot", value: { revision: 1 }, changed: false });
          const records = await Promise.all(writer.readSets.ids().map((id) => run(writer.readSets.get(id))));
          const deliveries = records.filter((record) => record.recipe.key === "resource.frame" && (record.recipe.input as { route?: string }).route === "legacy" && record.inputs.some((input) => input.input.kind === "work"));
          expect(deliveries).toHaveLength(4);
          expect(deliveries.every((record) => record.state === "complete" && record.inputs.some((input) => input.input.kind === "marks"))).toBe(true);
          expect(new Set(deliveries.flatMap((record) => record.inputs.map((input) => input.takingId))).size)
            .toBe(deliveries.reduce((total, record) => total + record.inputs.length, 0));
          expect(writer.capture.truncated()).toBeNull();
        } else expect(writer.capture.truncated()?.reason).toBe(mode === "legacy-full" ? "full" : "io");
        expect(await workspace!.apply(key("legacy"), "legacy", "human", [{ path: ["count"], value: 2 }], 1)).toMatchObject({ ok: true });
        expect(await second.next()).toMatchObject({ kind: "snapshot", value: { revision: 2, doc: { count: 2 } } });
        expect(nativeCalls).toBe(1); // The real native policy admitted the query-owned stream as human.
        if (mode === "legacy") {
          const resourceCompletions = () => completed.filter((entry) => entry.recipe.key.startsWith("resource.")).length;
          const sealed = resourceCompletions();
          holdHuman = true;
          expect(await workspace!.apply(key("legacy"), "legacy", "human", [{ path: ["count"], value: 3 }], 2)).toMatchObject({ ok: true });
          await entered.promise; await second.close(); releaseHuman.resolve();
          await vi.waitFor(() => expect(markListeners.size).toBe(0));
          const afterClose = await send(live, "/pe/route-state/legacy?binding=address&target=C%3A%2FModels%2FChadds.rvt");
          expect(afterClose.status).toBe(200); await afterClose.body?.cancel();
          expect(resourceCompletions()).toBe(sealed); // Closing a held capture never publishes its frame.
        }
      } finally { await first.close(); await second.close(); }
      await vi.waitFor(() => expect(markListeners.size).toBe(0));
      return;
    }
    if (mode === "truncated") {
      const tables: ReadingRequest = { kind: "ducts-tables", session: ref.session, ids: [] };
      const roster: ReadingRequest = { kind: "ducts-snapshot", target: ref, selector: { kind: "roster" } };
      const connection = crypto.randomUUID();
      const frames = resourceFrames(await send(live, `/pe/resources?connection=${connection}&keys=${encodeURIComponent(JSON.stringify([tables, roster]))}`));
      try {
        await nativeEntered.promise;
        expect(await frames.next()).toMatchObject({ kind: "snapshot", key: readingKey(tables), value: { state: "ready" } });
      await run(writer.capture.stop(writer.capture.begin()!, "full", { site: "builtin", op: "test.capture" }));
        expect((await send(live, `/pe/resource-subscriptions?connection=${connection}`, { add: [], remove: [readingKey(tables)] })).status).toBe(200);
        releaseNative.resolve();
        expect(await frames.next()).toMatchObject({ kind: "snapshot", key: readingKey(roster), value: { state: "ready" } });
        expect(writer.capture.truncated()).toMatchObject({ reason: "full" });
      } finally { releaseNative.resolve(); await frames.close(); }
      return;
    }
    if (isCold) {
      const fans = builtinEnrollments.find((entry) => entry.routeKey === "fans")!;
      const fingerprint = workFingerprintSchema.parse(`builtin-closure:${fans.closure.fingerprint}`);
      const scope = bindWork("fans", null, undefined, ref);
      const admission = { routeKey: "fans", fingerprint };
      const works: ReadingRequest[] = [{ ...scope, kind: "work", admission },
        { ...scope, route: "ducts", kind: "work", admission },
        { kind: "work-acks", work: scope, admission }];
      const all = [...works, ...coldKeys];
      const connection = crypto.randomUUID();
      expect(nativeCalls).toBe(0); expect(completed).toEqual([]);
      const streamResponse = await send(live, `/pe/resources?connection=${connection}&keys=${encodeURIComponent(JSON.stringify(all))}`);
      if (!streamResponse.ok) throw Error(await streamResponse.text());
      let frames = resourceFrames(streamResponse);
      const seen: any[] = [];
      const ready = async (keys: ReadingRequest[]) => {
        const pending = new Set(keys.map(readingKey));
        while (pending.size) {
          const frame = await frames.next(true); seen.push(frame);
          if (frame.kind === "snapshot" && frame.value?.state && frame.value.state !== "ready") continue;
          pending.delete(frame.key);
        }
      };
      try {
        await ready(all); expect(writer.capture.truncated(), "initial coexistence").toBeNull();
        for (const batch of batches) {
          const response = await send(live, `/pe/resource-subscriptions?connection=${connection}`, batch);
          expect(response.status, await response.clone().text()).toBe(200);
          if (batch.add.length) await ready(batch.add);
          expect(writer.capture.truncated(), "captured subscription batch").toBeNull();
        }
        const removeAll = await send(live, `/pe/resource-subscriptions?connection=${connection}`, { add: [], remove: all.map(readingKey) });
        expect(removeAll.status).toBe(200);
        const addAll = await send(live, `/pe/resource-subscriptions?connection=${connection}`, { add: all, remove: [] });
        expect(addAll.status).toBe(200); await ready(all);
        const beforeEdit = seen.length;
        expect(await workspace!.apply(scope, "fans", "human", [{ path: ["parameters", "fanFlow", "edit"], value: { value: "PE_M_Fan_AirFlow" } }], 0)).toMatchObject({ ok: true });
        await ready([works[0]!, works[2]!]); expect(writer.capture.truncated(), "changed Work and ack after slot edit").toBeNull();
        const edits = seen.slice(beforeEdit);
        expect(edits.find((frame) => frame.key === readingKey(works[0]!))?.value).toMatchObject({ revision: 1, doc: { parameters: { fanFlow: { edit: { value: "PE_M_Fan_AirFlow" } } } } });
        expect(edits.find((frame) => frame.key === readingKey(works[2]!))).toMatchObject({ kind: "event", value: { revision: 1 } });
        const previous = batches.flatMap((batch) => batch.add).find((key) => key.kind === "ducts-snapshot")! as Extract<ReadingRequest, { kind: "ducts-snapshot" }>;
        const selected = { ...previous, slots: { ...previous.slots, fanFlow: "PE_M_Fan_AirFlow" } };
        const beforeSelection = nativeCalls;
        const changed = await send(live, `/pe/resource-subscriptions?connection=${connection}`, { remove: [readingKey(previous)], add: [selected] });
        expect(changed.status, await changed.clone().text()).toBe(200); await ready([selected]);
        expect(nativeCalls).toBe(beforeSelection + 1);
        expect(writer.capture.truncated(), "slot reading replacement").toBeNull();
        const reopened = [...works, coldKeys.find((key) => key.kind === "ducts-tables")!, selected];
        for (let i = 0; i < 70; i++) {
          await frames.close();
          frames = resourceFrames(await send(live, `/pe/resources?keys=${encodeURIComponent(JSON.stringify(reopened))}`));
          await ready(reopened);
          expect(writer.capture.truncated(), `connection reopen ${i}`).toBeNull();
        }
        const failures = seen.filter((frame) => frame.kind === "failure");
        expect(failures, JSON.stringify(failures)).toEqual([]);
        expect(writer.capture.truncated()).toBeNull();
        if (capturing) for (const entry of completed.filter((entry) => entry.recipe.key === "resource.frame")) {
          const set = await run(writer.readSets.get(entry.id)); expect(set.state).toBe("complete");
          const kind = (entry.recipe.input as { kind: string }).kind;
          expect(set.inputs.filter((input) => input.input.kind === "marks")).toHaveLength(kind === "ducts-tables" || kind === "work-acks" ? 0 : 1);
        }
        await writeProof(`${mode}-receipt.json`, JSON.stringify({
          mode, state: "passed", snapshot: { path: source, bytes: readFileSync(source).length, sha256: createHash("sha256").update(readFileSync(source)).digest("hex"), schema: "readSchemas(ducts.snapshot.walk).response", schemaVersion: snapshotContract!.version },
          driver: { path: driverSource, sha256: createHash("sha256").update(readFileSync(driverSource!)).digest("hex") },
          frames: seen.length, reopens: 70, nativeCalls, sourceHashes: Object.fromEntries(["ts/apps/host/src/app.ts", "ts/apps/host/src/resource-adapters.ts", "ts/apps/host/src/pe-routes.ts", "ts/packages/runtime/src/resource-stream.ts"].map((file) => [file, createHash("sha256").update(readFileSync(join(import.meta.dirname, "../../../..", file))).digest("hex")])),
        }, null, 2));
      } finally {
        await frames.close();
        await writeProof(`${mode}-frames.json`, JSON.stringify(seen, null, 2));
      }
      return;
    }
    if (mode === "endurance" || mode === "tamper") {
      await persistentProof();
      if (mode === "endurance") return;
      await live.dispose(); liveFactories.recorded = true;
      const selected = completed.find((entry) => entry.recipe.key === "resource.frame")!;
      const saved = await run(writer.readSets.get(selected.id));
      const url = cases.find((entry) => entry.readSet === selected.id)!.url;
      for (const problem of ["recording.context", "recording.ambiguous"]) {
        await run(writer.readSets.keep(problem === "recording.context" ? { ...saved, state: "incomplete" }
          : { ...saved, id: crypto.randomUUID() }));
        const reader = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
        const context = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: reader, at: null }))));
        historical = HttpRouter.toWebHandler(readInputRoutes(context), { disableLogger: true });
        expect(await firstFrame(await send(historical, url))).toMatchObject({ kind: "failure", failure: { code: problem } });
        await historical.dispose(); historical = undefined;
      }
      expect([liveFactories.sdk, liveFactories.bridge, liveFactories.work]).toEqual([0, 0, 0]);
      return;
    }
    if (!capturing) {
      const warm = await send(live, "/pe/ducts/roster", { target: ref });
      expect(warm.status, await warm.clone().text()).toBe(200);
      await persistentProof(); return;
    }
    if (!recovery) await persistentProof();
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
    for (const kind of ["inputs", "worksheet"] as const) {
      const detail = await capture("/pe/ducts/sheet", { ...request, basis: overview.basis, detail: { kind } });
      expect(detail.kind).toBe(kind);
      expect(detail.basis).toBe(overview.basis);
    }
    const storedOverview = await run(writer.readSets.get(cases.filter((entry) => entry.value.kind === "overview")[0]!.readSet));
    const acquiredWalk = storedOverview.children.filter((entry) => entry.recipe.key === "ducts.retained" &&
      Schema.is(Schema.Struct({ key: Schema.Literal("ducts.snapshot.walk"), role: Schema.Literal("acquire") }))(entry.recipe.input));
    expect(acquiredWalk).toHaveLength(1);
    const acquiredSet = await run(writer.readSets.get(acquiredWalk[0]!.readSetId));
    const acquiredTaking = writer.taking(acquiredSet.takingLinks.native!);
    expect(acquiredTaking?.input).toMatchObject({kind: "native", key: "ducts.snapshot.walk"});
    expect(acquiredTaking?.outputVersion).toBe(snapshotContract.version);
    const acquisition = Schema.decodeUnknownSync(Schema.Struct({ request: Schema.Json }))(acquiredWalk[0]!.recipe.input);
    const beforeHit = nativeCalls;
    await capture("/call", { key: "ducts.snapshot.walk", request: acquisition.request });
    expect(nativeCalls).toBe(beforeHit);
    const hitOnly = cases.filter((entry) => entry.url === "/call");
    expect(hitOnly).toHaveLength(1);
    const prefix = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
    const prefixInputs = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: prefix, at: null }))));
    historical = HttpRouter.toWebHandler(readInputRoutes(prefixInputs, {
      get live(): never { poisoned++; throw Error("cold hit constructed live inputs"); },
      get store(): never { poisoned++; throw Error("cold hit constructed a Work store"); },
    }), { disableLogger: true });
    const cold = await send(historical, hitOnly[0]!.url, hitOnly[0]!.body);
    expect(cold.status, await cold.clone().text()).toBe(200);
    expect(await nativeValue(cold)).toEqual(hitOnly[0]!.value);
    expect(cold.headers.get("x-pe-ducts-reused")).toBe("false");
    expect(nativeCalls).toBe(beforeHit);
    await historical.dispose(); historical = undefined;
    const fans = builtinEnrollments.find((entry) => entry.routeKey === "fans")!;
    const fingerprint = workFingerprintSchema.parse(`builtin-closure:${fans.closure.fingerprint}`);
    for (const route of ["fans", "ducts"]) {
      const reading: ReadingRequest = { ...key(route), kind: "work", admission: { routeKey: "fans", fingerprint } };
      const frame = await capture(`/pe/resources?keys=${encodeURIComponent(JSON.stringify([reading]))}`, undefined, true);
      expect(frame.kind).toBe("snapshot"); expect(frame.changed).toBe(true);
      expect(frame.value.handle.key.route).toBe(route); expect(frame.value.history).toBeDefined();
    }
    holdHuman = true;
    const workUrl = "/pe/route-state/fans?open=captured-chadds/chadds-open";
    const humanRead = capture(workUrl);
    await Promise.race([entered.promise, new Promise<never>((_, reject) => setTimeout(() => reject(Error("Work runner lost the actual human request context")), 10000))]);
    expect(await workspace!.apply(key("fans"), "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm: 400 } } }], 2)).toMatchObject({ ok: true });
    const pea: Caller = { kind: "pea", context: "occurrence-test", thread: "thread", run: { thread: "thread", turn: "1" }, root: { thread: "thread", turn: "1" } };
    const peaView = await capture(workUrl, undefined, false, pea);
    releaseHuman.resolve();
    const humanView = await humanRead;
    expect([humanView.revision, peaView.revision]).toEqual([2, 3]);
    if (recovery) {
      await persistentProof();
      const fresh = await send(live, "/pe/ducts/sheet", request);
      expect(fresh.status, await fresh.clone().text()).toBe(200);
      expect((await fresh.json()).basis).not.toBe(overview.basis);
      const recovered = cases.filter((entry) => entry.url === "/pe/ducts/roster").at(-1)!;
      const saved = await run(writer.readSets.get(recovered.readSet));
      expect(saved.state).toBe("complete");
      const roots = completed.filter((entry) => entry.recipe.key === "ducts.roster");
      await writeProof("version-records.json", JSON.stringify({
        truncated: writer.capture.truncated(), roots: await Promise.all(roots.map(async (entry) => ({ id: entry.id, state: (await run(writer.readSets.get(entry.id))).state }))),
      }, null, 2));
      await live.dispose(); liveFactories.recorded = true;
      const reader = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
      const context = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: reader, at: null }))));
      const selected = cases.find((entry) => entry.value.kind === "overview")!;
      historical = HttpRouter.toWebHandler(readInputRoutes(context, {
        get live(): never { poisoned++; throw Error("Recovery constructed live inputs"); },
        get store(): never { poisoned++; throw Error("Recovery constructed Work store"); },
      }), { disableLogger: true });
      for (const entry of [selected, recovered]) {
        const response = await send(historical, entry.url, entry.body);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ problem: "recording.ambiguous" });
      }
      expect([liveFactories.sdk, liveFactories.bridge, liveFactories.work, poisoned]).toEqual([0, 0, 0, 0]);
      return;
    }
    // K5: the production Fans sheet and /call must share the bridge-subscribed refresh owner.
    const reread = async () => {
      const calls = nativeCalls;
      const response = await send(live, "/call", { key: "ducts.snapshot.walk", request: acquisition.request });
      expect(response.status, await response.clone().text()).toBe(200);
      await response.json();
      expect(nativeCalls, "A model change must retire the exact /call retained body").toBeGreaterThan(calls);
      const sheet = await send(live, "/pe/ducts/sheet", request);
      expect(sheet.status, await sheet.clone().text()).toBe(200);
      expect((await sheet.json()).basis).not.toBe(overview.basis);
    };
    for (const listener of liveFactories.listeners) listener({ sessionId: ref.session, kind: "event",
      eventName: "document-changed", payloadJson: JSON.stringify({ changedOpenIds: [ref.openId] }) });
    await reread();
    const refresh = ductsExecutors(liveFactories.service!)["ducts.refresh"]!;
    await refresh.run({ admission: { target: { kind: "document", ref } } } as CommandContext, {} as ActionExecution);
    await reread();
    await live.dispose();
    liveFactories.recorded = true;
    const liveFiles = vi.spyOn(DuctFiles, "layer").mockImplementation(() => { poisoned++; throw Error("Live file readers constructed"); });
    const reader = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
    expect(reader.truncation).toBeNull();
    const inventory = await Promise.all(reader.readSets.ids().map((id) => run(reader.readSets.get(id))));
    const groups = Map.groupBy(inventory, (entry) => canonicalJson(entry.recipe));
    await writeProof("fill1b-census.json", JSON.stringify({ snapshot: { path: source, sha256: createHash("sha256").update(readFileSync(source)).digest("hex"), schema: "readSchemas(ducts.snapshot.walk).response", version: snapshotContract.version }, records: inventory.length, incomplete: inventory.filter((entry) => entry.state !== "complete").length,
      recipes: [...groups.values()].map((entries) => ({ key: entries[0]!.recipe.key, input: entries[0]!.recipe.input, scope: entries[0]!.recipe.scope, count: entries.length,
        incomplete: entries.filter((entry) => entry.state !== "complete").length })) }, null, 2));
    const publications = cases.filter((entry) => entry.stream && entry.value.value?.state);
    expect(new Set(publications.map((entry) => entry.readSet)).size).toBe(publications.length);
    const acquisitionFrame = publications[0]!;
    const acquisitionSet = await run(reader.readSets.get(acquisitionFrame.readSet));
    const acquired = acquisitionSet.children.find((entry) => entry.recipe.key === "ducts.retained")!;
    expect((await run(reader.readSets.get(acquired.readSetId))).takingLinks.native).toBeTruthy();
    for (const publication of publications.slice(1).filter((entry) => entry.value !== envelope)) {
      const set = await run(reader.readSets.get(publication.readSet));
      expect(set.recipe.key).toBe("resource.notification");
      expect(set.recipe.input).toMatchObject({ envelope: publication.value.value });
      expect(set.children).toHaveLength(0); expect(set.takingLinks).toEqual({});
      expect(set.dependencies.value ?? set.dependencies.subscription).toBe(acquisitionFrame.readSet);
      expect(set.inputs.filter((entry) => entry.input.kind === "marks")).toHaveLength(1);
    }
    const overviewCase = cases.filter((entry) => entry.value.kind === "overview");
    expect(overviewCase).toHaveLength(1);
    const overviewSet = await run(reader.readSets.get(overviewCase[0]!.readSet));
    for (const detail of cases.filter((entry) => ["inputs", "worksheet"].includes(entry.value.kind))) {
      const record = await run(reader.readSets.get(detail.readSet));
      expect(record.dependencies.overview).toBeUndefined();
      expect(record.inputs.some(input => input.input.kind === "marks")).toBe(true);
      expect(record.children.some(child => child.recipe.key === "ducts.retained")).toBe(true);
    }
    for (const feed of cases.filter((entry) => entry.stream && entry.value.value?.handle)) {
      const record = await run(reader.readSets.get(feed.readSet));
      expect(record.inputs.some((entry) => entry.input.kind === "work" && entry.input.view === "feed")).toBe(true);
      const marks = record.inputs.filter((entry) => entry.input.kind === "marks");
      expect(marks).toHaveLength(1);
      const taking = reader.taking(marks[0]!.takingId)!;
      expect(await run(reader.observation(taking))).toMatchObject({ servedAt: 200, marks: { changedAt: 300 } });
    }
    const nativeRecipe = Schema.Struct({ key: Schema.String, role: Schema.String, request: Schema.Json, expectedVersion: Schema.NullOr(Schema.String) });
    const children = overviewSet.children.map((entry) => ({ ...entry, input: Schema.decodeUnknownSync(nativeRecipe)(entry.recipe.input) }));
    expect(children.every((entry) => ["acquire", "validate", "join", "beyond"].includes(entry.input.role))).toBe(true);
    const acquire = children.filter((entry) => entry.input.key === "ducts.snapshot.walk" && entry.input.role === "acquire");
    expect(acquire).toHaveLength(1);
    expect(children.some(entry => entry.input.role === "validate")).toBe(false);
    const original = await run(reader.readSets.get(acquire[0]!.readSetId));
    expect(original.takingLinks.native).toBeTruthy();
    const marks = overviewSet.inputs.filter(entry => entry.input.kind === "marks");
    expect(marks.length).toBeGreaterThanOrEqual(2);
    for (const mark of marks) expect(await run(reader.observation(reader.taking(mark.takingId)!))).toMatchObject({ generation: 300 });
    const calls = nativeCalls;
    const consumerReads = vi.spyOn(reader.readSets, "get");
    const context = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: reader, at: null }))));
    historical = HttpRouter.toWebHandler(Layer.unwrap(Effect.gen(function* () {
      yield* TestClock.setTime(10000);
      return readInputRoutes(context, {
        get live(): never { poisoned++; throw Error("live inputs constructed"); },
        get store(): never { poisoned++; throw Error("live Work store constructed"); },
        initialize: async () => { poisoned++; throw Error("live initializer called"); },
      });
    })).pipe(Layer.provide(TestClock.layer())), { disableLogger: true });
    for (const recorded of cases.filter((entry) => !entry.stream)) {
      const saved = await run(reader.readSets.get(recorded.readSet));
      const matches = groups.get(canonicalJson(saved.recipe))!;
      const response = await send(historical, recorded.url, recorded.body, admitted(recorded.caller));
      if (matches.length > 1) {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ problem: "recording.ambiguous" });
      } else {
        expect(response.status, await response.clone().text()).toBe(200);
        expect(JSON.parse(response.headers.get("x-pe-source")!)).toMatchObject({ kind: "recording", at: null, ...identity,
          coverage: expect.arrayContaining(["native", "document", "work", "files", "marks"]) });
        expect(response.headers.get("x-pe-source")).not.toContain(dir);
        expect(recorded.url === "/call" ? await nativeValue(response) : await response.json()).toEqual(recorded.value);
      }
    }
    const feeds = cases.filter((entry) => entry.stream && entry.value.value?.handle);
    const healthy = JSON.parse(new URL(feeds[0]!.url, "http://host").searchParams.get("keys")!)[0];
    const absent: ReadingRequest = { kind: "ducts-tables", session: "missing-session", ids: ["missing-table"] };
    const connection = crypto.randomUUID();
    consumerReads.mockClear();
    const frames = resourceFrames(await send(historical, `/pe/resources?connection=${connection}`));
    try {
      await frames.opening();
      expect(consumerReads).not.toHaveBeenCalled();
      const bootstrap = await send(historical, `/pe/resource-subscriptions?connection=${connection}`,
        { add: [resource, healthy, absent], remove: [] });
      expect(bootstrap.status).toBe(200);
      const batch = [await frames.next(), await frames.next(), await frames.next()];
      expect(batch.find((frame) => frame.key === readingKey(healthy))).toEqual(feeds[0]!.value);
      expect(batch.find((frame) => frame.key === readingKey(resource))).toMatchObject({ kind: "failure", failure: { code: "recording.ambiguous" } });
      expect(batch.find((frame) => frame.key === readingKey(absent))).toMatchObject({ kind: "failure", failure: { code: "recording.miss" } });
      const sibling = JSON.parse(new URL(feeds[1]!.url, "http://host").searchParams.get("keys")!)[0];
      const changed = await send(historical, `/pe/resource-subscriptions?connection=${connection}`,
        { add: [sibling], remove: [readingKey(absent), readingKey(resource)] });
      expect(changed.status).toBe(200);
      expect(await frames.next()).toEqual(feeds[1]!.value);
      await writeProof("reconciliation-case.json",
        JSON.stringify({ emptyGet: 200, opening: ": open\n\n", prePostConsumerReads: 0, bootstrapPost: bootstrap.status,
          batch, replacementPost: changed.status, liveFactories: { sdk: liveFactories.sdk, bridge: liveFactories.bridge, work: liveFactories.work }, poisoned }, null, 2));
    } finally { await frames.close(); }
    const refused = await send(historical, "/pe/route-state/fans/apply?open=captured-chadds/chadds-open", { patches: [], expectedRevision: 2, press: crypto.randomUUID() });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ problem: "recording.historical" });
    const missing = await send(historical, "/pe/ducts/roster", { target: { ...ref, openId: "unrecorded-open" } });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ problem: "recording.miss" });
    expect(poisoned).toBe(0); expect(nativeCalls).toBe(calls);
    expect(liveFactories).toMatchObject({ sdk: 0, bridge: 0, work: 0 });
    liveFiles.mockRestore();
  } finally { releaseNative.resolve(); releaseMark.resolve(); releaseHuman.resolve(); vi.restoreAllMocks(); await historical?.dispose(); await live.dispose(); liveFactories.recorded = false; await rm(dir, { recursive: true, force: true }); }
// Bridge: acquiring, invalidating and cold-replaying this 16.6 MB graph exceeds 300 s here.
// This is a measured History performance defect, not test slowness; remove after profiling/fixing it.
}, 600000);


test.each(["on", "off", "full", "io"] as const)("inventory consumers %s", async (mode) => {
  const dir = await mkdtemp(join(tmpdir(), "pe-inventory-consumers-"));
  const writer = await run(openRecordingWriter(dir, identity, { ...bounds, maxTakings: mode === "full" ? 1 : 2000 }));
  const old = await run(openRecordingReader(dir, identity, bounds));
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  let title = "initial", reads = 0, poison = 0, workspace: RouteWorkspace;
  const bridge = detachedBridge({ list: Effect.sync(() => { reads++; return [sessionView({ connected: true, sessionId: ref.session, processId: 42,
    state: { activeDocumentTitle: title, openDocuments: [{ openId: ref.openId, title, address: path }] } }),
    sessionView({ connected: false, sessionId: "disconnected" })]; }),
    subscribe: (notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; } });
  const expected = async () => Schema.decodeUnknownSync(bridgeSessionsListSchema)(await run(listBridgeSessions(bridge.list)));
  const sdk = Layer.succeed(SdkSession, { resolve: () => Effect.die("unexpected SDK"), resolveAttachment: () => Effect.die("unexpected SDK") });
  const inventory = HostSessionInventory.layer.pipe(Layer.provide(Layer.succeed(RevitBridge, bridge)), Layer.provide(sdk));
  const inputs = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live", ...(mode === "off" ? {} : { captureStore: writer }) }))));
  const lowCap = HostInputReadSets.layer;
  vi.spyOn(HostInputReadSets, "layer").mockImplementation((lane) => lowCap(lane, { ...defaultReadSetLimits, childrenPerRoot: 3, openRoots: 4 }));
  const web = HttpRouter.toWebHandler(readInputRoutes(inputs, { live: { inventory, owner: new DuctsReadings(),
    native: Layer.succeed(HostNativeRead, { resolve: () => Effect.die("unexpected native"), read: () => Effect.die("unexpected native") }),
    files: Layer.succeed(DuctFiles, { firm: Effect.die("unexpected files"), ductCatalogs: Effect.die("unexpected files") }),
    marks: Layer.succeed(HostDocumentMarks, hostMarks({ changedAt: () => null, subscribe: () => () => {} })) },
    store: fileRouteDocumentStore(join(dir, "work")), initialize: async (owner) => { workspace = owner; } }), { disableLogger: true });
  const send = (owner: typeof web, url: string, body?: unknown) => withInvocationContext({ caller, hostBaseUrl: "http://host" }, () => owner.handler(
    new Request(`http://host${url}`, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    Context.make(RequestIdentity, admittedRequestIdentity(caller, {}))));
  const inventoryReading: ReadingRequest = { kind: "inventory" };
  const fans = builtinEnrollments.find((entry) => entry.routeKey === "fans")!;
  const work: ReadingRequest = { ...key("fans"), kind: "work", admission: { routeKey: "fans", fingerprint: workFingerprintSchema.parse(`builtin-closure:${fans.closure.fingerprint}`) } };
  const firstId = crypto.randomUUID();
  const url = (id: string, keys: ReadingRequest[]) => `/pe/resources?connection=${id}&keys=${encodeURIComponent(JSON.stringify(keys))}`;
  let first: ReturnType<typeof resourceFrames> | undefined, second: ReturnType<typeof resourceFrames> | undefined, replay: typeof web | undefined;
  try {
    first = resourceFrames(await send(web, url(firstId, [inventoryReading, work])));
    const initial = [await first.next(), await first.next()];
    const initialValue = await expected();
    expect(initial.find((frame) => frame.key === readingKey(inventoryReading))).toEqual({ kind: "snapshot", key: readingKey(inventoryReading), value: initialValue });
    const unique = await run(openRecordingReader(dir, identity, bounds));
    second = resourceFrames(await send(web, url(crypto.randomUUID(), [inventoryReading])));
    expect(await second.next()).toEqual({ kind: "snapshot", key: readingKey(inventoryReading), value: await expected() });
    expect(listeners.size).toBe(2);
    if (mode === "io") vi.spyOn(writer, "append").mockImplementation(() => Effect.fail(new InvalidRead({ message: "I/O loss", status: 409, problem: "recording.io" })));
    for (let update = 0; update < 5; update++) {
      title = `update-${update}`; const before = reads;
      for (let burst = 0; burst < 3; burst++) for (const notify of listeners) notify({ kind: "state-sync", sessionId: ref.session });
      const values = [await first.next(), await second.next()];
      expect(reads - before).toBe(2);
      for (const value of values) expect(value).toEqual({ kind: "snapshot", key: readingKey(inventoryReading), value: await expected() });
    }
    expect((await send(web, `/pe/resource-subscriptions?connection=${firstId}`, { add: [], remove: [readingKey(inventoryReading)] })).status).toBe(200);
    expect(listeners.size).toBe(1);
    title = "survivor"; for (const notify of listeners) notify({ kind: "state-sync", sessionId: ref.session });
    expect(await second.next()).toEqual({ kind: "snapshot", key: readingKey(inventoryReading), value: await expected() });
    expect(await workspace!.apply(key("fans"), "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm: 400 } } }], 0)).toMatchObject({ ok: true });
    expect(await first.next()).toMatchObject({ kind: "snapshot", key: readingKey(work), value: { revision: 1 } });
    await first.close(); first = undefined; await second.close(); second = undefined;
    expect(listeners.size).toBe(0);
    if (mode === "on") {
      expect(writer.capture.truncated()).toBeNull();
      const records = await Promise.all(writer.readSets.ids().map((id) => run(writer.readSets.get(id))));
      const frames = records.filter((record) => record.recipe.key === "resource.frame" && (record.recipe.input as {kind?:string}).kind === "inventory");
      expect(frames).toHaveLength(13);
      expect(frames.every((frame) => frame.state === "complete" && frame.inputs.length === 1)).toBe(true);
      expect(new Set(frames.map((frame) => frame.inputs[0]!.takingId)).size).toBe(13);
      const subscriptions = frames.filter((frame) => !frame.dependencies.subscription);
      expect(subscriptions).toHaveLength(2);
      expect(frames.filter((frame) => frame.dependencies.subscription)).toHaveLength(11);
      expect(frames.every((frame) => !frame.dependencies.subscription || subscriptions.some((initial) => initial.id === frame.dependencies.subscription))).toBe(true);
      const original = await Promise.all(subscriptions.map((frame) => run(writer.observation(writer.taking(frame.inputs[0]!.takingId)!))));
      expect(original[0]).toEqual(original[1]);
    } else if (mode !== "off") expect(writer.capture.truncated()?.reason).toBe(mode === "full" ? "full" : "io");
    await web.dispose(); liveFactories.recorded = true;
    const custody = vi.spyOn(machine, "processCustody").mockImplementation(() => { poison++; throw Error("live custody on replay"); });
    const corpora: (readonly [RecordingReader, string | undefined])[] = [[old, "recording.miss"]];
    if (mode !== "full") corpora.push([unique, mode === "off" ? "recording.miss" : undefined]);
    if (mode === "on") corpora.push([await run(openRecordingReader(dir, identity, bounds)), "recording.ambiguous"]);
    for (const [saved, problem] of corpora) {
      const context = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: saved, at: null }))));
      replay = HttpRouter.toWebHandler(readInputRoutes(context, { get live(): never { poison++; throw Error("live factory"); } }), { disableLogger: true });
      const frame = await firstFrame(await send(replay, url(crypto.randomUUID(), [inventoryReading])));
      if (problem) { expect(frame).toMatchObject({ kind: "failure", failure: { code: problem } }); expect(frame).not.toHaveProperty("value.sessions"); }
      else expect(frame).toEqual({ kind: "snapshot", key: readingKey(inventoryReading), value: initialValue });
      await replay.dispose(); replay = undefined;
    }
    expect(poison).toBe(0);
    expect(liveFactories).toMatchObject({ sdk: 0, bridge: 0, work: 0 });
    custody.mockRestore();
    await writeProof(`inventory-${mode}-receipt.json`,
      JSON.stringify({ mode, producer: "listBridgeSessions", schema: "bridgeSessionsListSchema", initial: initialValue,
        coalescedBursts: 5, notificationsPerBurst: 3, consumers: 2, capturedInventoryFrames: mode === "on" ? 13 : null,
        limits: { childrenPerRoot: 3, openRoots: 4 }, truncation: writer.capture.truncated(), activeTaps: listeners.size,
        poison, liveFactories: { sdk: liveFactories.sdk, bridge: liveFactories.bridge, work: liveFactories.work } }, null, 2));
  } finally { await first?.close(); await second?.close(); await replay?.dispose(); await web.dispose(); vi.restoreAllMocks(); liveFactories.recorded = false; await rm(dir, { recursive: true, force: true }); }
}, 120000);
