import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { address, routeBindingsSchema } from "@pe/agent-contracts";
import type { RouteScope, RouteStateCommandHandlers, RouteStateSpec } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { buildAgentControllerApp } from "../src/agent-controller-web.ts";
import { createPeaRuntime } from "../src/pea-runtime.ts";
import type {
  RouteDocumentStore,
  RouteWorkspaceActor,
  RouteWorkspaceEvent,
  RouteWorkspacePatch,
  RouteWorkspaceRegistration,
} from "../src/route-workspace.ts";

const documentSchema = z
  .object({
    bindings: routeBindingsSchema,
    values: z.record(z.string(), z.string()).default({}),
    count: z.number().int().default(0),
  })
  .prefault({});
type TestDocument = z.infer<typeof documentSchema>;

function registration(
  overrides: Partial<RouteStateCommandHandlers<TestDocument>> = {},
): RouteWorkspaceRegistration {
  const spec = {
    route: "test-route",
    title: "Test Route",
    description: "A test collaborative route.",
    schema: documentSchema,
    agentWriteMask: [["values"]],
    commands: {
      increment: {
        description: "Increment the counter.",
        actor: "any",
        input: z.object({}),
      },
      external: {
        description: "Mutate an external system.",
        actor: "human",
        input: z.object({}),
        mutatesExternal: true,
      },
      recover: {
        description: "Recover external state.",
        actor: "human",
        input: z.object({}),
        recoversExternal: true,
      },
      fail: {
        description: "Fail for chronology proof.",
        actor: "human",
        input: z.object({}),
      },
    },
  } satisfies RouteStateSpec<typeof documentSchema>;
  const handlers: RouteStateCommandHandlers<TestDocument> = {
    increment: async (_input, context) => {
      const doc = context.getDoc();
      doc.count++;
      await context.setDoc(doc);
      return { count: doc.count };
    },
    external: async () => ({ mutated: true }),
    recover: async () => ({ recovered: true }),
    fail: async () => {
      throw new Error("deliberate failure");
    },
    ...overrides,
  };
  return { spec: spec as unknown as RouteStateSpec<z.ZodType>, handlers };
}

function memoryStore() {
  const state = new Map<string, unknown>();
  const key = (scopeKey: string, route: string) => `${scopeKey}\0${route}`;
  const store: RouteDocumentStore = {
    getState: async ({ scopeKey, route }) => structuredClone(state.get(key(scopeKey, route))),
    setState: async ({ scopeKey, route, value }) => {
      state.set(key(scopeKey, route), structuredClone(value));
    },
  };
  return { store, state };
}

function workspace(
  store: RouteDocumentStore,
  options: {
    registration?: RouteWorkspaceRegistration;
  } = {},
) {
  return new RouteWorkspace({
    registrations: [options.registration ?? registration()],
    store,
  });
}

const documentA = {
  scope: { kind: "pinned", session: "pe.app-25", document: address("C:\\Models\\A.rvt") },
} as const;
const documentB = {
  scope: { kind: "document", document: address("C:\\Models\\B.rvt") },
} as const;
const queryA = `session=pe.app-25&doc=${encodeURIComponent(documentA.scope.document)}`;

function bind(module: RouteWorkspace, scope: RouteScope = documentA) {
  return {
    read: () => module.read(scope, "test-route"),
    apply: (actor: RouteWorkspaceActor, patches: RouteWorkspacePatch[], revision: number) =>
      module.apply(scope, "test-route", actor, patches, revision),
    cmd: (
      actor: RouteWorkspaceActor,
      command: string,
      input: unknown,
      revision: number,
      requestId?: string,
    ) => module.command(scope, "test-route", actor, command, input, revision, requestId),
  };
}

