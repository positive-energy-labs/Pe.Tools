import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { Effect } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { readingAtom } from "../../web/src/readings.ts";
import { expect, test, vi } from "vite-plus/test";
import {
  address,
  READING_MAX_FRAME_BYTES,
  readingKey,
  routeStatePatchSchema,
  threadHeadSchema,
  takeoffsRouteState,
  type Reading,
  type ReadingRequest,
  type ReadingFrame,
  type WorkKey,
} from "@pe/agent-contracts";
import { BRIDGE_CONTRACT_VERSION, type BridgeStateSnapshot } from "@pe/host-contracts/contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ScopeStore } from "../../../packages/runtime/src/scope-store.ts";
import {
  observeResources,
  resourceResponse,
  type ResourceObserver,
} from "../../../packages/runtime/src/resource-stream.ts";
import { PeReadings, previousOf } from "../../web/src/readings.ts";

/** The listener frame `PeReadings.subscribe` publishes; `stale` is a client-side marker. */
type ReadingFrameUpdate = (ReadingFrame & { stale?: boolean }) | { kind: "stale"; key: string };
/** The observation a ready Reading carries; anything else is a failure of this proof. */
const observed = (reading: Reading<unknown>) => {
  if (reading.state !== "ready") throw Error(`Reading is '${reading.state}', not ready`);
  return reading.observation;
};
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";

const at = address("C:\\Models\\Transport.rvt");
const target = { session: "bridge-a", openId: "open-a" };
const workScope: WorkKey = { binding: "address" as const, route: "test", target: at };
const workRequest: ReadingRequest = { kind: "work", ...workScope };
const readingRequest: ReadingRequest = { kind: "takeoff-reading", target };
const receiptRequest: ReadingRequest = { kind: "receipts", target };
const scopeRequest: ReadingRequest = { kind: "thread-head", thread: "thread-a" };
const schema = takeoffsRouteState.schema.extend({
  count: threadHeadSchema.shape.revision.default(0),
  payload: routeStatePatchSchema.shape.value,
});

async function owners() {
  const base = join(checkoutRootFrom(import.meta.dirname)!, ".artifacts/tmp");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "resource-proof-"));
  const rows = new Map<string, unknown>();
  const getState = vi.fn(async ({ targetKey, route }: { targetKey: string; route: string }) =>
    rows.get(`${targetKey}/${route}`),
  );
  const work = new RouteWorkspace({
    registrations: [
      {
        spec: {
          route: "test",
          title: "Test",
          description: "Test",
          schema,
          commands: {},
          agentWriteMask: [["count"]],
        },
        handlers: {},
      },
    ],
    store: {
      getState,
      setState: async ({ targetKey, route, value }) => {
        rows.set(`${targetKey}/${route}`, structuredClone(value));
      },
    },
  });
  const heads = new Map<string, unknown>();
  const scopes = new ScopeStore(
    async () => ({
      getState: async ({ type }) => heads.get(type),
      setState: async ({ type, value }) => {
        heads.set(type, value);
      },
    }),
    "test",
  );
  const journal = new ActionJournal(join(directory, "journal.json"));
  const captures = new TakeoffCaptures(join(directory, "captures"));
  const observe = observeResources(
    work,
    scopes,
    hostResourceObserver(
      undefined,
      () => journal,
      () => captures,
    ),
  );
  return {
    work,
    getState,
    rows,
    scopes,
    journal,
    captures,
    observe,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

/** EventSource boundary only. Bytes come from the production Response and owner adapters. */
function browser(observe: ResourceObserver) {
  const frameSizes: number[] = [];
  const sources: Array<{
    url: string;
    closed: boolean;
    onopen: EventSource["onopen"];
    onmessage: EventSource["onmessage"];
    onerror: EventSource["onerror"];
    close(): void;
  }> = [];
  const client = new PeReadings(
    () => "http://host/pe/resources",
    (url) => {
      const abort = new AbortController();
      const response = resourceResponse(new Request(url, { signal: abort.signal }), observe);
      const reader = response.body!.getReader();
      const source = {
        url,
        closed: false,
        onopen: null as EventSource["onopen"],
        onmessage: null as EventSource["onmessage"],
        onerror: null as EventSource["onerror"],
        close() {
          this.closed = true;
          abort.abort();
          void reader.cancel().catch(() => {});
        },
      };
      sources.push(source);
      queueMicrotask(async () => {
        try {
          while (!source.closed) {
            const next = await reader.read();
            if (next.done) break;
            frameSizes.push(next.value.byteLength);
            const text = new TextDecoder().decode(next.value);
            source.onmessage?.call(
              source as unknown as EventSource,
              new MessageEvent("message", { data: text.slice(6).trim() }),
            );
          }
        } catch {
          if (!source.closed)
            source.onerror?.call(
              source as unknown as EventSource,
              new Event("error") as ErrorEvent,
            );
        }
      });
      return source;
    },
  );
  return { client, sources, frameSizes };
}
const snapshots = (updates: ReadingFrameUpdate[]) =>
  updates.filter((u): u is Extract<ReadingFrame, { kind: "snapshot" }> => u.kind === "snapshot");
const request = (keys: ReadingRequest[]) =>
  new Request(`http://host/pe/resources?${new URLSearchParams({ keys: JSON.stringify(keys) })}`);
const nextFrame = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const next = await reader.read();
  return JSON.parse(new TextDecoder().decode(next.value).slice(6)) as ReadingFrame;
};

