import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { CANCEL_OPERATION_KEY } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { mintContext, retireContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { RequestIdentity } from "../src/request-services.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { captureStore, detachedBridge, sessionView, testHostInputs } from "./effect-test.ts";
import { serveRoutes } from "./real-server.ts";
import { replay } from "./sdk-replay.ts";

const snapshotValue = {
  reading: { at: "C:/model.rvt", version: "v1", observedAt: "2026-11-10T12:00:00.000Z" },
  snapshot: {
    status: { systems: [], carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] } },
    zoneFrs: [],
    regionsByZone: {},
  },
};
const indexValue = {
  summary: { levelCount: 0, sheetCount: 0, viewCount: 0, scheduleCount: 0, categoryCount: 0, familyCount: 0, truncated: false },
  levels: [], sheets: [], views: [], schedules: [], categories: [], families: [], browserOrganizations: [], issues: [],
};

/** Two natives per snapshot fetch. A mock `invokeHandle` is the seam `NativeReads` dispatches through. */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "pe-takeoff-shared-"));
  const dispatches: { key: string; id: string; answer: Deferred.Deferred<any, never>; terminal: Deferred.Deferred<"native-acknowledged"> }[] = [];
  const cancels: string[] = [];
  const raw: string[] = [];
  const identities: boolean[] = [];
  const bridge = detachedBridge({
    list: Effect.gen(function* () {
      identities.push((yield* Effect.serviceOption(RequestIdentity))._tag === "Some");
      return [sessionView({ ...hostOwnership, connected: true, sessionId: "session", processId: 42,
        processStartUtcUnixMs: 1000, state: { openDocuments: [{ openId: "open-a", isActive: true, title: "Model", address: "C:/model.rvt" }] } })];
    }),
    invokeHandle: (key, _input, _session, _open, id) => Effect.gen(function* () {
      const job = { key, id: id!, answer: yield* Deferred.make<any, never>(), terminal: yield* Deferred.make<"native-acknowledged">() };
      dispatches.push(job);
      return { answer: Deferred.await(job.answer), terminal: Deferred.await(job.terminal) };
    }),
    invoke: (key: string, input: any) => Effect.gen(function* () {
      if (key === CANCEL_OPERATION_KEY) {
        cancels.push(input.requestId);
        return { value: {}, target: { session: "session", document: null } };
      }
      raw.push(key); // a read that bypasses NativeReads
      return yield* Effect.never;
    }),
  });
  const server = await serveRoutes(
    makeCallRoute(new ActionJournal(join(root, "journal.jsonl"), Date.now), captureStore(join(root, "captures")), {}, { captureHostOp: () => {} })
      .pipe(Layer.provide(testHostInputs)),
    bridge,
    Layer.succeed(SdkDriver, () => Effect.succeed(replay("doc-list", { result: { documents: [] }, resolved: {
      payload: hostOwnership.lane === "dev" ? "checkout" : "installed", sourceRoot: hostOwnership.sourceRoot,
      installedRoot: hostOwnership.installedRoot, pid: 42, processStartUtc: new Date(1000).toISOString(),
      id: null, how: null, buildStamp: null, observedAtUtc: new Date(1000).toISOString(), origin: null,
    } }))),
  );
  const token = mintContext({ kind: "human", via: "cli" });
  const controllers: AbortController[] = [];
  const fetchSnapshot = () => {
    const controller = new AbortController();
    controllers.push(controller);
    return { controller, response: fetch(`${server.base}/call`, { method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-pe-context": token, "x-pe-bridge-session-id": "session", "x-pe-open-document-id": "open-a" },
      body: JSON.stringify({ key: "takeoffs.snapshot", request: {} }),
    }).catch(() => undefined) };
  };
  /** Both requests have reached the join: the bridge was last asked a while ago. */
  const settled = async () => {
    let last = -1, steady = 0;
    while (steady < 4) {
      await new Promise((r) => setTimeout(r, 25));
      steady = identities.length === last ? steady + 1 : 0;
      last = identities.length;
    }
  };
  const answer = (job: (typeof dispatches)[number]) => Effect.runPromise(Effect.gen(function* () {
    const attached = { processIncarnation: { pid: 42, startedAt: 1000 }, openDocumentLifetime: { openId: "open-a" } };
    yield* Deferred.succeed(job.answer, { value: job.key === "takeoffs.snapshot" ? snapshotValue : indexValue, nativeRequestId: job.id,
      actualTarget: attached, freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" }, cost: {}, outcome: "native-acknowledged" });
    yield* Deferred.succeed(job.terminal, "native-acknowledged");
  }));
  const close = async () => {
    for (const controller of controllers) controller.abort();
    retireContext(token);
    await server.close();
    await rm(root, { recursive: true, force: true });
  };
  return { dispatches, cancels, raw, identities, fetchSnapshot, settled, answer, close };
}

test("snapshot fetches with one key share two natives; an abort removes only its requester", async () => {
  const h = await harness();
  try {
    const a = h.fetchSnapshot();
    const b = h.fetchSnapshot();
    await expect.poll(() => h.dispatches.length, { timeout: 5000 }).toBe(2);
    await h.settled();
    expect(h.raw).toEqual([]);
    expect(h.dispatches.map((job) => job.key).sort()).toEqual(["revit.catalog.project-index", "takeoffs.snapshot"]);
    a.controller.abort();
    await a.response;
    await h.settled();
    expect(h.cancels).toEqual([]);
    for (const job of h.dispatches) await h.answer(job);
    const response = await b.response;
    expect(response?.status, await response?.clone().text()).toBe(200);
    expect(await response?.json()).toMatchObject({ reading: { version: "v1" } });
    expect(h.cancels).toEqual([]);
    expect(h.dispatches).toHaveLength(2);
    expect(h.identities.every(Boolean)).toBe(true);
  } finally {
    await h.close();
  }
});

test("when the last snapshot requester aborts, each shared native is cancelled once and nothing re-dispatches", async () => {
  const h = await harness();
  try {
    const a = h.fetchSnapshot();
    const b = h.fetchSnapshot();
    await expect.poll(() => h.dispatches.length, { timeout: 5000 }).toBe(2);
    await h.settled();
    a.controller.abort();
    await h.settled();
    expect(h.cancels).toEqual([]);
    b.controller.abort();
    await expect.poll(() => h.cancels.length, { timeout: 5000 }).toBe(2);
    await h.settled();
    expect(h.cancels.sort()).toEqual(h.dispatches.map((job) => job.id).sort());
    expect(h.dispatches).toHaveLength(2);
    expect(h.identities.every(Boolean)).toBe(true);
  } finally {
    await h.close();
  }
});

test("two requesters that both finish publish the one content-addressed capture", async () => {
  const h = await harness();
  try {
    const a = h.fetchSnapshot();
    const b = h.fetchSnapshot();
    await expect.poll(() => h.dispatches.length, { timeout: 5000 }).toBe(2);
    await h.settled();
    for (const job of h.dispatches) await h.answer(job);
    const [one, two] = await Promise.all([a.response, b.response]);
    expect([one?.status, two?.status]).toEqual([200, 200]);
    expect(one?.headers.get("x-pe-takeoff-capture-id")).toMatch(/^[a-f0-9]{64}$/);
    expect(two?.headers.get("x-pe-takeoff-capture-id")).toBe(one?.headers.get("x-pe-takeoff-capture-id"));
    expect(h.dispatches).toHaveLength(2);
    expect(h.cancels).toEqual([]);
  } finally {
    await h.close();
  }
});