test("document-scoped route documents are isolated and survive module recreation", async () => {
  const { store } = memoryStore();
  const first = workspace(store);
  const firstA = bind(first);
  expect(await firstA.apply("agent", [{ path: ["values", "a"], value: "A" }], 0)).toMatchObject({
    ok: true,
  });

  expect((await bind(first, documentB).read())?.doc).toMatchObject({ values: {} });
  const second = workspace(store);
  const secondA = bind(second);
  expect((await secondA.read())?.doc).toMatchObject({ values: { a: "A" } });

  expect(
    await secondA.apply(
      "human",
      [
        {
          path: ["bindings", "profile"],
          value: { id: "profile-a", label: "Profile A" },
        },
      ],
      1,
    ),
  ).toMatchObject({ ok: true });
  const restarted = workspace(store);
  const reloaded = (await bind(restarted).read())?.doc as TestDocument;
  expect(reloaded.bindings.profile?.id).toBe("profile-a");

  expect(second.list()).toEqual([
    {
      route: "test-route",
      title: "Test Route",
      description: "A test collaborative route.",
    },
  ]);
});

test("apply and command serialize without losing either update", async () => {
  const { store } = memoryStore();
  const started = deferred<void>();
  const release = deferred<void>();
  const route = registration({
    increment: async (_input, context) => {
      const doc = context.getDoc();
      started.resolve();
      await release.promise;
      doc.count++;
      await context.setDoc(doc);
      return { count: doc.count };
    },
  });
  const module = workspace(store, { registration: route });
  const w = bind(module);

  const command = w.cmd("agent", "increment", {}, 0);
  await started.promise;
  const apply = w.apply("agent", [{ path: ["values", "name"], value: "kept" }], 1);
  release.resolve();
  expect(await command).toMatchObject({ ok: true });
  expect(await apply).toMatchObject({ ok: true });
  expect((await w.read())?.doc).toMatchObject({
    count: 1,
    values: { name: "kept" },
  });
});

test("apply refuses a revision that moved", async () => {
  const { store } = memoryStore();
  const module = workspace(store);
  const w = bind(module);
  const revision = (await w.read())!.revision;

  expect(await w.apply("human", [{ path: ["count"], value: 1 }], revision)).toMatchObject({
    ok: true,
  });
  expect(await w.apply("human", [{ path: ["count"], value: 2 }], revision)).toMatchObject({
    ok: false,
    error: "the document moved to r1",
  });
  expect((await w.read())?.doc).toMatchObject({ count: 1 });
});

test("a handler throw discards its staged document write", async () => {
  const { store } = memoryStore();
  const module = workspace(store, {
    registration: registration({
      fail: async (_input, context) => {
        const doc = context.getDoc();
        doc.count = 1;
        await context.setDoc(doc);
        throw new Error("deliberate failure");
      },
    }),
  });
  const w = bind(module);

  expect(await w.cmd("human", "fail", {}, 0)).toMatchObject({
    ok: false,
  });
  expect(await w.read()).toMatchObject({
    revision: 0,
    doc: { count: 0 },
  });
});

test("registration rejects route delimiters and schemas that cannot become JSON Schema", () => {
  const { store } = memoryStore();
  const colonRoute = registration();
  colonRoute.spec.route = "bad:route";
  expect(() => workspace(store, { registration: colonRoute })).toThrow("cannot contain ':'");

  const badDocument = registration();
  badDocument.spec.schema = z.date() as unknown as typeof documentSchema;
  expect(() => workspace(store, { registration: badDocument })).toThrow();

  const badCommand = registration();
  badCommand.spec.commands.increment!.input = z.date();
  expect(() => workspace(store, { registration: badCommand })).toThrow();
});

test("an abandoned external mutation becomes outcomeUnknown and recovery clears it", async () => {
  const { store, state } = memoryStore();
  const started = deferred<void>();
  const never = new Promise<never>(() => undefined);
  const route = registration({
    external: async () => {
      started.resolve();
      return never;
    },
  });
  const crashed = workspace(store, { registration: route });
  void bind(crashed).cmd("human", "external", {}, 0, "crash-1");
  await started.promise;

  const restarted = workspace(store, { registration: route });
  const w = bind(restarted);
  expect(await w.read()).toMatchObject({
    status: "outcomeUnknown",
    outcomeUnknown: { command: "external" },
  });
  expect(JSON.stringify([...state.values()])).not.toContain('"receipts"');
  expect(await w.cmd("human", "external", {}, 0, "crash-1")).toMatchObject({
    ok: false,
    kind: "refused",
    error: expect.stringContaining("blocked"),
  });
  expect(await w.cmd("human", "recover", {}, 0)).toMatchObject({ ok: true });
  expect(await w.read()).toMatchObject({ status: "ready" });
});