test("real owner stream preserves quiet Work against noisy reading; reads missing Work without creation and shares two observers", async () => {
  const o = await owners();
  const b = browser(o.observe);
  const a: ReadingFrameUpdate[] = [],
    second: ReadingFrameUpdate[] = [],
    readings: ReadingFrameUpdate[] = [];
  const read = vi.spyOn(o.captures, "read");
  const releaseA = b.client.subscribe(workRequest, (u) => a.push(u));
  const releaseB = b.client.subscribe({ ...workRequest }, (u) => second.push(u));
  const releaseReading = b.client.subscribe(readingRequest, (u) => readings.push(u));
  try {
    await vi.waitFor(() => expect(snapshots(a).at(-1)?.value).toBeNull());
    expect(o.rows.size).toBe(0);
    expect(o.getState).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(b.sources).toHaveLength(1);
    await o.work.apply(workScope, "test", "human", [{ path: ["count"], value: 7 }], 0);
    for (let i = 0; i < 1000; i++) o.captures.invalidate(target);
    await vi.waitFor(() =>
      expect(snapshots(a).at(-1)?.value).toMatchObject({ doc: { count: 7 }, revision: 1 }),
    );
    expect(snapshots(second).at(-1)?.value).toEqual(snapshots(a).at(-1)?.value);
    expect(snapshots(readings).at(-1)?.value).toMatchObject({ kind: "failed", target });
    releaseA();
    await o.work.apply(workScope, "test", "human", [{ path: ["count"], value: 8 }], 1);
    await vi.waitFor(() =>
      expect(snapshots(second).at(-1)?.value).toMatchObject({ doc: { count: 8 } }),
    );
  } finally {
    releaseA();
    releaseB();
    releaseReading();
    await o.close();
  }
});

