import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  address,
  routeBindingsSchema,
  takeoffsRouteState,
  threadHeadSchema,
} from "@pe/agent-contracts";
import { RouteWorkspace, type RouteWorkspaceRegistration } from "@pe/runtime";
import { Effect, PubSub } from "effect";
import type { RevitBridge, HostBridgeEvent, BridgeSessionView } from "../src/bridge.ts";
import { createPeRoutes, fileRouteDocumentStore, makeHostPeRoutes } from "../src/pe-routes.ts";

const registrations = [
  {
    spec: {
      route: "test",
      title: "Test",
      description: "Lifetime proof",
      schema: takeoffsRouteState.schema.extend({
        count: threadHeadSchema.shape.revision.default(0),
      }),
      agentWriteMask: [["count"]],
      commands: {},
    },
    handlers: {},
  },
];
const open = {
  binding: "open",
  route: "test",
  target: null,
  open: { session: "session", openId: "closed" },
} as const;
const path = "http://host/pe/route-state/test?open=session/closed";

test("HTTP Work written before workspace recreation is swept by the next workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-work-"));
  try {
    const store = fileRouteDocumentStore(join(directory, "work"));
    const app = createPeRoutes({
      registrations,
      store,
      heads: { observe: () => () => {} },
    });
    const written = await app.fetch(
      new Request(`${path.replace("?", "/apply?")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 0, patches: [{ path: ["count"], value: 7 }] }),
      }),
    );
    expect(await written.json()).toMatchObject({ ok: true, revision: 1 });
    const restarted = new RouteWorkspace({ registrations, store });
    expect(await restarted.sweepOpen([open.open])).toBe(0);
    expect(await restarted.sweepOpen([])).toBe(0);
    expect(await restarted.sweepOpen([{ session: "session", openId: "still-open" }])).toBe(1);
    expect(await restarted.sweepOpen([{ session: "session", openId: "still-open" }])).toBe(0);
    expect(await restarted.read(open, "test")).toBeNull();
    const read = await app.fetch(new Request(path));
    expect(await read.json()).toMatchObject({ revision: 0, doc: { count: 0 } });

    // Save As moves the bytes; closing the original lifetime cannot discard the addressed Work.
    const apply = () =>
      new Request(path.replace("?", "/apply?"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 0, patches: [{ path: ["count"], value: 9 }] }),
      });
    expect(await (await app.fetch(apply())).json()).toMatchObject({ ok: true });
    const addressed = `${path}&target=${encodeURIComponent("C:\\Models\\Saved.rvt")}`;
    expect(await (await app.fetch(new Request(addressed))).json()).toMatchObject({
      revision: 1,
      doc: { count: 9 },
    });
    expect(await restarted.sweepOpen([{ session: "session", openId: "still-open" }])).toBe(0);
    expect(await (await app.fetch(new Request(addressed))).json()).toMatchObject({
      revision: 1,
      doc: { count: 9 },
    });
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
      () => {},
    );
  }
});

test("host HTTP publishes one discard when a bridge frame closes the last document", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-sweep-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = directory;
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  let sessions = [
    { connected: true, sessionId: "session", state: { openDocuments: [{ openId: "closed" }] } },
  ] as unknown as BridgeSessionView[];
  const frames: Array<{ kind: string; value?: { type?: string; action?: string } }> = [];
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
              const response = await host.fetch(
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
                const written = await host.fetch(
                  new Request(path.replace("?", "/apply?"), {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      expectedRevision: 0,
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
                const discards = () =>
                  frames.filter(
                    (frame) =>
                      frame.value?.type === "route_workspace" && frame.value.action === "discard",
                  );
                await expect.poll(() => discards().length).toBe(1);
                emit();
                const read = await host.fetch(new Request(path));
                expect(await read.json()).toMatchObject({ revision: 0, doc: { count: 0 } });
                expect(discards()).toHaveLength(1);
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

/** The host's route-state surface checks every write's revision, body and actor. */
test("HTTP authored writes enforce short local revision checks", async () => {
  const schema = z
    .object({
      bindings: routeBindingsSchema,
      values: z.record(z.string(), z.string()).default({}),
      count: z.number().int().default(0),
    })
    .prefault({});
  let externalCalls = 0;
  const external = async () => (externalCalls++, { mutated: true });
  const catalogReads: unknown[] = [];
  const catalogRead = async (session?: unknown) => (
    catalogReads.push(session),
    {
      at: "2026-09-14T22:54:30.125Z",
      sessions: [],
      sources: {},
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
          agentWriteMask: [["values"]],
          commands: {
            increment: { description: "Increment.", actor: "any", input: z.object({}) },
            external: { description: "External.", actor: "human", input: z.object({}) },
          },
        },
        handlers: {
          increment: async (_input: unknown, context: any) => {
            const doc = context.getDoc();
            doc.count++;
            await context.setDoc(doc);
            return { count: doc.count };
          },
          external,
        },
      },
    ] as unknown as RouteWorkspaceRegistration[],
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
  });
  const queryA = `target=${encodeURIComponent(address(String.raw`C:\Models\A.rvt`))}`;
  expect(
    await app.fetch(new Request("http://local/pe/capabilities?session=session-exact")),
  ).toMatchObject({ status: 200 });
  expect(catalogReads).toContain("session-exact");
  const response = await app.fetch(
    new Request("http://local/pe/route-state/test-route?target=not-an-address"),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: /invalid Target/ });
  // E2E-J1: a registered route with no Work reads the empty document at r0.
  const absent = await app.fetch(new Request(`http://local/pe/route-state/test-route?${queryA}`));
  expect(absent.status).toBe(200);
  expect(await absent.json()).toMatchObject({ route: "test-route", revision: 0, doc: {} });
  const unknown = await app.fetch(new Request(`http://local/pe/route-state/nope?${queryA}`));
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: "unknown route 'nope'" });

  const post = (path: string, body: unknown) =>
    app.fetch(
      new Request(`http://local${path}?${queryA}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  expect(
    await (
      await post("/pe/agent/route-state/test-route/apply", {
        patches: [{ path: ["values", "http"], value: "landed" }],
        expectedRevision: 0,
      })
    ).json(),
  ).toMatchObject({ ok: true, revision: 1 });
  // F-H6-4: a malformed body names the failing field and its shape.
  const stringPath = await post("/pe/agent/route-state/test-route/apply", {
    patches: [{ path: "scope.proposal", value: 1 }],
    expectedRevision: 1,
  });
  expect(stringPath.status).toBe(400);
  expect(await stringPath.json()).toMatchObject({
    ok: false,
    kind: "error",
    error: 'invalid body at patches[0].path: must be a segment array, e.g. ["scope","proposal"]',
  });
  expect(
    await (await post("/pe/agent/route-state/test-route/apply", { patches: [] })).json(),
  ).toMatchObject({ error: expect.stringMatching(/^invalid body at expectedRevision: /) });
  const command = { command: "increment", input: {}, expectedRevision: 1 };
  expect(await (await post("/pe/route-state/test-route/command", command)).json()).toMatchObject({
    ok: true,
    revision: 2,
  });
  expect(
    await (
      await post("/pe/route-state/test-route/command", { ...command, expectedRevision: 99 })
    ).json(),
  ).toMatchObject({ ok: false, code: "stale_revision" });
  // Start fresh is a human verb: Pea's door refuses it, and readable Work has nothing to set aside.
  expect(
    await (await post("/pe/agent/route-state/test-route/start-fresh", {})).json(),
  ).toMatchObject({ ok: false, error: "start fresh is human-only" });
  expect(await (await post("/pe/route-state/test-route/start-fresh", {})).json()).toMatchObject({
    ok: false,
    error: "this route's Work is readable",
  });
  // Salvage is a human read: a route that declares none has nothing (404); Pea is refused by name.
  const salvage = (prefix: string) =>
    app.fetch(new Request(`http://local${prefix}/test-route/salvage?${queryA}`));
  expect((await salvage("/pe/route-state")).status).toBe(404);
  const pea = await salvage("/pe/agent/route-state");
  expect(pea.status).toBe(403);
  expect(await pea.json()).toMatchObject({ ok: false, error: "salvage is human-only" });
  expect(externalCalls).toBe(0);
});