test("mask, schema, and human command gate are enforced", async () => {
  const { store } = memoryStore();
  const module = workspace(store);
  const w = bind(module);
  expect(await w.apply("agent", [{ path: ["count"], value: 1 }], 0)).toMatchObject({
    ok: false,
    hint: expect.stringContaining("human-only"),
  });
  expect(await w.apply("agent", [{ path: ["values", "bad"], value: 42 }], 0)).toMatchObject({
    ok: false,
    error: "the patched document is invalid",
  });
  expect(await w.apply("human", [{ path: ["count"], value: 1 }], 0)).toMatchObject({ ok: true });
  expect(await w.cmd("agent", "external", {}, 1)).toMatchObject({
    ok: false,
    error: expect.stringContaining("human-only"),
  });
  expect(await w.cmd("human", "bind", { target: "session:x" }, 1)).toMatchObject({
    ok: false,
    error: "unknown command 'bind'",
  });
});

test("publishes all action outcomes", async () => {
  const { store } = memoryStore();
  const published: RouteWorkspaceEvent[] = [];
  const module = workspace(store);
  const w = bind(module);
  module.subscribe((event) => published.push(event));

  await w.apply("agent", [{ path: ["values", "agent"], value: "proposal" }], 0);
  await bind(module, documentB).apply("human", [{ path: ["count"], value: 1 }], 0);
  await w.apply("human", [{ path: ["count"], value: 2 }], 1);
  expect(await w.cmd("human", "fail", {}, 2)).toMatchObject({
    ok: false,
  });

  expect(published).toHaveLength(4);
  expect(published[1]?.scope).toEqual(documentB);
});

test("external replay precedes revision checks and rejects request-id collisions", async () => {
  const { store } = memoryStore();
  const external = vi.fn(async () => ({ mutated: true }));
  const module = workspace(store, { registration: registration({ external }) });
  const w = bind(module);
  const input = { b: 2, nested: { y: 2, x: 1 }, a: 1 };

  expect(await w.cmd("human", "external", input, 0, "request-1")).toMatchObject({
    ok: true,
    revision: 0,
    result: { mutated: true },
  });
  expect(
    await w.cmd("human", "external", { a: 1, nested: { x: 1, y: 2 }, b: 2 }, 99, "request-1"),
  ).toMatchObject({ ok: true, revision: 0, result: { mutated: true } });
  expect(external).toHaveBeenCalledOnce();

  expect(await w.cmd("human", "increment", {}, 0, "request-1")).toMatchObject({
    ok: false,
    code: "request_id_conflict",
  });
  expect(
    await w.cmd("human", "external", { a: 2, nested: { x: 1, y: 2 }, b: 2 }, 0, "request-1"),
  ).toMatchObject({ ok: false, code: "request_id_conflict" });
  expect(external).toHaveBeenCalledOnce();
});

test("recreated workspaces retain and replay external receipts", async () => {
  const { store } = memoryStore();
  const external = vi.fn(async () => ({ persisted: true }));
  const route = registration({ external });
  await bind(workspace(store, { registration: route })).cmd(
    "human",
    "external",
    {},
    0,
    "request-reload",
  );

  expect(
    await bind(workspace(store, { registration: route })).cmd(
      "human",
      "external",
      {},
      99,
      "request-reload",
    ),
  ).toMatchObject({ ok: true, revision: 0, result: { persisted: true } });
  expect(external).toHaveBeenCalledOnce();
});

