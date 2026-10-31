import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  address,
  routeBindingsSchema,
  takeoffsRouteState,
  threadHeadSchema,
  tools,
  bindWork,
  workKey,
  type ThreadHead,
} from "@pe/agent-contracts";
import { RouteWorkspace, type RouteWorkspaceRegistration } from "@pe/runtime";
import { Effect, PubSub } from "effect";
import type { RevitBridge, HostBridgeEvent, BridgeSessionView } from "../src/bridge.ts";
import { createPeRoutes, fileRouteDocumentStore, makeHostPeRoutes } from "../src/pe-routes.ts";
import { withInvocationContext } from "@pe/runtime/context";
import type { Caller } from "@pe/agent-contracts";
import { human, pea } from "./callers.ts";
import { admitCrossing, bindControl } from "../src/control.ts";

afterEach(() =>
  bindControl({
    heads: null,
    acquired: () => null,
    acquiredSession: () => null,
  }),
);

test("HTTP Work shares edits independently of thread targets and refuses forged live identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-work-crossing-"));
  const a = { session: "session", openId: "a", address: address("C:/Models/A.rvt") };
  const b = { session: "session", openId: "b", address: address("C:/Models/B.rvt") };
  const outside = {
    session: "session",
    openId: "outside",
    address: address("C:/Models/Other.rvt"),
  };
  let documents = [a, b, outside];
  let head: ThreadHead = {
    revision: 4,
    targets: [
      {
        request: { kind: "open", ref: { session: a.session, openId: a.openId } },
        admission: { revision: 4, at: "2026-10-23T00:00:00Z", via: "local" },
      },
      { request: { kind: "open", ref: { session: b.session, openId: b.openId } }, admission: null },
    ],
  };
  bindControl({
    heads: () => head,
    acquired: () => null,
    acquiredSession: () => null,
  });
  const store = fileRouteDocumentStore(join(directory, "work"));
  const app = createPeRoutes({
    registrations: [{ spec: tools.ducts.work }],
    store,
    heads: { observe: () => () => {} },
    navigation: { documents: async () => documents, threads: async () => [] },
  });
  // Real HTTP transport; this fixture supplies the trusted caller that production middleware mints.
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const response = await withInvocationContext(
        {
          caller:
            incoming.headers["x-test-author"] === "human"
              ? human
              : incoming.headers["x-test-author"] === "page"
                ? { kind: "page", page: "page:@pages/test" }
                : incoming.headers["x-test-author"] === "external-mcp"
                  ? { kind: "external-mcp", context: "device-context", label: "paired test device" }
                  : pea(),
        },
        () =>
          app.fetch(
            new Request(new URL(incoming.url!, base), {
              method: incoming.method,
              headers: { "content-type": "application/json" },
              ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
            }),
          ),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500);
      outgoing.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const query = (doc = b, target = doc.address) =>
    new URLSearchParams({ open: `${doc.session}/${doc.openId}`, target }).toString();
  const request = (search: string, patches?: unknown[], revision = 0, caller: Caller = pea()) =>
    fetch(`${base}/pe/route-state/ducts${patches ? "/apply" : ""}?${search}`, {
      headers: { "content-type": "application/json", "x-test-author": caller.kind },
      ...(patches
        ? {
            method: "POST",
            body: JSON.stringify({
              patches,
              expectedRevision: revision,
              press: caller.kind === "human" ? crypto.randomUUID() : null,
            }),
          }
        : {}),
    });
  try {
    expect(() =>
      admitCrossing(
        pea(),
        { kind: "document", ref: { session: b.session, openId: b.openId } },
        "/actions",
      ),
    ).not.toThrow();
    expect(await (await request(query())).json()).toMatchObject({
      revision: 0,
      doc: { workingPhase: {} },
    });
    const proposed = [{ path: ["workingPhase", "suggestion"], value: { value: "Existing" } }];
    for (const caller of [
      { kind: "page", page: "page:@pages/test" },
      { kind: "external-mcp", context: "device-context", label: "paired test device" },
    ] as Caller[]) {
      expect((await request(query(), proposed, 0, caller)).status).toBe(403);
      const command = await fetch(`${base}/pe/route-state/ducts/command?${query()}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-author": caller.kind },
        body: JSON.stringify({ command: "not-a-command", input: {}, expectedRevision: 0 }),
      });
      expect(command.status).toBe(404);
    }
    expect(await (await request(query(), proposed)).json()).toMatchObject({
      ok: true,
      revision: 1,
    });
    expect(await (await request(query(a))).json()).toMatchObject({
      revision: 0,
      doc: { workingPhase: {} },
    });
    // Omitting target= still resolves the saved B address, rather than inventing ephemeral Work.
    const retained = await (await request("open=session/b")).json();
    expect(retained).toMatchObject({
      revision: 1,
      doc: { workingPhase: { suggestion: { value: "Existing" } } },
    });
    documents.push({ ...b, session: "other-session" });
    expect(await (await request(`target=${encodeURIComponent(b.address)}`)).json()).toMatchObject({
      revision: 1,
    });
    documents.pop();
    expect(
      await (
        await request(query(), [{ path: ["workingPhase", "edit"], value: { value: "New" } }], 1)
      ).json(),
    ).toMatchObject({ ok: true, revision: 2 });
    expect(
      await (
        await request(
          query(),
          [{ path: ["workingPhase", "edit"], value: { value: "Reviewed" } }],
          1,
          human,
        )
      ).json(),
    ).toMatchObject({ ok: false, code: "stale_revision", error: "the document moved to r2" });
    expect(
      await (
        await request(
          query(),
          [{ path: ["workingPhase", "edit"], value: { value: "New" } }],
          2,
          human,
        )
      ).json(),
    ).toMatchObject({ ok: true, revision: 3 });
    for (const search of [query(b, a.address)]) {
      expect((await request(search)).status).toBe(403);
      expect((await request(search, proposed, 3)).status).toBe(403);
    }
    for (const search of [
      query(outside),
      "open=session/closed",
      `target=${encodeURIComponent(outside.address)}`,
    ])
      expect(await (await request(search)).json()).toMatchObject({ revision: 0 });
    documents = [a, outside];
    expect(await (await request(query())).json()).toMatchObject({ revision: 3 });
    documents = [a, b, outside];
    expect(await (await request(query(outside))).json()).toMatchObject({ revision: 0 });
    head = { revision: 5, targets: head.targets.slice(0, 1) };
    expect(await (await request(query(), proposed, 3)).json()).toMatchObject({
      ok: true,
      revision: 4,
    });
    const key = bindWork("ducts", b.address);
    const before = await app.workspace.readRaw(key, "ducts");
    expect(before).toMatchObject({
      revision: 4,
      doc: {
        workingPhase: {
          suggestion: { value: "Existing", by: "pea" },
          edit: { value: "New", by: "human" },
        },
      },
    });
    expect(await app.workspace.readRaw(key, "ducts")).toEqual(before);
    const navigation = await fetch(`${base}/pe/navigation`, {
      headers: { "x-test-author": "human" },
    });
    expect(await navigation.json()).toMatchObject({
      works: expect.arrayContaining([
        expect.objectContaining({
          id: workKey(key),
          route: "ducts",
          label: expect.any(String),
          state: "ready",
          revision: 4,
          proposals: 1,
        }),
      ]),
    });
    // Both authors inspect retained Work; recreation reads the same authored bytes.
    expect(await (await request(query(), undefined, 0, human)).json()).toMatchObject(before!);
    const restarted = new RouteWorkspace({
      registrations: [{ spec: tools.ducts.work }],
      store,
    });
    expect(await restarted.readRaw(key, "ducts")).toEqual(before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

/** Route writes cross as the human the identity middleware would mint for the web app. */
const asHuman = (owner: { fetch: (request: Request) => Promise<Response> }) => (request: Request) =>
  withInvocationContext({ caller: human }, () => owner.fetch(request));

const registrations = [
  {
    spec: {
      route: "test",
      title: "Test",
      description: "Lifetime proof",
      schema: takeoffsRouteState.schema.extend({
        count: threadHeadSchema.shape.revision.default(0),
      }),
    },
  },
];
const open = {
  binding: "open",
  route: "test",
  target: null,
  open: { session: "session", openId: "closed" },
} as const;
const path = "http://host/pe/route-state/test?open=session/closed";

test("HTTP addressless Work survives workspace recreation and Save As carries it once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-work-"));
  try {
    const store = fileRouteDocumentStore(join(directory, "work"));
    const app = createPeRoutes({
      registrations,
      store,
      heads: { observe: () => () => {} },
      navigation: { documents: async () => [], threads: async () => [] },
    });
    const written = await asHuman(app)(
      new Request(`${path.replace("?", "/apply?")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 0,
          press: crypto.randomUUID(),
          patches: [{ path: ["count"], value: 7 }],
        }),
      }),
    );
    expect(await written.json()).toMatchObject({ ok: true, revision: 1 });
    const restarted = new RouteWorkspace({ registrations, store });
    expect(await restarted.read(open, "test")).toMatchObject({ revision: 1, doc: { count: 7 } });
    const read = await asHuman(app)(new Request(path));
    expect(await read.json()).toMatchObject({ revision: 1, doc: { count: 7 } });
    expect(
      await restarted.read({ ...open, open: { ...open.open, openId: "replacement" } }, "test"),
    ).toBeNull();

    // Save As still moves these exact lifetime bytes onto the stable Address.
    const apply = () =>
      new Request(path.replace("?", "/apply?"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          press: crypto.randomUUID(),
          patches: [{ path: ["count"], value: 9 }],
        }),
      });
    expect(await (await asHuman(app)(apply())).json()).toMatchObject({ ok: true });
    const addressed = `${path}&target=${encodeURIComponent("C:\\Models\\Saved.rvt")}`;
    expect(await (await asHuman(app)(new Request(addressed))).json()).toMatchObject({
      revision: 2,
      doc: { count: 9 },
    });
    expect(await (await asHuman(app)(new Request(addressed))).json()).toMatchObject({
      revision: 2,
      doc: { count: 9 },
    });
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
      () => {},
    );
  }
});

