import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { address, current, routeBindingsSchema } from "@pe/agent-contracts";
import type { RouteStateCommandHandlers, RouteStateSpec } from "@pe/agent-contracts";
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
  const key = (documentAddress: string, route: string) => `${documentAddress}\0${route}`;
  const store: RouteDocumentStore = {
    getState: async ({ documentAddress, route }) =>
      structuredClone(state.get(key(documentAddress, route))),
    setState: async ({ documentAddress, route, value }) => {
      state.set(key(documentAddress, route), structuredClone(value));
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

const documentA = { documentAddress: address("C:\\Models\\A.rvt") } as const;
const documentB = { documentAddress: address("C:\\Models\\B.rvt") } as const;

test("document-scoped route documents are isolated and survive module recreation", async () => {
  const { store } = memoryStore();
  const first = workspace(store);
  expect(
    await first.apply(documentA, "test-route", "agent", [{ path: ["values", "a"], value: "A" }]),
  ).toMatchObject({ ok: true });

  expect((await first.read(documentB, "test-route"))?.doc).toMatchObject({ values: {} });
  const second = workspace(store);
  expect((await second.read(documentA, "test-route"))?.doc).toMatchObject({ values: { a: "A" } });

  expect(
    await second.apply(documentA, "test-route", "human", [
      {
        path: ["bindings", "world"],
        value: { id: "session:pe.app-25", label: "pe.app-25", at: documentA.documentAddress },
      },
    ]),
  ).toMatchObject({ ok: true });
  const restarted = workspace(store);
  const reloaded = (await restarted.read(documentA, "test-route"))?.doc as TestDocument;
  expect(current(reloaded.bindings.world, documentA.documentAddress)?.id).toBe("session:pe.app-25");

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

  const command = module.command(documentA, "test-route", "agent", "increment", {});
  await started.promise;
  const apply = module.apply(documentA, "test-route", "agent", [
    { path: ["values", "name"], value: "kept" },
  ]);
  release.resolve();
  expect(await command).toMatchObject({ ok: true });
  expect(await apply).toMatchObject({ ok: true });
  expect((await module.read(documentA, "test-route"))?.doc).toMatchObject({
    count: 1,
    values: { name: "kept" },
  });
});

test("apply refuses a revision that moved", async () => {
  const { store } = memoryStore();
  const module = workspace(store);
  const revision = (await module.read(documentA, "test-route"))!.revision;

  expect(
    await module.apply(documentA, "test-route", "human", [{ path: ["count"], value: 1 }], revision),
  ).toMatchObject({ ok: true });
  expect(
    await module.apply(documentA, "test-route", "human", [{ path: ["count"], value: 2 }], revision),
  ).toMatchObject({ ok: false, error: "the document moved to r1" });
  expect((await module.read(documentA, "test-route"))?.doc).toMatchObject({ count: 1 });
});

test("an abandoned external mutation becomes outcomeUnknown and recovery clears it", async () => {
  const { store } = memoryStore();
  const started = deferred<void>();
  const never = new Promise<never>(() => undefined);
  const route = registration({
    external: async () => {
      started.resolve();
      return never;
    },
  });
  const crashed = workspace(store, { registration: route });
  void crashed.command(documentA, "test-route", "human", "external", {});
  await started.promise;

  const restarted = workspace(store, { registration: route });
  expect(await restarted.read(documentA, "test-route")).toMatchObject({
    status: "outcomeUnknown",
    outcomeUnknown: { command: "external" },
  });
  expect(await restarted.command(documentA, "test-route", "human", "external", {})).toMatchObject({
    ok: false,
    error: expect.stringContaining("blocked"),
  });
  expect(await restarted.command(documentA, "test-route", "human", "recover", {})).toMatchObject({
    ok: true,
  });
  expect(await restarted.read(documentA, "test-route")).toMatchObject({ status: "ready" });
});

test("mask, schema, and human command gate are enforced", async () => {
  const { store } = memoryStore();
  const module = workspace(store);
  expect(
    await module.apply(documentA, "test-route", "agent", [{ path: ["count"], value: 1 }]),
  ).toMatchObject({ ok: false, hint: expect.stringContaining("human-only") });
  expect(
    await module.apply(documentA, "test-route", "agent", [{ path: ["values", "bad"], value: 42 }]),
  ).toMatchObject({ ok: false, error: "the patched document is invalid" });
  expect(
    await module.apply(documentA, "test-route", "human", [{ path: ["count"], value: 1 }]),
  ).toMatchObject({ ok: true });
  expect(await module.command(documentA, "test-route", "agent", "external", {})).toMatchObject({
    ok: false,
    error: expect.stringContaining("human-only"),
  });
  expect(
    await module.command(documentA, "test-route", "human", "bind", { target: "session:x" }),
  ).toMatchObject({ ok: false, error: "unknown command 'bind'" });
});

test("publishes all action outcomes", async () => {
  const { store } = memoryStore();
  const published: RouteWorkspaceEvent[] = [];
  const module = workspace(store);
  module.subscribe((event) => published.push(event));

  await module.apply(documentA, "test-route", "agent", [
    { path: ["values", "agent"], value: "proposal" },
  ]);
  await module.apply(documentB, "test-route", "human", [{ path: ["count"], value: 1 }]);
  await module.apply(documentA, "test-route", "human", [{ path: ["count"], value: 2 }]);
  expect(await module.command(documentA, "test-route", "human", "fail", {})).toMatchObject({
    ok: false,
  });

  expect(published).toHaveLength(4);
  expect(published[1]?.scope).toEqual(documentB);
});

test("a request without doc is refused", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-route-state-"));
  const runtime = await createPeaRuntime({ workspaceRoot });
  try {
    const app = await buildAgentControllerApp({
      runtime,
      label: "pea",
      routeRegistrations: [registration()],
    });
    const response = await app.fetch(new Request("http://local/pe/route-state/test-route"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ hint: "doc required" });
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 30_000);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