test("stale commands never invoke and successful writes return landed revisions", async () => {
  const { store } = memoryStore();
  const increment = vi.fn(registration().handlers.increment!);
  const module = workspace(store, { registration: registration({ increment }) });
  const w = bind(module);

  expect(await w.apply("human", [{ path: ["count"], value: 1 }], 0)).toMatchObject({
    ok: true,
    revision: 1,
  });
  expect(await w.cmd("agent", "increment", {}, 0)).toMatchObject({
    ok: false,
    kind: "refused",
    code: "stale_revision",
  });
  expect(increment).not.toHaveBeenCalled();
  expect(await w.cmd("agent", "increment", {}, 1)).toMatchObject({
    ok: true,
    revision: 2,
  });
  expect(increment).toHaveBeenCalledOnce();
});

test("non-JSON and oversized results complete once but cannot replay", async () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  for (const completed of [circular, "x".repeat(8 * 1024 + 1)]) {
    const { store } = memoryStore();
    const external = vi.fn(async () => completed);
    const module = workspace(store, { registration: registration({ external }) });
    const w = bind(module);

    const first = await w.cmd("human", "external", {}, 0, "request-large");
    expect(first).toMatchObject({ ok: true, revision: 0 });
    if (typeof completed === "string") expect(first).toMatchObject({ result: completed });
    else expect(first).not.toHaveProperty("result");
    expect(await w.cmd("human", "external", {}, 99, "request-large")).toMatchObject({
      ok: false,
      kind: "refused",
      code: "replay_unavailable",
    });
    expect(external).toHaveBeenCalledOnce();
  }
});

test("HTTP writes forward revision and request identity while refusing a missing doc", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-route-state-"));
  const runtime = await createPeaRuntime({ workspaceRoot });
  const external = vi.fn(async () => ({ mutated: true }));
  try {
    const app = await buildAgentControllerApp({
      runtime,
      label: "pea",
      routeRegistrations: [registration({ external })],
    });
    const response = await app.fetch(
      new Request("http://local/pe/route-state/test-route?doc=not-an-address"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: /invalid route scope/ });

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
    const command = {
      command: "external",
      input: {},
      expectedRevision: 1,
      requestId: "http-request-1",
    };
    expect(await (await post("/pe/route-state/test-route/command", command)).json()).toMatchObject({
      ok: true,
      revision: 1,
    });
    expect(
      await (
        await post("/pe/route-state/test-route/command", {
          ...command,
          expectedRevision: 99,
        })
      ).json(),
    ).toMatchObject({ ok: true, revision: 1 });
    expect(external).toHaveBeenCalledOnce();
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 30_000);

test("route event stream publishes an applied revision and ends on abort", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-route-events-"));
  const runtime = await createPeaRuntime({ workspaceRoot });
  const abort = new AbortController();
  let server: ReturnType<typeof serve> | undefined;
  try {
    const app = await buildAgentControllerApp({
      runtime,
      label: "pea",
      routeRegistrations: [registration()],
    });
    server = serve({ fetch: app.fetch, port: 0 });
    await once(server, "listening");
    const socket = server.address();
    if (!socket || typeof socket === "string") throw new Error("Expected a TCP server.");
    const base = `http://127.0.0.1:${socket.port}`;
    const response = await fetch(`${base}/pe/route-state/test-route/events?${queryA}`, {
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    expect((await readSse(reader)).revision).toBe(0);

    await fetch(`${base}/pe/route-state/test-route/apply?${queryA}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patches: [{ path: ["values", "sse"], value: "landed" }],
        expectedRevision: 0,
      }),
    });
    expect(await readSse(reader)).toMatchObject({
      revision: 1,
      doc: { values: { sse: "landed" } },
    });

    abort.abort();
    const ended = await reader.read().then(
      ({ done }) => done,
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    expect(ended).toBe(true);
  } finally {
    abort.abort();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 30_000);

async function readSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Record<string, unknown>> {
  const { value, done } = await reader.read();
  if (done || !value) throw new Error("Expected an SSE frame.");
  const data = new TextDecoder()
    .decode(value)
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  if (!data) throw new Error("Expected SSE data.");
  return JSON.parse(data) as Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
