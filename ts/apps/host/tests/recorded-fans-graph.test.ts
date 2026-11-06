import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/http";
import { expect, test, vi } from "vite-plus/test";
import { canonicalJson, HostNativeRead } from "@pe/host-internal/native-read";
import { bindWork, address, DUCTS_BODY_VERSION_HEADER, type Caller, type ReadingRequest } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
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
import { nativeCatalogIdentity, openRecordingWriter, openRecordingReader,
  type HostInputLane, type ConsumerRecipe } from "../src/native-recording.ts";
import type { ReadSetId } from "../src/input-occurrence.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { settle } from "./effect-test.ts";
import { bootHost } from "./real-server.ts";
import { ductsExecutors } from "../src/ducts-actions.ts";
import type { RevitBridge, HostBridgeEvent } from "../src/bridge.ts";
import type { CommandContext } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";
import { mintBrowserContext, mintContext } from "../src/control.ts";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";
import { hostOwnership } from "../src/host-ownership.ts";

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
  nativeRequestId: response.headers.get("x-pe-native-request-id"), version: response.headers.get(DUCTS_BODY_VERSION_HEADER),
});

function resourceFrames(response: Response) {
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(); let text = "";
  return { close: () => reader.cancel(), next: async () => {
    while (true) {
      const end = text.indexOf("\n");
      if (end >= 0) {
        const line = text.slice(0, end); text = text.slice(end + 1);
        if (line.startsWith("data:")) {
          const frame = JSON.parse(line.slice(5));
          if (frame.kind === "snapshot" || frame.kind === "failure") return frame;
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

test.skipIf(!existsSync(source)).each(["off", "on", "recovery", "endurance", "tamper"] as const)("real Fans graph %s", async (mode) => {
  const capturing = mode !== "off", recovery = mode === "recovery";
  liveFactories.recorded = false;
  const dir = await mkdtemp(join(tmpdir(), "pe-fans-graph-"));
  const completed: { recipe: ConsumerRecipe; id: ReadSetId; requestId?: string; caller?: Caller }[] = []; let nativeCalls = 0, poisoned = 0;
  let workspace: RouteWorkspace, holdHuman = false, holdMark = false;
  const markEntered = Promise.withResolvers<void>(), releaseMark = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>(), releaseHuman = Promise.withResolvers<void>();
  const raw = JSON.parse(readFileSync(source, "utf8").replace(/^\uFEFF/, ""));
  const snapshot = Schema.decodeUnknownSync(Schema.Json)(raw.result ?? raw);
  await mkdir(join(dir, "catalogs")); await writeFile(join(dir, "firm.json"), JSON.stringify(FIRM_SEED));
  const writer = await run(openRecordingWriter(join(dir, "bundle"), identity, bounds));
  const inputs = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live", ...(capturing ? { captureStore: writer } : {}) }))));
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
  let changedAt = 300;
  const markListeners = new Set<() => void>();
  const livePorts = {
    native, files: HostFiles.layer({ firm: join(dir, "firm.json"), catalogs: join(dir, "catalogs") }),
    marks: Layer.succeed(HostDocumentMarks, hostMarks({ observedSince: 100, changedAt: () => changedAt, subscribe: (notify) => { markListeners.add(notify); return () => { markListeners.delete(notify); }; } })),
    inventory: Layer.succeed(HostSessionInventory, { document: () => Effect.succeed(row),
      session: () => Effect.succeed({ sessionId: ref.session }), attachment: () => Effect.succeed({ sessionId: ref.session }) }),
  };
  const liveHost = await bootHost({ inputs, clock: 200, fans: { live: livePorts, store: fileRouteDocumentStore(join(dir, "work")),
      observedReadSet: (recipe, id, requestId, caller) => { completed.push({ recipe, id, requestId, caller }); },
      observed: (taking) => Effect.gen(function* () {
        if (holdMark && taking.input.kind === "marks") {
          holdMark = false; markEntered.resolve(); yield* Effect.promise(() => releaseMark.promise);
        }
        const identity = yield* Effect.serviceOption(RequestIdentity);
        if (holdHuman && taking.input.kind === "work" && taking.input.view === "view" &&
            Option.isSome(identity) && identity.value.caller.kind === "human") {
          holdHuman = false; entered.resolve(); yield* Effect.promise(() => releaseHuman.promise);
        }
      }),
      initialize: async (owner) => {
        workspace = owner;
        for (const [revision, cfm] of [[0, 250], [1, 300]] as const)
          expect(await owner.apply(key("fans"), "fans", "human", [{ path: ["flows", "4", "edit"], value: { value: { cfm } } }], revision)).toMatchObject({ ok: true });
        expect(await owner.apply(key("ducts"), "ducts", "human", [], 0)).toMatchObject({ ok: true });
      },
    } });
  type Web = { handler: (request: Request, context: Context.Context<import("@pe/host-internal/request-contracts").RequestIdentity>) => Promise<Response>; dispose: () => Promise<void> };
  const live: Web = {
    handler: async (request, context) => {
      const who = Context.get(context, RequestIdentity).caller;
      const headers = new Headers(request.headers);
      headers.set(HOST_RPC_BRIDGE_SESSION_HEADER, ref.session);
      headers.set(HOST_RPC_DOCUMENT_HEADER, ref.openId);
      if (who.kind === "pea") headers.set(HOST_CONTEXT_HEADER, mintContext({ kind: "pea", thread: who.thread!, run: who.run, root: who.root }));
      else {
        headers.set("cookie", mintBrowserContext({ kind: "local" }).split(";")[0]!);
        headers.set("origin", liveHost.base); headers.set(HOST_RUNTIME_SERVICE_HEADER, hostOwnership.serviceName);
        headers.set("referer", `${liveHost.base}/fans`);
      }
      return fetch(new URL(new URL(request.url).pathname + new URL(request.url).search, liveHost.base), {
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
      const roster = recovery ? await send(live, "/pe/ducts/roster", { target: ref })
        : await send(live, "/call", { key: "ducts.snapshot.roster", request: { selector: { kind: "roster" } } });
      expect(roster.status, await roster.clone().text()).toBe(200);
      if (recovery) {
        expect(nativeCalls).toBe(beforeReacquire + 1);
        const prior = cases.find((entry) => entry.value.kind === "overview")!.value;
        expect((await roster.json()).rows.find((row: any) => row.unitId === prior.fan.unitId && row.portIndex === prior.fan.portIndex)).not.toHaveProperty("blockerCount");
      }
      await next("loading"); const fresh = await next("ready");
      expect(fresh.value.version).not.toBe(original.value.version);
      if (!recovery) expect(fresh.value.version).toBe(roster.headers.get(DUCTS_BODY_VERSION_HEADER));
      const refresh = ductsExecutors(liveFactories.service!)["ducts.refresh"]!;
      await refresh.run({ admission: { target: { kind: "document", ref } } } as CommandContext, {} as ActionExecution);
      await next("stale");
      const refreshed = recovery ? await send(live, "/pe/ducts/roster", { target: ref })
        : await send(live, "/call", { key: "ducts.snapshot.roster", request: { selector: { kind: "roster" } } });
      expect(refreshed.status, await refreshed.clone().text()).toBe(200);
      await next("loading");
      const refreshedFrame = await next("ready");
      if (!recovery) expect(refreshedFrame.value.version).toBe(refreshed.headers.get(DUCTS_BODY_VERSION_HEADER));
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
          "content-type": "application/json", [DUCTS_BODY_VERSION_HEADER]: retiredWalk.value.version,
        }, body: JSON.stringify(retiredWalk.body) }), Context.make(RequestIdentity, admitted()));
        expect(refused.status, await refused.clone().text()).toBe(409);
        expect(await refused.json()).toMatchObject({ error: { details: { problem: "read.retained" } } });
        expect(nativeCalls).toBe(beforeRefusal);
      }
    } finally { await frames.close(); }
  };
  try {
    if (mode === "endurance" || mode === "tamper") {
      await persistentProof();
      if (mode === "endurance") return;
      await live.dispose(); liveFactories.recorded = true;
      const selected = completed.find((entry) => entry.recipe.key === "resource.notification")!;
      const saved = await run(writer.readSets.get(selected.id));
      for (const input of [null, { reading: saved.recipe.input, envelope: { state: "unknown" } }]) {
        await run(writer.readSets.keep({ ...saved, recipe: { ...saved.recipe, input } }));
        const reader = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
        const context = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: reader, at: null }))));
        historical = HttpRouter.toWebHandler(fansInputRoutes(context, { readSet: selected.id }), { disableLogger: true });
        const response = await send(historical, cases.find((entry) => entry.readSet === selected.id)!.url);
        expect(response.status, await response.clone().text()).toBe(409);
        expect(await response.json()).toMatchObject({ problem: "recording.mismatch" });
        await historical.dispose(); historical = undefined;
      }
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
    expect(overview.kind).toBe("overview");
    for (const kind of ["inputs", "worksheet"] as const) {
      const detail = await capture("/pe/ducts/sheet", { ...request, basis: overview.basis, detail: { kind } });
      expect(detail.kind).toBe(kind);
      expect(detail.basis).toBe(overview.basis);
    }
    const storedOverview = await run(writer.readSets.get(cases.filter((entry) => entry.value.kind === "overview")[0]!.readSet));
    const acquiredWalk = storedOverview.children.filter((entry) => entry.recipe.key === "ducts.retained" &&
      Schema.is(Schema.Struct({ key: Schema.Literal("ducts.snapshot.walk"), role: Schema.Literal("acquire") }))(entry.recipe.input));
    expect(acquiredWalk).toHaveLength(1);
    const acquisition = Schema.decodeUnknownSync(Schema.Struct({ request: Schema.Json }))(acquiredWalk[0]!.recipe.input);
    const beforeHit = nativeCalls;
    await capture("/call", { key: "ducts.snapshot.walk", request: acquisition.request });
    expect(nativeCalls).toBe(beforeHit);
    const hitOnly = cases.filter((entry) => entry.url === "/call");
    expect(hitOnly).toHaveLength(1);
    const prefix = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
    const prefixInputs = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: prefix, at: null }))));
    historical = HttpRouter.toWebHandler(fansInputRoutes(prefixInputs, { readSet: hitOnly[0]!.readSet,
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
      const reading: ReadingRequest = { ...key(route), kind: "work", admission: { routeKey: "fans", fingerprint,
        ...(route === "ducts" ? { reading: "ductsWork" } : {}) } };
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
      const roots = completed.filter((entry) => entry.recipe.key === "ducts.roster");
      await writeFile(join(import.meta.dirname, "../../../../.artifacts/runs/kernel-crusade-20261104/step-7/version-records.json"), JSON.stringify({
        truncated: writer.capture.truncated(), roots: await Promise.all(roots.map(async (entry) => ({ id: entry.id, state: (await run(writer.readSets.get(entry.id))).state }))),
      }, null, 2));
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
    const liveFiles = vi.spyOn(HostFiles, "layer").mockImplementation(() => { poisoned++; throw Error("Live file readers constructed"); });
    const reader = await run(openRecordingReader(join(dir, "bundle"), identity, bounds));
    expect(reader.truncation).toBeNull();
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
    for (const detail of cases.filter((entry) => ["inputs", "worksheet"].includes(entry.value.kind)))
      expect((await run(reader.readSets.get(detail.readSet))).dependencies.overview).toBe(overviewCase[0]!.readSet);
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
    const validate = children.filter((entry) => entry.input.key === "ducts.snapshot.walk" && entry.input.role === "validate");
    expect(acquire).toHaveLength(1); expect(validate).toHaveLength(1);
    const original = await run(reader.readSets.get(acquire[0]!.readSetId));
    const current = await run(reader.readSets.get(validate[0]!.readSetId));
    expect(original.takingLinks.native).toBeTruthy(); expect(current.takingLinks.native).toBe(original.takingLinks.native);
    const basis = (record: typeof original) => record.inputs.filter((entry) => entry.input.kind === "document" && entry.input.scope.includes("ducts-body-basis"));
    expect(basis(original)).toHaveLength(1); expect(basis(current)).toHaveLength(1);
    expect(basis(original)[0]!.takingId).not.toBe(basis(current)[0]!.takingId);
    const calls = nativeCalls;
    for (const recorded of cases) {
      if (recorded.url === "/call") continue; // the hit-only set was already replayed cold above
      console.info("cold recorded consumer", recorded.readSet, recorded.url, recorded.body?.detail?.kind ?? recorded.value.kind);
      const lane: HostInputLane = { kind: "recording", recordingStore: reader, at: null };
      const context = await run(HostInputContext.pipe(Effect.provide(HostInputContext.layer(lane))));
      // Each request has an explicit trusted read set; repeated occurrences have no guessed binding.
      historical = HttpRouter.toWebHandler(Layer.unwrap(Effect.gen(function* () {
        yield* TestClock.setTime(10000);
        return fansInputRoutes(context, { readSet: recorded.readSet, get live(): never { poisoned++; throw Error("live inputs constructed"); },
          get store(): never { poisoned++; throw Error("live Work store constructed"); }, initialize: async () => { poisoned++; throw Error("live initializer called"); } });
      })).pipe(Layer.provide(TestClock.layer())), { disableLogger: true });
      const response = await send(historical, recorded.url, recorded.body, admitted(recorded.caller));
      {
        expect(response.status, recorded.stream ? "resource stream" : await response.clone().text()).toBe(200);
        const provenance = JSON.parse(response.headers.get("x-pe-source")!);
        expect(provenance).toMatchObject({ kind: "recording", at: null, ...identity,
          coverage: expect.arrayContaining(["native", "document", "work", "files", "marks"]) });
        expect(JSON.stringify(provenance)).not.toContain(dir);
        const replay = recorded.stream ? await firstFrame(response) : recorded.url === "/call" ? await nativeValue(response) : await response.json();
        if (recorded.url === "/call") expect(response.headers.get("x-pe-ducts-reused")).toBe("false");
        expect(replay).toEqual(recorded.value);
      }
      const refused = await send(historical, "/pe/route-state/fans/apply?open=captured-chadds/chadds-open", { patches: [], expectedRevision: 2, press: crypto.randomUUID() });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ problem: "recording.historical" });
      const missing = await send(historical, "/pe/ducts/roster", { target: { ...ref, openId: "unrecorded-open" } });
      expect(missing.status).toBe(409);
      expect(await missing.json()).toMatchObject({ problem: expect.stringMatching(/^recording\.(miss|mismatch)$/) });
      await historical.dispose(); historical = undefined;
    }
    expect(poisoned).toBe(0); expect(nativeCalls).toBe(calls);
    expect(liveFactories).toMatchObject({ sdk: 0, bridge: 0, work: 0 });
    liveFiles.mockRestore();
  } finally { releaseMark.resolve(); releaseHuman.resolve(); vi.restoreAllMocks(); await historical?.dispose(); await live.dispose(); await rm(dir, { recursive: true, force: true }); }
// The production listener, full native schema decoding and each independent cold owner run here.
// The 180 s boundary completed live acquisition but expired during progressing cold consumers.
}, 300000);
