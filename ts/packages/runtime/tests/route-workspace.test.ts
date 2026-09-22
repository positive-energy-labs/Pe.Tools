import { observeResources, resourceResponse } from "../src/resource-stream.ts";
import { ScopeStore } from "../src/scope-store.ts";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { address, routeBindingsSchema } from "@pe/agent-contracts";
import type {
  RouteActor,
  RouteStateCommandHandlers,
  RouteStatePatch,
  RouteStateSpec,
  WorkKey,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { buildAgentControllerApp } from "../src/agent-controller-web.ts";
import { createPeaRuntime } from "../src/pea-runtime.ts";
import type {
  RouteDocumentStore,
  RouteWorkspaceEvent,
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
    fail: async () => {
      throw new Error("deliberate failure");
    },
    ...overrides,
  };
  return { spec: spec as unknown as RouteStateSpec<z.ZodType>, handlers };
}

function memoryStore() {
  const state = new Map<string, unknown>();
  const key = (targetKey: string, route: string) => `${targetKey}\0${route}`;
  const store: RouteDocumentStore = {
    getState: async ({ targetKey, route }) => structuredClone(state.get(key(targetKey, route))),
    setState: async ({ targetKey, route, value }) => {
      state.set(key(targetKey, route), structuredClone(value));
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

const documentA: WorkKey = { route: "test-route", target: address("C:\\Models\\A.rvt") };
const documentB: WorkKey = { route: "test-route", target: address("C:\\Models\\B.rvt") };
const queryA = `target=${encodeURIComponent(documentA.target!)}`;

function bind(module: RouteWorkspace, scope: WorkKey = documentA) {
  return {
    read: () => module.read(scope, "test-route"),
    apply: (actor: RouteActor, patches: RouteStatePatch[], revision: number) =>
      module.apply(scope, "test-route", actor, patches, revision),
    cmd: (actor: RouteActor, command: string, input: unknown, revision: number) =>
      module.command(scope, "test-route", actor, command, input, revision),
  };
}

test("document-scoped route documents are isolated and survive module recreation", async () => {
  const { store } = memoryStore();
  const first = workspace(store);
  const firstA = bind(first);
  expect(await firstA.apply("agent", [{ path: ["values", "a"], value: "A" }], 0)).toMatchObject({
    ok: true,
  });

  expect(await bind(first, documentB).read()).toBeNull();
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
  expect(await w.read()).toBeNull();
  const revision = 0;

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
  expect(await w.read()).toBeNull();
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
  expect(await w.cmd("agent", "fail", {}, 1)).toMatchObject({
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

// External replay/collision/reconstruction proof lives in host partition-operation.test.ts through /actions.

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

// Durable large-result / serialization-loss proof lives in host gateway.test.ts on ActionJournal.

test("HTTP authored writes enforce short local revision checks", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-route-state-"));
  const runtime = await createPeaRuntime({ workspaceRoot });
  const external = vi.fn(async () => ({ mutated: true }));
  const catalogRead = vi.fn(async () => ({
    at: "2026-09-14T22:54:30.125Z",
    sessions: [],
    sources: {},
    capabilities: [],
  }));
  try {
    const app = await buildAgentControllerApp({
      runtime,
      label: "pea",
      capabilityCatalog: { read: catalogRead },
      routeRegistrations: [registration({ external })],
    });
    expect(
      await app.fetch(new Request("http://local/pe/capabilities?session=session-exact")),
    ).toMatchObject({ status: 200 });
    expect(catalogRead).toHaveBeenCalledWith("session-exact");
    const response = await app.fetch(
      new Request("http://local/pe/route-state/test-route?target=not-an-address"),
    );
    expect(response.status).toBe(400);
    // E2E-J1: a registered route with no Work at the scope reads the empty document at r0, the
    // one apply starts from; "unknown route" names only an unregistered route.
    const absent = await app.fetch(new Request(`http://local/pe/route-state/test-route?${queryA}`));
    expect(absent.status).toBe(200);
    expect(await absent.json()).toMatchObject({ route: "test-route", revision: 0, doc: {} });
    const unknown = await app.fetch(new Request(`http://local/pe/route-state/nope?${queryA}`));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "unknown route 'nope'" });
    expect(await response.json()).toMatchObject({ error: /invalid Target/ });

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
    // F-H6-4: a malformed body names the failing field and its shape, read off the schema's issue.
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
    const command = {
      command: "increment",
      input: {},
      expectedRevision: 1,
    };
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
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 30_000);

test("resource stream publishes absent Work, an applied revision, and ends on abort", async () => {
  const module = workspace(memoryStore().store);
  const scopes = new ScopeStore(
    async () => ({ getState: async () => null, setState: async () => {} }),
    "test",
  );
  const abort = new AbortController();
  const response = resourceResponse(
    new Request(
      `http://host/pe/resources?${new URLSearchParams({ keys: JSON.stringify([{ kind: "work", ...documentA }]) }).toString()}`,
      { signal: abort.signal },
    ),
    observeResources(module, scopes),
  );
  const reader = response.body!.getReader();
  expect(await readSse(reader)).toMatchObject({ kind: "snapshot", value: null });
  await bind(module).apply("human", [{ path: ["values", "sse"], value: "landed" }], 0);
  expect(await readSse(reader)).toMatchObject({
    kind: "snapshot",
    value: { revision: 1, doc: { values: { sse: "landed" } } },
  });
  abort.abort();
  await expect(reader.read()).rejects.toThrow("closed");
});

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

/* ── Addressless Work is ephemeral (design-system ledger, 2026-09-22) ─────────────────────── */

const unsaved: WorkKey = {
  route: "test-route",
  target: null,
  open: { session: "revit", openId: "doc-1" },
};
const savedAs: WorkKey = { ...unsaved, target: address("C:\\Models\\Saved.rvt") };

test("an unsaved document's Work keys by its open lifetime and never by the empty target", async () => {
  const { store, state } = memoryStore();
  const module = workspace(store);
  expect(
    await bind(module, unsaved).apply("human", [{ path: ["values", "a"], value: "A" }], 0),
  ).toMatchObject({ ok: true });
  expect([...state.keys()]).toEqual(["test-route/open:revit/doc-1\0test-route"]);
  // A second unsaved document in the same session shares nothing with the first.
  const other = { ...unsaved, open: { session: "revit", openId: "doc-2" } };
  expect(await bind(module, other).read()).toBeNull();
});

test("Save As carries the addressless Work to the Address once and silently", async () => {
  const { store, state } = memoryStore();
  const module = workspace(store);
  await bind(module, unsaved).apply("human", [{ path: ["values", "a"], value: "A" }], 0);

  const events: RouteWorkspaceEvent[] = [];
  module.subscribe((event) => events.push(event));
  expect((await bind(module, savedAs).read())?.doc).toMatchObject({ values: { a: "A" } });
  // The migration is a move, not a copy, and says nothing on the event stream.
  expect(events).toEqual([]);
  expect(state.get("test-route/open:revit/doc-1\0test-route")).toBeNull();

  // Once. Work written at the Address afterwards is never overwritten by a re-read.
  await bind(module, savedAs).apply("human", [{ path: ["values", "b"], value: "B" }], 1);
  await bind(module, unsaved).apply("human", [{ path: ["values", "a"], value: "later" }], 0);
  expect((await bind(module, savedAs).read())?.doc).toMatchObject({ values: { a: "A", b: "B" } });
});

test("an addressed document's own Work is never replaced by a stale addressless carry-over", async () => {
  const { store } = memoryStore();
  const module = workspace(store);
  await bind(module, unsaved).apply("human", [{ path: ["values", "a"], value: "unsaved" }], 0);
  await bind(module, { route: "test-route", target: savedAs.target }).apply(
    "human",
    [{ path: ["values", "a"], value: "addressed" }],
    0,
  );
  expect((await bind(module, savedAs).read())?.doc).toMatchObject({ values: { a: "addressed" } });
});

test("the sweep discards an addressless Work when its lifetime leaves the session inventory", async () => {
  const { store } = memoryStore();
  const module = workspace(store);
  const events: RouteWorkspaceEvent[] = [];
  await bind(module, unsaved).apply("human", [{ path: ["values", "a"], value: "A" }], 0);
  await bind(module, documentA).apply("human", [{ path: ["values", "a"], value: "A" }], 0);
  module.subscribe((event) => events.push(event));

  // The lifetime is still listed: nothing is swept.
  expect(await module.sweepOpen([{ session: "revit", openId: "doc-1" }])).toBe(0);
  // The session is gone, not the document: a detached bridge is not a closed document.
  expect(await module.sweepOpen([])).toBe(0);
  // The session is there and no longer lists the document: that Work ended with it.
  expect(await module.sweepOpen([{ session: "revit", openId: "doc-2" }])).toBe(1);

  expect(await bind(module, unsaved).read()).toBeNull();
  // Addressed Work is never discarded from under a person.
  expect((await bind(module, documentA).read())?.doc).toMatchObject({ values: { a: "A" } });
  expect(events).toEqual([
    {
      type: "route_workspace",
      scope: unsaved,
      route: "test-route",
      actor: "human",
      action: "discard",
      revision: 0,
      ok: true,
      removed: 1,
    },
  ]);
  // Swept once: the lifetime is forgotten with its Work.
  expect(await module.sweepOpen([{ session: "revit", openId: "doc-2" }])).toBe(0);
});

test("the sweep says how many Works one closed lifetime took with it", async () => {
  const { store } = memoryStore();
  const module = new RouteWorkspace({
    registrations: [
      registration(),
      { ...registration(), spec: { ...registration().spec, route: "other-route" } },
    ],
    store,
  });
  await bind(module, unsaved).apply("human", [{ path: ["values", "a"], value: "A" }], 0);
  await module.apply(
    { ...unsaved, route: "other-route" },
    "other-route",
    "human",
    [{ path: ["values", "a"], value: "A" }],
    0,
  );
  const events: RouteWorkspaceEvent[] = [];
  module.subscribe((event) => events.push(event));

  expect(await module.sweepOpen([{ session: "revit", openId: "doc-2" }])).toBe(2);
  expect(events.map((event) => [event.route, event.removed])).toEqual([
    ["test-route", 2],
    ["other-route", 2],
  ]);
});
