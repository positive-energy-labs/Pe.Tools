import { observeResources, resourceResponse } from "../src/resource-stream.ts";
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

    commands: {
      increment: {
        effect: "command",
        description: "Increment the counter.",

        input: z.object({}),
      },
      fail: {
        effect: "command",
        description: "Fail for chronology proof.",

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

const documentA: WorkKey = {
  binding: "address" as const,
  route: "test-route",
  target: address("C:\\Models\\A.rvt"),
};
const documentB: WorkKey = {
  binding: "address" as const,
  route: "test-route",
  target: address("C:\\Models\\B.rvt"),
};

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

test("both writers use the same schema and semantic commands",async()=>{
  const {store}=memoryStore();const w=bind(workspace(store));
  expect(await w.apply("agent",[{path:["count"],value:1}],0)).toMatchObject({ok:true});
  expect(await w.apply("human",[{path:["values","bad"],value:42}],1)).toMatchObject({ok:false});
  expect(await w.cmd("agent","increment",{},1)).toMatchObject({ok:true,revision:2});
  expect(await w.cmd("human","bind",{},2)).toMatchObject({ok:false,error:"unknown command 'bind'"});
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

test("resource stream publishes absent Work, an applied revision, and ends on abort", async () => {
  const module = workspace(memoryStore().store);
  const scopes = { observe: () => () => {} };
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

/* ── Addressless Work retains its exact document lifetime ─────────────────────── */

const unsaved: WorkKey = {
  binding: "open" as const,
  route: "test-route",
  target: null,
  open: { session: "revit", openId: "doc-1" },
};
const savedAs: WorkKey = {
  binding: "address",
  route: unsaved.route,
  target: address("C:\\Models\\Saved.rvt"),
  from: unsaved.open,
};

test("an unsaved document's Work keys by its open lifetime and never by the empty target", async () => {
  const { store, state } = memoryStore();
  const module = workspace(store);
  expect(
    await bind(module, unsaved).apply("human", [{ path: ["values", "a"], value: "A" }], 0),
  ).toMatchObject({ ok: true });
  expect(state.has("test-route/open:revit/doc-1\0test-route")).toBe(true);
  expect(state.has("test-route/target:\0test-route")).toBe(false);
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
  await bind(module, {
    binding: "address" as const,
    route: "test-route",
    target: savedAs.target,
  }).apply("human", [{ path: ["values", "a"], value: "addressed" }], 0);
  expect((await bind(module, savedAs).read())?.doc).toMatchObject({ values: { a: "addressed" } });
});