test("reconnect reacquires every owner key and receipt index; old callbacks and held initial reads cannot publish", async () => {
  const o = await owners();
  const b = browser(o.observe);
  const updates = new Map<string, ReadingFrameUpdate[]>();
  const keys = [workRequest, readingRequest, scopeRequest, receiptRequest];
  const releases = keys.map((key) => {
    const rows: ReadingFrameUpdate[] = [];
    updates.set(readingKey(key), rows);
    return b.client.subscribe(key, (u) => rows.push(u));
  });
  try {
    await vi.waitFor(() =>
      expect([...updates.values()].every((rows) => snapshots(rows).length === 1)).toBe(true),
    );
    const old = b.sources[0]!;
    const oldMessage = old.onmessage!;
    const readsBefore = o.getState.mock.calls.length;
    old.onerror!.call(old as unknown as EventSource, new Event("error") as ErrorEvent);
    expect([...updates.values()].every((rows) => rows.at(-1)?.kind === "stale")).toBe(true);
    await o.work.apply(workScope, "test", "human", [{ path: ["count"], value: 9 }], 0);
    await o.scopes.set("thread-a", { kind: "named", session: "bridge-a", address: at }, 0);
    await vi.waitFor(() => expect(b.sources.length).toBe(2), { timeout: 2000 });
    await vi.waitFor(() =>
      expect([...updates.values()].every((rows) => snapshots(rows).length >= 2)).toBe(true),
    );
    expect(o.getState.mock.calls.length).toBeGreaterThan(readsBefore);
    const rows = updates.get(readingKey(workRequest))!;
    expect(snapshots(rows).at(-1)?.value).toMatchObject({ doc: { count: 9 } });
    oldMessage.call(
      old as unknown as EventSource,
      new MessageEvent("message", {
        data: JSON.stringify({
          kind: "snapshot",
          key: readingKey(workRequest),
          value: { doc: { count: -1 }, revision: 0 },
        }),
      }),
    );
    expect(snapshots(rows).at(-1)?.value).toMatchObject({ doc: { count: 9 } });
  } finally {
    releases.forEach((release) => release());
    await o.close();
  }

  const delayed = await owners();
  let finish!: (value: unknown) => void;
  delayed.getState.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const frames: ReadingFrame[] = [];
  const release = delayed.observe(workRequest, (frame) => frames.push(frame));
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  release();
  finish(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(frames).toEqual([]);
  await delayed.close();
});

test("two server observers share acquisition; final release stops reads but admitted journal operation finishes", async () => {
  const o = await owners();
  const read = vi.spyOn(o.captures, "read");
  const one: ReadingFrame[] = [],
    two: ReadingFrame[] = [];
  const releaseOne = o.observe(readingRequest, (frame) => one.push(frame));
  const releaseTwo = o.observe(readingRequest, (frame) => two.push(frame));
  await vi.waitFor(() => expect(two.length).toBe(1));
  expect(read).toHaveBeenCalledTimes(1);
  releaseOne();
  o.captures.invalidate(target);
  await vi.waitFor(() => expect(two.length).toBe(2));
  expect(one.length).toBe(1);
  releaseTwo();
  const afterRelease = read.mock.calls.length;
  o.captures.invalidate(target);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // invalidate itself reads its previous state once; no observation read remains.
  expect(read.mock.calls.length).toBe(afterRelease + 1);
  const receipts: ReadingFrame[] = [];
  const releaseReceipts = o.observe(receiptRequest, (frame) => receipts.push(frame));
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const admitted = await o.journal.admit(
    {
      id: "original-id",
      key: "takeoffs.partition",
      kind: "workflow" as const,
      actor: "human",
      destination: { kind: "document", ref: target },
      input: {},
      bases: {},
    },
    async () => ({}),
    async () => {
      await hold;
      return { proof: true };
    },
  );
  expect(admitted.id).toBe("original-id");
  await vi.waitFor(() =>
    expect(
      receipts.some(
        (frame) =>
          frame.kind === "snapshot" &&
          (frame.value as Array<{ id: string }>).some((row) => row.id === "original-id"),
      ),
    ).toBe(true),
  );
  releaseReceipts();
  finish();
  expect(await o.journal.wait("original-id")).toMatchObject({
    id: "original-id",
    state: "succeeded",
    result: { proof: true },
  });
  await o.close();
});

test("actual adapter bounds stalled writes and frame/key limits", async () => {
  const o = await owners();
  const release = vi.fn();
  const observe: ResourceObserver = (key, publish) => {
    const stop = o.observe(key, publish);
    return () => {
      stop();
      release();
    };
  };
  const response = resourceResponse(request([workRequest, readingRequest]), observe, {
    frameBytes: 4096,
    worldEvents: 4,
    stallMs: 20,
  });
  await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(2));
  await expect(response.body!.getReader().read()).rejects.toThrow("closed");
  expect(
    resourceResponse(request(Array.from({ length: 33 }, () => workRequest)), observe).status,
  ).toBe(400);
  const tooSmall = resourceResponse(request([readingRequest]), observe, {
    frameBytes: 1,
    worldEvents: 4,
    stallMs: 100,
  });
  expect(tooSmall.status).toBe(400);
  expect(await tooSmall.json()).toMatchObject({
    error: "Resource key cannot fit a bounded failure frame",
  });
  await o.close();
});