test("host HTTP preserves addressless Work through close and replacement bridge frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-sweep-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = directory;
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  let sessions = [
    { connected: true, sessionId: "session", state: { openDocuments: [{ openId: "closed" }] } },
  ] as unknown as BridgeSessionView[];
  const frames: Array<{ kind: string; value?: { kind?: string; type?: string; action?: string } }> =
    [];
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events = yield* PubSub.unbounded<HostBridgeEvent>();
          const bridge = {
            events,
            list: Effect.sync(() => sessions),
            snapshot: () => Effect.sync(() => sessions[0] ?? { connected: false }),
            subscribe: (listener: (event: HostBridgeEvent) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          } as unknown as RevitBridge["Service"];
          const { routes: host, threads } = makeHostPeRoutes(
            "http://127.0.0.1:0",
            bridge,
            () => registrations,
          );
          yield* Effect.addFinalizer(() => Effect.sync(() => threads.close()));
          yield* Effect.gen(function* () {
            yield* Effect.promise(async () => {
              const response = await asHuman(host)(
                new Request(
                  `http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "world" }]))}`,
                ),
              );
              expect(response.status).toBe(200);
              const reader = response.body!.getReader();
              const collecting = (async () => {
                for (;;) {
                  const frame = await reader.read();
                  if (frame.done) return;
                  for (const data of new TextDecoder().decode(frame.value).split("\n\n"))
                    if (data.startsWith("data: ")) frames.push(JSON.parse(data.slice(6)));
                }
              })();
              try {
                const written = await asHuman(host)(
                  new Request(path.replace("?", "/apply?"), {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      expectedRevision: 0,
                      press: crypto.randomUUID(),
                      patches: [{ path: ["count"], value: 7 }],
                    }),
                  }),
                );
                expect(await written.json()).toMatchObject({ ok: true });
                sessions = [
                  { ...sessions[0], state: { ...sessions[0]!.state, openDocuments: [] } },
                ] as unknown as BridgeSessionView[];
                const emit = () => {
                  for (const listener of listeners)
                    listener({ kind: "state-sync", sessionId: "session" });
                };
                emit();
                const closes = () => frames.filter((frame) => frame.value?.kind === "state-sync");
                await expect.poll(() => closes().length).toBe(1);
                sessions = [
                  {
                    ...sessions[0],
                    state: { ...sessions[0]!.state, openDocuments: [{ openId: "replacement" }] },
                  },
                ] as unknown as BridgeSessionView[];
                emit();
                await expect.poll(() => closes().length).toBe(2);
                const read = await asHuman(host)(new Request(path));
                expect(await read.json()).toMatchObject({ revision: 1, doc: { count: 7 } });
                const replacement = await asHuman(host)(
                  new Request(path.replace("session/closed", "session/replacement")),
                );
                expect(await replacement.json()).toMatchObject({ revision: 0, doc: { count: 0 } });
                expect(frames.filter((frame) => frame.value?.action === "discard")).toEqual([]);
              } finally {
                await reader.cancel();
                await collecting;
              }
            });
          });
        }),
      ),
    );
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
      () => {},
    );
  }
}, 20_000);

