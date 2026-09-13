import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test, vi } from "vite-plus/test";
import { address, takeoffsRouteState, takeoffObservationStatusSchema } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { RevitBridge } from "../src/bridge.ts";
import { projectTakeoffSnapshot } from "../../../packages/mcps/src/shared/takeoff-ops.ts";

const at = address("C:\\Models\\Capture.rvt");
const target = { session: "bridge-a", openId: "open-a" };
const headers = {
  "content-type": "application/json",
  "x-pe-bridge-session-id": target.session,
  "x-pe-open-document-id": target.openId,
};
const raw = {
  reading: { at, version: "v1", observedAt: "2026-09-09T18:00:00.000Z" },
  snapshot: {
    status: {
      systems: [],
      carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] },
    },
    zoneFrs: [],
    regionsByZone: {},
  },
};

test("actual snapshot read leaves real Work revision and a concurrent authored edit intact; saved capture survives reconstruction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-captures-"));
  const captures = new TakeoffCaptures(dir);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bridge = {
    list: Effect.succeed([
      {
        sessionId: target.session,
        state: {
          openDocuments: [
            { openId: target.openId, address: at, title: "Capture.rvt", isActive: true },
          ],
        },
      },
    ]),
    invoke: (key: string, _payload: unknown, session: string, openId: string) =>
      Effect.promise(async () => {
        expect({ session, openId }).toEqual(target);
        if (key === "takeoffs.snapshot") {
          started();
          await held;
        }
        return {
          value: key === "takeoffs.snapshot" ? raw : { views: [] },
          target: { session, document: at },
        };
      }),
  } as unknown as RevitBridge["Service"];
  const web = HttpRouter.toWebHandler(
    makeCallRoute(undefined, captures).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
  const request = (req: Request) => web.handler(req, Context.empty() as never);
  let state: unknown;
  const work = new RouteWorkspace({
    registrations: [{ spec: takeoffsRouteState, handlers: {} }],
    store: {
      getState: async () => state,
      setState: async ({ value }) => {
        state = structuredClone(value);
      },
    },
  });
  const scope = { route: "takeoffs", target: at };
  try {
    await work.apply(scope, "takeoffs", "human", [], 0);
    const before = (await work.read(scope, "takeoffs"))!;
    const read = request(
      new Request("http://host/call", {
        method: "POST",
        headers,
        body: JSON.stringify({ key: "takeoffs.snapshot" }),
      }),
    );
    await entered;
    const staged = [{ roomId: "room-1", base: { name: "before" }, next: { name: "authored" } }];
    expect(
      await work.apply(
        scope,
        "takeoffs",
        "human",
        [{ path: ["staged"], value: staged }],
        before.revision,
      ),
    ).toMatchObject({ ok: true, revision: before.revision + 1 });
    release();
    const response = await read;
    expect(await response.clone().text()).not.toContain("error");
    expect(response.status, await response.clone().text()).toBe(200);
    const after = (await work.read(scope, "takeoffs"))!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.doc).toMatchObject({ staged });
    expect(after.doc).not.toHaveProperty("snapshot");
    expect(
      await work.apply(
        scope,
        "takeoffs",
        "human",
        [{ path: ["snapshot"], value: raw }],
        after.revision,
      ),
    ).toMatchObject({ ok: false });
    expect((await work.read(scope, "takeoffs"))!.revision).toBe(after.revision);
    const first = await (
      await request(new Request("http://host/takeoffs/observations", { headers }))
    ).json();
    const second = await (
      await request(new Request("http://host/takeoffs/observations", { headers }))
    ).json();
    expect(second).toEqual(first);
    const observed = takeoffObservationStatusSchema.parse(first);
    if (observed.kind !== "ready") throw Error("capture not ready");
    expect(first).not.toHaveProperty("capture");
    const capture = await captures.saved(observed.captureId);
    expect(capture.snapshot.reading.at).toBe(at);
    const restored = new TakeoffCaptures(dir);
    expect(await restored.saved(observed.captureId)).toEqual(capture);
  } finally {
    release?.();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("one-time conversion preserves authored state and receipts before removing legacy geometry; failed export never strips Work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-capture-migrate-"));
  const captures = new TakeoffCaptures(dir);
  const snapshot = projectTakeoffSnapshot(
    raw as Parameters<typeof projectTakeoffSnapshot>[0],
    "Capture.rvt",
    [],
  );
  const legacy = {
    version: 1,
    revision: 7,
    doc: {
      bindings: { r10: { id: "C:\\Takeoffs\\saved.r10", label: "saved" } },
      staged: [{ roomId: "keep", base: { name: "before" }, next: { name: "proposal" } }],
      snapshot,
    },
    outcomeUnknown: { command: "sync", startedAt: "2026-09-09T18:00:00Z" },
    receipts: {},
  };
  let state: unknown = structuredClone(legacy);
  let writes = 0;
  const store = {
    getState: async () => state,
    setState: async ({ value }: { value: unknown }) => {
      writes++;
      state = structuredClone(value);
    },
  };
  const scope = { route: "takeoffs", target: at };
  const create = (owner: TakeoffCaptures) =>
    new RouteWorkspace({
      registrations: [
        { spec: takeoffsRouteState, handlers: {}, migrate: (value) => owner.migrateWork(value) },
      ],
      store,
    });
  try {
    const converted = (await create(captures).read(scope, "takeoffs"))!;
    expect(converted.revision).toBe(7);
    expect(converted.doc).toMatchObject({
      staged: legacy.doc.staged,
    });
    expect(converted.doc).not.toHaveProperty("snapshot");
    expect(converted.doc).not.toHaveProperty("bindings");
    expect(
      await captures.legacyWork(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")),
    ).toEqual(legacy);
    expect(state).toMatchObject({ outcomeUnknown: legacy.outcomeUnknown, receipts: {} });
    expect(writes).toBe(1);
    await create(new TakeoffCaptures(dir)).read(scope, "takeoffs");
    expect(writes).toBe(1);
    const saved = await captures.list(at);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ provenance: { kind: "legacy-unknown" }, snapshot });
    expect(captures.read(target).kind).toBe("empty");
    expect(
      takeoffObservationStatusSchema.safeParse({ kind: "ready", target, capture: saved[0] })
        .success,
    ).toBe(false);
    expect(
      takeoffObservationStatusSchema.safeParse({
        kind: "empty",
        target,
        reading: true,
        error: null,
      }).success,
    ).toBe(false);
    const blocked = join(dir, "blocked");
    await writeFile(blocked, "file prevents capture directory creation");
    state = structuredClone(legacy);
    expect(
      await create(new TakeoffCaptures(join(blocked, "captures"))).read(scope, "takeoffs"),
    ).toMatchObject({
      migrationError: expect.any(String),
      revision: 7,
      doc: { staged: legacy.doc.staged },
    });
    expect(state).toEqual(legacy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("actual /call rejects a closed openId and a late generation; saved HTTP reads reconstruct without any bridge service", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-capture-late-"));
  const captures = new TakeoffCaptures(dir);
  let open = true;
  let release!: () => void;
  let entered = 0;
  let hold = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bridge = {
    list: Effect.sync(() => [
      {
        sessionId: target.session,
        state: {
          openDocuments: open ? [{ openId: target.openId, address: at, title: "Capture.rvt" }] : [],
        },
      },
    ]),
    invoke: (key: string) =>
      Effect.promise(async () => {
        const version = key === "takeoffs.snapshot" ? ++entered : 0;
        if (key === "takeoffs.snapshot" && hold) await gate;
        return {
          value:
            key === "takeoffs.snapshot"
              ? { ...raw, reading: { ...raw.reading, version: String(version) } }
              : { views: [] },
          target: { session: target.session, document: at },
        };
      }),
  } as unknown as RevitBridge["Service"];
  const web = HttpRouter.toWebHandler(
    makeCallRoute(undefined, captures).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
  const read = () =>
    web.handler(
      new Request("http://host/call", {
        method: "POST",
        headers,
        body: JSON.stringify({ key: "takeoffs.snapshot" }),
      }),
      Context.empty() as never,
    );
  try {
    const late = read();
    await vi.waitFor(() => expect(entered).toBe(1));
    captures.invalidate(target);
    hold = false;
    const latest = await read();
    expect(latest.status).toBe(200);
    const id = latest.headers.get("x-pe-takeoff-capture-id")!;
    release();
    expect((await late).status).toBe(409);
    expect(captures.read(target)).toMatchObject({
      kind: "ready",
      capture: { id, snapshot: { reading: { version: "2" } } },
    });
    expect(await captures.list(at)).toHaveLength(1);
    open = false;
    expect((await read()).status).toBe(409);
    const restored = HttpRouter.toWebHandler(makeCallRoute(undefined, new TakeoffCaptures(dir)), {
      disableLogger: true,
    });
    try {
      const saved = await restored.handler(
        new Request(`http://host/takeoffs/observations?capture=${id}`),
        Context.empty() as never,
      );
      expect(saved.status).toBe(200);
      const mcpRead = await restored.handler(
        new Request("http://host/call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "takeoffs.saved", request: { captureId: id } }),
        }),
        Context.empty() as never,
      );
      expect(mcpRead.status).toBe(200);
      expect(mcpRead.headers.get("x-pe-resolved-session")).toBeNull();
      expect(await mcpRead.json()).toMatchObject({ id });
      expect(await saved.json()).toMatchObject({ id, snapshot: { reading: { version: "2" } } });
    } finally {
      await restored.dispose();
    }
  } finally {
    release();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