test("Family capture publication reaches the actual browser index and releases shared filesystem reads", async () => {
  const o = await owners();
  const b = browser(o.observe);
  const key: WorkKey = {
    binding: "workspace" as const,
    route: "family",
    target: null,
    work: "file-work",
  };
  const request: ReadingRequest = { kind: "family-readings", work: key };
  const updates: ReadingFrameUpdate[] = [];
  const read = vi.spyOn(o.captures, "familyReadings");
  const release = b.client.subscribe(request, (update) => updates.push(update));
  try {
    await vi.waitFor(() => expect(snapshots(updates).at(-1)?.value).toEqual([]));
    expect(read).toHaveBeenCalledTimes(1);
    const capture = await o.captures.saveFamily({
      key,
      capturedAt: "2026-09-09T23:00:00.000Z",
      provenance: { kind: "file" },
      reading: { kind: "spec", value: { fileName: "retained.pdf", blocks: [], images: [] } },
    });
    await vi.waitFor(() => expect(snapshots(updates).at(-1)?.value).toEqual([capture]));
    release();
    await Promise.resolve();
    const before = read.mock.calls.length;
    await o.captures.saveFamily({
      key,
      capturedAt: "2026-09-09T23:00:01.000Z",
      provenance: { kind: "file" },
      reading: { kind: "spec", value: { fileName: "second.pdf", blocks: [], images: [] } },
    });
    expect(read).toHaveBeenCalledTimes(before);
    expect(await o.captures.family(capture.id)).toEqual(capture);
  } finally {
    release();
    await o.close();
  }
});

test("real bridge public events use an ordered bounded World lane with a visible gap and fair Work drain", async () => {
  const o = await owners();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bridge = yield* RevitBridge;
        let send!: (raw: string) => Effect.Effect<void>;
        const socket = {
          writer: Effect.succeed(() => Effect.void),
          runString: (accept: typeof send) =>
            Effect.sync(() => {
              send = accept;
            }).pipe(Effect.andThen(Effect.never)),
        };
        yield* bridge
          .handleConnection({ upgrade: Effect.succeed(socket) } as never)
          .pipe(Effect.forkScoped);
        yield* Effect.promise(() => vi.waitFor(() => expect(send).toBeTypeOf("function")));
        const state: BridgeStateSnapshot = {
          activeDocumentCloudModelGuid: null,
          activeDocumentCloudModelUrn: null,
          activeDocumentCloudProjectGuid: null,
          activeDocumentIsFamilyDocument: false,
          activeDocumentIsModelInCloud: false,
          activeDocumentIsWorkshared: false,
          activeDocumentKey: null,
          activeDocumentObservedAtUnixMs: 0,
          activeDocumentPath: null,
          activeDocumentTitle: null,
          hasActiveDocument: false,
          openDocuments: [],
          revitVersion: "2025",
          runtimeAssemblies: [],
          runtimeFramework: "net8",
          sharedParametersFilename: null,
        };
        const observe = observeResources(
          o.work,
          o.scopes,
          hostResourceObserver(
            bridge,
            () => o.journal,
            () => o.captures,
          ),
        );
        const worldRequest: ReadingRequest = { kind: "world" };
        const response = resourceResponse(
          request([worldRequest, workRequest, { kind: "inventory" }]),
          observe,
          { frameBytes: 4096, worldEvents: 4, stallMs: 2000 },
        );
        yield* send(
          JSON.stringify({
            kind: "Registration",
            registration: {
              contractVersion: BRIDGE_CONTRACT_VERSION,
              processId: 42,
              processStartUtcUnixMs: 1000,
              lane: "dev",
              sdkSessionId: "test",
              buildStamp: null,
              sessionDescriptorPath: null,
              state,
            },
          }),
        );
        for (let i = 0; i < 12; i++)
          yield* send(
            JSON.stringify({
              kind: "StateSync",
              stateSync: {
                state: { ...state, activeDocumentKey: String(i), activeDocumentTitle: String(i) },
              },
            }),
          );
        yield* Effect.promise(() =>
          o.work.apply(workScope, "test", "human", [{ path: ["count"], value: 4 }], 0),
        );
        yield* Effect.promise(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          const reader = response.body!.getReader();
          const frames: ReadingFrame[] = [];
          for (let i = 0; i < 7; i++) frames.push(await nextFrame(reader));
          expect(frames[0]).toMatchObject({ kind: "gap", dropped: 9 });
          expect(
            frames
              .slice(0, 3)
              .some((frame) => frame.kind === "snapshot" && frame.key === readingKey(workRequest)),
          ).toBe(true);
          expect(
            frames
              .filter((frame) => frame.kind === "event")
              .map((frame) => (frame as { value: { docTitle: string } }).value.docTitle),
          ).toEqual(["8", "9", "10", "11"]);
          expect(
            frames.find(
              (frame) =>
                frame.kind === "snapshot" && frame.key === readingKey({ kind: "inventory" }),
            ),
          ).toMatchObject({ value: { sessions: [{ activeDocumentTitle: "11" }] } });
          await reader.cancel();
        });
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  );
  await o.close();
});