/** The host's route-state surface checks every write's revision, body and caller. */
test("HTTP authored writes enforce short local revision checks", async () => {
  bindControl({
    heads: () => ({
      revision: 1,
      targets: [
        {
          request: { kind: "named", session: "session", address: address("C:/Models/A.rvt") },
          admission: null,
        },
      ],
    }),
  });
  const schema = z
    .object({
      bindings: routeBindingsSchema,
      values: z.record(z.string(), z.string()).default({}),
      count: z.number().int().default(0),
    })
    .prefault({});
  const catalogReads: unknown[] = [];
  const catalogRead = async (session?: unknown) => (
    catalogReads.push(session),
    {
      at: "2026-09-14T22:54:30.125Z",
      machine: machineFixture(),
      sources: {},
      diagnostics: [],
      capabilities: [],
    }
  );
  const app = createPeRoutes({
    registrations: [
      {
        spec: {
          route: "test-route",
          title: "Test Route",
          description: "A test collaborative route.",
          schema,
        },
      },
    ],
    store: (() => {
      const state = new Map<string, unknown>();
      return {
        getState: async ({ targetKey, route }: { targetKey: string; route: string }) =>
          structuredClone(state.get(`${targetKey}:${route}`)),
        setState: async ({
          targetKey,
          route,
          value,
        }: {
          targetKey: string;
          route: string;
          value: unknown;
        }) => {
          state.set(`${targetKey}:${route}`, structuredClone(value));
        },
      };
    })(),
    heads: { observe: () => () => {} },
    capabilityCatalog: { read: catalogRead },
    navigation: {
      documents: async () => [{ session: "session", openId: "a", address: "C:/Models/A.rvt" }],
      threads: async () => [],
    },
  });
  const queryA = `target=${encodeURIComponent(address(String.raw`C:\Models\A.rvt`))}`;
  expect(
    await asHuman(app)(new Request("http://local/pe/capabilities?session=session-exact")),
  ).toMatchObject({ status: 200 });
  expect(catalogReads).toContainEqual({ bridgeSessionId: "session-exact", session: undefined });
  const response = await asHuman(app)(
    new Request("http://local/pe/route-state/test-route?target=not-an-address"),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: /invalid Target/ });
  // E2E-J1: a registered route with no Work reads the empty document at r0.
  const absent = await asHuman(app)(
    new Request(`http://local/pe/route-state/test-route?${queryA}`),
  );
  expect(absent.status).toBe(200);
  expect(await absent.json()).toMatchObject({ route: "test-route", revision: 0, doc: {} });
  const unknown = await asHuman(app)(new Request(`http://local/pe/route-state/nope?${queryA}`));
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: "unknown route 'nope'" });

  const post = (path: string, body: unknown, as: Caller = human) =>
    withInvocationContext({ caller: as }, () =>
      app.fetch(
        new Request(`http://local${path}?${queryA}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    );
  expect(
    await (
      await post(
        "/pe/route-state/test-route/apply",
        {
          patches: [{ path: ["values", "http"], value: "landed" }],
          expectedRevision: 0,
          press: null,
        },
        pea(),
      )
    ).json(),
  ).toMatchObject({ ok: true, revision: 1 });
  // F-H6-4: a malformed body names the failing field and its shape.
  const stringPath = await post(
    "/pe/route-state/test-route/apply",
    { patches: [{ path: "scope.suggestion", value: 1 }], expectedRevision: 1 },
    pea(),
  );
  expect(stringPath.status).toBe(400);
  expect(await stringPath.json()).toMatchObject({
    ok: false,
    kind: "error",
    error: 'invalid body at patches[0].path: must be a segment array, e.g. ["scope","suggestion"]',
  });
  expect(
    await (await post("/pe/route-state/test-route/apply", { patches: [] }, pea())).json(),
  ).toMatchObject({ error: expect.stringMatching(/^invalid body at expectedRevision: /) });
  const edit = {
    patches: [{ path: ["count"], value: 1 }],
    expectedRevision: 1,
    press: crypto.randomUUID(),
  };
  expect(await (await post("/pe/route-state/test-route/apply", edit)).json()).toMatchObject({
    ok: true,
    revision: 2,
  });
  expect(
    await (
      await post("/pe/route-state/test-route/apply", { ...edit, expectedRevision: 99 })
    ).json(),
  ).toMatchObject({ ok: false, code: "stale_revision" });
  // Both authors share recovery; readable Work has nothing to set aside.
  expect(
    await (await post("/pe/route-state/test-route/start-fresh", {}, pea())).json(),
  ).toMatchObject({ ok: false, error: "this route's Work is readable" });
  expect(await (await post("/pe/route-state/test-route/start-fresh", {})).json()).toMatchObject({
    ok: false,
    error: "this route's Work is readable",
  });
  // A route that declares no salvage has nothing for either author.
  const salvage = (as: Caller) =>
    withInvocationContext({ caller: as }, () =>
      app.fetch(new Request(`http://local/pe/route-state/test-route/salvage?${queryA}`)),
    );
  expect((await salvage(human)).status).toBe(404);
  expect((await salvage(pea())).status).toBe(404);
  // Work has no execution endpoint; consequential commands belong to the journal door.
  expect(
    (await post("/pe/route-state/test-route/command", { command: "external", input: {} })).status,
  ).toBe(404);
});
