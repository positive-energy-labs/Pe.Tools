import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { defineRouteState, routeBindingSchema } from "@pe/agent-contracts";
import type { RouteStateCommandHandlers, RouteStateSpec } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { buildAgentControllerApp } from "../src/agent-controller-web.ts";
import { createPeaRuntime } from "../src/pea-runtime.ts";
import type {
  RouteWorkspaceEvent,
  RouteWorkspaceRegistration,
  RouteWorkspaceThreadEvent,
} from "../src/route-workspace.ts";
import type { RuntimeThreadStateStore } from "../src/storage/thread-state.ts";

const documentSchema = z
  .object({
    binding: routeBindingSchema,
    values: z.record(z.string(), z.string()).default({}),
    count: z.number().int().default(0),
  })
  .prefault({});
type TestDocument = z.infer<typeof documentSchema>;

function registration(
  overrides: Partial<RouteStateCommandHandlers<TestDocument>> = {},
): RouteWorkspaceRegistration {
  const spec = defineRouteState({
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
  });
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
  const key = (threadId: string, type: string) => `${threadId}\0${type}`;
  const store: RuntimeThreadStateStore = {
    getState: async ({ threadId, type }) => structuredClone(state.get(key(threadId, type))),
    setState: async ({ threadId, type, value }) => {
      state.set(key(threadId, type), structuredClone(value));
    },
  };
  return { store, state };
}

function workspace(
  store: RuntimeThreadStateStore,
  options: {
    registration?: RouteWorkspaceRegistration;
    authorized?: Set<string>;
    appendThreadEvent?: (event: RouteWorkspaceThreadEvent) => void | Promise<void>;
  } = {},
) {
  return new RouteWorkspace({
    registrations: [options.registration ?? registration()],
    store,
    authorizeThread: (threadId) => options.authorized?.has(threadId) ?? true,
    appendThreadEvent: options.appendThreadEvent,
  });
}

const threadA = { threadId: "thread-a" } as const;
const threadB = { threadId: "thread-b" } as const;

test("thread documents are isolated, authorized, and survive module recreation", async () => {
  const { store } = memoryStore();
  const first = workspace(store, { authorized: new Set(["thread-a", "thread-b"]) });
  expect(
    await first.apply(threadA, "test-route", "agent", [{ path: ["values", "a"], value: "A" }]),
  ).toMatchObject({ ok: true });

  expect((await first.read(threadB, "test-route"))?.doc).toMatchObject({ values: {} });
  const second = workspace(store, { authorized: new Set(["thread-a"]) });
  expect((await second.read(threadA, "test-route"))?.doc).toMatchObject({ values: { a: "A" } });
  await expect(second.read(threadB, "test-route")).rejects.toThrow("not authorized");

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

  const command = module.command(threadA, "test-route", "agent", "increment", {});
  await started.promise;
  const apply = module.apply(threadA, "test-route", "agent", [
    { path: ["values", "name"], value: "kept" },
  ]);
  release.resolve();
  expect(await command).toMatchObject({ ok: true });
  expect(await apply).toMatchObject({ ok: true });
  expect((await module.read(threadA, "test-route"))?.doc).toMatchObject({
    count: 1,
    values: { name: "kept" },
  });
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
  void crashed.command(threadA, "test-route", "human", "external", {});
  await started.promise;

  const restarted = workspace(store, { registration: route });
  expect(await restarted.read(threadA, "test-route")).toMatchObject({
    status: "outcomeUnknown",
    outcomeUnknown: { command: "external" },
  });
  expect(await restarted.command(threadA, "test-route", "human", "external", {})).toMatchObject({
    ok: false,
    error: expect.stringContaining("blocked"),
  });
  expect(await restarted.command(threadA, "test-route", "human", "recover", {})).toMatchObject({
    ok: true,
  });
  expect(await restarted.read(threadA, "test-route")).toMatchObject({ status: "ready" });
});

test("mask, schema, and human command gate are enforced", async () => {
  const { store } = memoryStore();
  const module = workspace(store);
  expect(
    await module.apply(threadA, "test-route", "agent", [{ path: ["count"], value: 1 }]),
  ).toMatchObject({ ok: false, hint: expect.stringContaining("human-only") });
  expect(
    await module.apply(threadA, "test-route", "agent", [{ path: ["values", "bad"], value: 42 }]),
  ).toMatchObject({ ok: false, error: "the patched document is invalid" });
  expect(
    await module.apply(threadA, "test-route", "human", [{ path: ["count"], value: 1 }]),
  ).toMatchObject({ ok: true });
  expect(await module.command(threadA, "test-route", "agent", "external", {})).toMatchObject({
    ok: false,
    error: expect.stringContaining("human-only"),
  });
  expect(
    await module.command(threadA, "test-route", "human", "bind", { target: "session:x" }),
  ).toMatchObject({ ok: false, error: "unknown command 'bind'" });
});

test("publishes all action outcomes but appends only human chronology", async () => {
  const { store } = memoryStore();
  const appended: RouteWorkspaceThreadEvent[] = [];
  const published: RouteWorkspaceEvent[] = [];
  const module = workspace(store, {
    appendThreadEvent: (event) => {
      appended.push(event);
    },
  });
  module.subscribe((event) => published.push(event));

  await module.apply(threadA, "test-route", "agent", [
    { path: ["values", "agent"], value: "proposal" },
  ]);
  await module.apply(threadB, "test-route", "human", [{ path: ["count"], value: 1 }]);
  await module.apply(threadA, "test-route", "human", [{ path: ["count"], value: 2 }]);
  expect(await module.command(threadA, "test-route", "human", "fail", {})).toMatchObject({
    ok: false,
  });

  expect(published).toHaveLength(4);
  expect(appended).toEqual([
    expect.objectContaining({ action: "apply", threadId: "thread-b", ok: true, patchCount: 1 }),
    expect.objectContaining({ action: "apply", threadId: "thread-a", ok: true, patchCount: 1 }),
    expect.objectContaining({
      action: "command",
      threadId: "thread-a",
      command: "fail",
      ok: false,
      error: "deliberate failure",
    }),
  ]);
});

test("a request without threadId is refused", async () => {
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
    expect(await response.json()).toMatchObject({ hint: "threadId required" });
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