test("oversized and unserializable owner values fail only their resource; real client retains evidence and healthy Work keeps updating", async () => {
  const o = await owners();
  const b = browser(o.observe);
  const registry = AtomRegistry.make();
  const atom = readingAtom(workRequest, b.client);
  const releaseAtom = registry.mount(atom);
  const failed: ReadingFrameUpdate[] = [],
    healthy: ReadingFrameUpdate[] = [];
  const healthyScope: WorkKey = {
    binding: "workspace" as const,
    route: "test",
    target: null,
    work: "healthy",
  };
  const healthyRequest: ReadingRequest = { kind: "work", ...healthyScope };
  const releases = [
    b.client.subscribe(workRequest, (value) => failed.push(value)),
    b.client.subscribe(healthyRequest, (value) => healthy.push(value)),
  ];
  try {
    await vi.waitFor(() => expect(registry.get(atom).state).toBe("ready"));
    await o.work.apply(workScope, "test", "human", [{ path: ["payload"], value: "last good" }], 0);
    await vi.waitFor(() =>
      expect(observed(registry.get(atom))).toMatchObject({
        doc: { payload: "last good" },
        revision: 1,
      }),
    );
    const oversized = "x".repeat(READING_MAX_FRAME_BYTES);
    expect(
      await o.work.apply(workScope, "test", "human", [{ path: ["payload"], value: oversized }], 1),
    ).toMatchObject({ ok: true });
    await vi.waitFor(() =>
      expect(failed.at(-1)).toMatchObject({
        kind: "failure",
        key: readingKey(workRequest),
        error: expect.stringContaining("frame limit"),
      }),
    );
    expect(registry.get(atom).state).toBe("failed");
    expect(previousOf(registry.get(atom))).toMatchObject({
      doc: { payload: "last good" },
      revision: 1,
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      await o.work.apply(workScope, "test", "human", [{ path: ["payload"], value: circular }], 2),
    ).toMatchObject({ ok: true });
    await vi.waitFor(() =>
      expect(failed.filter((value) => value.kind === "failure")).toHaveLength(2),
    );
    expect(previousOf(registry.get(atom))).toMatchObject({
      doc: { payload: "last good" },
    });
    expect(
      await o.work.apply(healthyScope, "test", "human", [{ path: ["count"], value: 8 }], 0),
    ).toMatchObject({ ok: true });
    await vi.waitFor(() =>
      expect(snapshots(healthy).at(-1)?.value).toMatchObject({ doc: { count: 8 } }),
    );
    expect(healthy.at(-1)?.kind).toBe("snapshot");
    expect(b.sources).toHaveLength(1);
    expect(b.sources[0]!.closed).toBe(false);
    expect(Math.max(...b.frameSizes)).toBeLessThanOrEqual(READING_MAX_FRAME_BYTES);
    expect(
      await o.work.apply(workScope, "test", "human", [{ path: ["payload"], value: "repaired" }], 3),
    ).toMatchObject({ ok: true });
    await vi.waitFor(() =>
      expect(observed(registry.get(atom))).toMatchObject({
        doc: { payload: "repaired" },
        revision: 4,
      }),
    );
    expect(b.sources).toHaveLength(1);
  } finally {
    releaseAtom();
    releases.forEach((release) => release());
    registry.dispose();
    await o.close();
  }
});
