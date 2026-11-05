import { testDocumentMarks } from "./effect-test.ts";
import { HostFiles } from "../src/host-files.ts";
import { HostDocumentMarks } from "../src/document-marks.ts";
import { PictureCaptureStore } from "../src/captures-route.ts";
import { detachedBridge, sessionView, captureStore } from "./effect-test.ts";
import { createPeClient, httpRoutes, servePeRoute } from "@pe/agent-contracts/pe-api";
import { afterEach, expect, vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { HttpEffect, HttpRouter } from "effect/http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  scheduleGridRouteState,
  scheduleReadingSchema,
  type DocumentRef,
  type ScheduleReading,
  type ActionAdmission,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { BridgeError, type HostBridgeEvent } from "../src/bridge.ts";
import { hostResourceObserver, markReadings } from "../src/resource-adapters.ts";

import { makeCallRoute } from "../src/call-route.ts";
import { createPeRoutes, fileRouteDocumentStore } from "../src/pe-routes.ts";
import { sdkSessions, originalProcess } from "./native-receipt-fixture.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { replayAnswer } from "./sdk-replay.ts";
import { detailResponse } from "./schedule-fixture.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { HOST_CONTEXT_VARIABLE } from "@pe/host-contracts/contracts";
import { mintContext } from "../src/control.ts";
import { serveRoutes } from "./real-server.ts";
import { contextFetch } from "@pe/runtime/context";
import { createCapabilityCatalogSource } from "../../../packages/mcps/src/pea/capabilities.ts";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";

/** A native schedule.cells.apply answer: one result per request cell, `[row, column, ok, error?]`. */
export function cellsApplied(cells: [number, number, boolean, string?][], extra: object = {}) {
  return {
    appliedCells: cells.filter(([, , ok]) => ok).length,
    appliedParameterWrites: cells.filter(([, , ok]) => ok).length,
    dryRun: false,
    results: cells.map(([rowNumber, columnNumber, ok, error], index) => ({
      index,
      rowNumber,
      columnNumber,
      ok,
      error: error ?? null,
      parameterResults: [{ index: 0, ok }],
    })),
    diagnostics: [],
    ...extra,
  };
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
export async function setup() {
  vi.stubEnv("PE_LANE", "dev");
  const dir = await mkdtemp(join(tmpdir(), "pe-schedule-chain-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  const captures = captureStore(join(dir, "captures"));
  let capabilities: ReturnType<typeof createCapabilityCatalogSource>;
  const app = createPeRoutes({
    capabilityCatalog: { read: (scope) => capabilities.read(scope) },
    store: fileRouteDocumentStore(join(dir, "work")),
    heads: { observe: () => () => {} },
    observeHostResource: (request, publish) => observeHost(request, publish),
    // As the host boots: one mark holder per bridge, shared by every Reading and every push.
    markReadings: (observe) => (request, publish) => markReadings(marks)(observe)(request, publish),
    registrations: [
      {
        spec: scheduleGridRouteState,
      },
    ],
  });
  const work = app.workspace;
  let owner = new ActionJournal(join(dir, "actions.json"));
  const a = { session: "A", openId: "open-A" },
    b = { session: "B", openId: "open-B" };
  const document = address(join(dir, "Same.rvt"));
  let reopened = false,
    unknown = false,
    readbackFails = false;
  let hold: Promise<void> | undefined,
    release = () => {};
  let response: unknown = cellsApplied([[1, 2, true]]);
  let detail = detailResponse();
  let readCount = 0;
  // The document's schedules, as Revit lists them; a test's apply may add one.
  const catalog = [
    {
      scheduleId: 42,
      scheduleUniqueId: "uid-42",
      name: "Panel",
      isTemplate: false,
      visibleBodyRowCount: 1,
      isPlacedOnSheet: false,
    },
  ];
  const sent: { key: string; input: any; session: string; openId: string; id?: string }[] = [];
  const sessions = () =>
    [a, b].map((target) => ({
      sessionId: target.session,
      processId: target === a ? 42 : 43,
      processStartUtcUnixMs: 1000,
      connected: true,
      lane: hostOwnership.lane,
      sourceRoot: hostOwnership.sourceRoot,
      serviceName: hostOwnership.serviceName,
      state: {
        openDocuments: [
          {
            openId: reopened && target === b ? "reopened-B" : target.openId,
            title: "Same",
            address: document,
            isFamilyDocument: false,
            isActive: true,
          },
        ],
      },
    }));
  const bridgeListeners = new Set<(event: HostBridgeEvent) => void>();
  /** Revit changed these open documents of one session, as the bridge reports it. */
  const revitChanged = (...refs: DocumentRef[]) => {
    for (const listener of bridgeListeners)
      for (const session of new Set(refs.map((ref) => ref.session)))
        listener({
          sessionId: session,
          kind: "event",
          eventName: "document-changed",
          payloadJson: JSON.stringify({
            changedOpenIds: refs.filter((ref) => ref.session === session).map((ref) => ref.openId),
          }),
        });
  };
  /** The bridge went away: the host is blind to every document of that session. */
  const bridgeDetached = (session: string) => {
    for (const listener of bridgeListeners) listener({ sessionId: session, kind: "disconnected" });
  };
  // External native source only: answers and document events. Work, admission and recovery
  // belong to the production routes below; these values never decide their expected outcomes.
  const bridge = detachedBridge({
    list: Effect.sync(() => sessions().map(sessionView)),
    snapshot: (id?: string) => Effect.sync(() => ({ connected: true, sessionId: id })),
    subscribe: (listener: (event: HostBridgeEvent) => void) => {
      bridgeListeners.add(listener);
      return () => bridgeListeners.delete(listener);
    },
    invoke: (key: string, input: unknown, session?: string, openId?: string | null, id?: string) =>
      Effect.tryPromise({
        try: async () => {
          if (id) await markDispatched(id);
          sent.push({ key, input, session: session!, openId: openId!, id });
          if (key === "revit.catalog.schedules")
            return { target: { session: session!, document: null }, value: { entries: structuredClone(catalog) } };
          if (key === "revit.detail.schedules") {
            readCount++;
            if (readbackFails && sent.some((s) => s.key === "schedule.cells.apply"))
              throw Error("readback unavailable");
            return { target: { session: session!, document: null }, value: structuredClone(detail) };
          }
          if (key !== "schedule.cells.apply") throw Error(`Unexpected ${key}`);
          await hold;
          if (unknown) throw new BridgeError("lost native reply", 503);
          return { target: { session: session!, document: null }, value: structuredClone(response) };
        },
        catch: (error) => {
          // Only a BridgeError is a typed native failure; any other throw stays a defect.
          if (error instanceof BridgeError) return error;
          throw error;
        },
      }),
  });
  // One observer for the whole fixture, as the host builds it: one mark holder, one bridge tap.
  const marks = testDocumentMarks(bridge);
  const observeHost = hostResourceObserver(
    bridge,
    () => owner,
    () => captures,
  );
  const sdk = async (args: readonly string[]) => {
    if (args[0] === "session" || args[0] === "doc") return sdkSessions(args);
    const id = args[2];
    return replayAnswer(args, {
      result: {
        state: "ok",
        requestId: id,
        receipt: {
          requestId: id,
          key: "schedule.cells.apply",
          processStartUtc: originalProcess.processStartUtc,
          pid: Number(args[args.indexOf("--pid") + 1]),
          verdict: "ok",
        },
        response,
      },
    });
  };
  const pe = HttpRouter.use((router) =>
    Effect.gen(function* () {
      for (const route of Object.values(httpRoutes)) {
        if (route.owner !== "pe") continue;
        yield* router.add(
          route.method,
          route.path,
          HttpEffect.fromWebHandler((request) => servePeRoute(request, app.fetch)),
        );
      }
    }),
  );
  const mount = () =>
    serveRoutes(
      Layer.mergeAll(pe, makeCallRoute(owner, captures, { workspace: work, sdk }).pipe(Layer.provide(HostFiles.layer()), Layer.provide(PictureCaptureStore.layer()), Layer.provide(Layer.succeed(HostDocumentMarks, marks)))),
      bridge,
    );
  let server = await mount();
  const catalogSource = () => createCapabilityCatalogSource({
    hostBaseUrl: server.base,
    registrations: [{ spec: scheduleGridRouteState }],
    machine: async () => machineFixture(sessions().map(session => ({
      session: session.sessionId,
      documents: session.state.openDocuments,
    }))),
  });
  capabilities = catalogSource();
  vi.stubEnv(HOST_CONTEXT_VARIABLE, mintContext({ kind: "human", via: "cli" }));
  cleanup.push(() => server.close());
  // Settle readback and receipt writes before removing their files.
  cleanup.push(async () => {
    release();
    for (const row of await owner.list()) await owner.wait(row.id);
  });
  const post = async (path: string, body: unknown) => {
    const response = await contextFetch(`${server.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: (await response.json()) as any };
  };
  const read = async (target = b) => {
    const result = await post("/schedules/readings", {
      key: "schedule.grid.snapshot",
      input: { scheduleId: detail.entries[0].scheduleId },
      target,
    });
    if (result.status !== 200) throw Error(JSON.stringify(result.value));
    return scheduleReadingSchema.parse(result.value);
  };
  const reading = await read();
  const scope = {
    binding: "workspace" as const,
    route: "schedules",
    target: null,
    work: reading.workspaceId,
  };
  const client = () => createPeClient(server.base, contextFetch);
  const view = () =>
    client().call("work.get", {
      params: { route: "schedules" },
      query: { work: scope.work },
    }) as Promise<{
      revision: number;
      doc: { basis?: { captureId: string }; cells: Record<string, any> };
    }>;
  const patch = async (patches: RouteStatePatch[]) => {
    const previous = await view();
    return (
      await client().response("work.apply", {
        params: { route: "schedules" },
        query: { work: scope.work },
        body: { patches, expectedRevision: previous.revision, press: crypto.randomUUID() },
      })
    ).json();
  };
  const bindReading = async (input: {
    readingId: string;
    expectedRevision: number;
    reading?: ScheduleReading;
  }) => {
    const id = crypto.randomUUID();
    const result = await post("/actions", {
      id,
      key: "schedule.grid.bind",
      target: { kind: "host" },
      input,
    });
    if (result.status >= 400) throw Error(JSON.stringify(result.value));
    const receipt = await owner.wait(id);
    if (receipt.state !== "succeeded") throw Error(JSON.stringify(receipt));
    return receipt.result;
  };
  await bindReading({ readingId: reading.id, expectedRevision: 0, reading });
  expect(
    await patch([{ path: ["cells", "1::2"], value: { edit: { value: "150 VA" } } }]),
  ).toMatchObject({ ok: true });
  const admission = async (id = crypto.randomUUID(), ref = b): Promise<ActionAdmission> => {
    const value: ActionAdmission = {
      id,
      key: "schedule.grid.push",
      target: { kind: "document", ref },
      input: { work: { key: scope, revision: (await view()).revision } },
    };
    // Exercise the same explicit preview boundary as callers before returning an apply admission.
    const preview = { ...value, id: `${id}:preview`, key: "schedule.grid.push.preview" };
    const result = await post("/actions", preview);
    if (result.status !== 409) await owner.wait(preview.id);
    return value;
  };
  const submit = async (submitted?: ActionAdmission) => {
    const value = submitted ?? (await admission());
    const result = await post("/actions", value);
    return result.status === 409 ? result.value : owner.wait(value.id);
  };
  return {
    dir,
    get base() {
      return server.base;
    },
    scope,
    a,
    b,
    view,
    patch,
    read,
    bind: async (reading: ScheduleReading) =>
      bindReading({
        readingId: reading.id,
        reading,
        expectedRevision: (await view()).revision,
      }),
    post,
    submit,
    admission,
    sent,
    reading,
    setResponse: (value: unknown) => {
      response = value;
    },
    setDetail: (value: ReturnType<typeof detailResponse>) => {
      detail = value;
    },
    reads: () => readCount,
    revitChanged,
    bridgeDetached,
    addSchedule: (scheduleId: number, name: string) =>
      catalog.push({
        scheduleId,
        scheduleUniqueId: `uid-${scheduleId}`,
        name,
        isTemplate: false,
        visibleBodyRowCount: 0,
        isPlacedOnSheet: false,
      }),
    reopen: () => {
      reopened = true;
    },
    unknown: () => {
      unknown = true;
    },
    failReadback: (value = true) => {
      readbackFails = value;
    },
    hold: () => {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
    restart: async () => {
      await server.close();
      owner = new ActionJournal(join(dir, "actions.json"));
      server = await mount();
      capabilities = catalogSource();
    },
    owner: () => owner,
  };
}
