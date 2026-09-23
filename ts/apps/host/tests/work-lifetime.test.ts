import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { takeoffsRouteState, threadHeadSchema } from "@pe/agent-contracts";
import { buildAgentControllerApp } from "../../../packages/runtime/src/agent-controller-web.ts";
import { createDeterministicRuntime } from "@pe/runtime/testing";
import {
  RouteWorkspace,
  type RouteDocumentStore,
} from "../../../packages/runtime/src/route-workspace.ts";
import { Effect, Layer, PubSub } from "effect";
import { HttpServer } from "effect/unstable/http";
import { RevitBridge, type HostBridgeEvent, type BridgeSessionView } from "../src/bridge.ts";
import { makeMastraRuntimeLive, MastraRuntime } from "../src/mastra-runtime.ts";

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
  const runtime = await createDeterministicRuntime({
    databasePath: join(directory, "work.db"),
    resourceId: "work-proof",
    responses: [],
  });
  try {
    const threadState = (await runtime.mastra!.getStorage()!.getStore("threadState"))!;
    const store: RouteDocumentStore = {
      getState: ({ targetKey, route }) =>
        threadState.getState({ threadId: "work-proof", type: `${route}:${targetKey}` }),
      setState: ({ targetKey, route, value }) =>
        threadState.setState({ threadId: "work-proof", type: `${route}:${targetKey}`, value }),
    };
    const app = await buildAgentControllerApp({
      runtime,
      label: "pea",
      routeRegistrations: registrations,
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
    await runtime.close?.();
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
          const tenant = makeMastraRuntimeLive(
            { revit: true },
            () => registrations,
            async () =>
              createDeterministicRuntime({
                databasePath: join(directory, "work.db"),
                resourceId: "sweep-proof",
                responses: [],
              }),
          ).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(RevitBridge, bridge),
                Layer.succeed(HttpServer.HttpServer, {
                  address: { _tag: "TcpAddress", port: 0, hostname: "127.0.0.1" },
                  serve: () => Effect.void,
                }),
              ),
            ),
          );
          yield* Effect.gen(function* () {
            const host = yield* MastraRuntime;
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
          }).pipe(Effect.provide(tenant));
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
