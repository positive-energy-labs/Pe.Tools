import { observeResources, resourceResponse } from "../src/resource-stream.ts";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { address, routeBindingsSchema } from "@pe/agent-contracts";
import type { WorkAuthor, RouteStatePatch, RouteStateSpec, WorkKey } from "@pe/agent-contracts";
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

function registration(): RouteWorkspaceRegistration {
  const spec = {
    route: "test-route",
    title: "Test Route",
    description: "A test collaborative route.",
    schema: documentSchema,
  } satisfies RouteStateSpec<typeof documentSchema>;
  return { spec };
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
    apply: (actor: WorkAuthor, patches: RouteStatePatch[], revision: number) =>
      module.apply(scope, "test-route", actor, patches, revision),
  };
}

test("document-scoped route documents are isolated and survive module recreation", async () => {
  const { store } = memoryStore();
  const first = workspace(store);
  const firstA = bind(first);
  expect(await firstA.apply("pea", [{ path: ["values", "a"], value: "A" }], 0)).toMatchObject({
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

test("concurrent authored edits serialize without losing either observed update", async () => {
  const memory = memoryStore();
  const started = deferred<void>(),
    release = deferred<void>();
  const store: RouteDocumentStore = {
    ...memory.store,
    setState: async (input) => {
      if ((input.value as { revision: number }).revision === 1) {
        started.resolve();
        await release.promise;
      }
      await memory.store.setState(input);
    },
  };
  const w = bind(workspace(store));
  const first = w.apply("pea", [{ path: ["count"], value: 1 }], 0);
  await started.promise;
  const second = w.apply("human", [{ path: ["values", "name"], value: "kept" }], 1);
  release.resolve();
  expect(await first).toMatchObject({ ok: true, revision: 1 });
  expect(await second).toMatchObject({ ok: true, revision: 2 });
  expect((await w.read())?.doc).toMatchObject({ count: 1, values: { name: "kept" } });
});

test("an authored-admission throw cannot persist the candidate Work", async () => {
  const route = registration();
  route.admit = async () => {
    throw Error("catalogue unavailable");
  };
  const w = bind(workspace(memoryStore().store, { registration: route }));
  await expect(w.apply("human", [{ path: ["count"], value: 1 }], 0)).rejects.toThrow(
    "catalogue unavailable",
  );
  expect(await w.read()).toBeNull();
});

test("human and Pea edits use the same schema and revision arbitration", async () => {
  const w = bind(workspace(memoryStore().store));
  expect(await w.apply("pea", [{ path: ["count"], value: 1 }], 0)).toMatchObject({
    ok: true,
    revision: 1,
  });
  expect(await w.apply("human", [{ path: ["values", "bad"], value: 42 }], 1)).toMatchObject({
    ok: false,
  });
  expect(await w.apply("human", [{ path: ["count"], value: 2 }], 1)).toMatchObject({
    ok: true,
    revision: 2,
  });
  expect((await w.read())?.doc).toMatchObject({ count: 2, values: {} });
});

test("stale Work edits never reach semantic admission; success returns its landed revision", async () => {
  const route = registration();
  const admit = vi.fn(async () => null);
  route.admit = admit;
  const w = bind(workspace(memoryStore().store, { registration: route }));
  expect(await w.apply("human", [{ path: ["count"], value: 1 }], 0)).toMatchObject({
    ok: true,
    revision: 1,
  });
  admit.mockClear();
  expect(await w.apply("pea", [{ path: ["count"], value: 2 }], 0)).toMatchObject({
    ok: false,
    code: "stale_revision",
  });
  expect(admit).not.toHaveBeenCalled();
  expect(await w.apply("pea", [{ path: ["count"], value: 2 }], 1)).toMatchObject({
    ok: true,
    revision: 2,
  });
  expect(admit).toHaveBeenCalledOnce();
});

// Command recovery and durable results belong to ActionJournal, exercised in host command-dependencies.test.ts.

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

function acksStream(module: RouteWorkspace, signal?: AbortSignal) {
  const url = `http://host/pe/resources?${new URLSearchParams({ keys: JSON.stringify([{ kind: "work-acks", work: documentA }]) })}`;
  const reader = resourceResponse(
    new Request(url, { signal }),
    observeResources(module, { observe: () => () => {} }),
  ).body!.getReader();
  return reader;
}

test("accepted writes reach a stream subscriber with the host's stamps; a Pea write is a distinct author", async () => {
  const module = workspace(memoryStore().store);
  const abort = new AbortController();
  const reader = acksStream(module, abort.signal);
  const write = bind(module);
  await write.apply("human", [{ path: ["values", "a"], value: "1" }], 0);
  await write.apply("pea", [{ path: ["values", "a"], value: "2" }], 1);
  const first = await readSse(reader);
  const second = await readSse(reader);
  expect(first).toMatchObject({
    kind: "event",
    value: {
      by: "human",
      base: 0,
      revision: 1,
      // The host's accepted delta, not the request: it reconciles to the parent it created.
      patches: [{ path: ["values"], value: { a: "1" } }],
      inverse: [{ path: ["values"] }],
    },
  });
  expect(second).toMatchObject({
    kind: "event",
    value: { by: "pea", press: null, base: 1, revision: 2 },
  });
  abort.abort();
});

test("a resubscription replays the retained window; a late reader starts at the window and sees the jump", async () => {
  const module = workspace(memoryStore().store);
  const write = bind(module);
  for (let revision = 0; revision < 3; revision++)
    await write.apply("pea", [{ path: ["count"], value: revision + 1 }], revision);
  const replay = acksStream(module);
  const revisions = [];
  for (let i = 0; i < 3; i++) revisions.push((await readSse(replay)).value as { revision: number });
  expect(revisions.map((value) => value.revision)).toEqual([1, 2, 3]);
  await replay.cancel();

  // 130 writes: the module keeps 100 and the stream tail 128, so a late reader sees the last 100.
  for (let revision = 3; revision < 130; revision++)
    await write.apply("pea", [{ path: ["count"], value: revision + 1 }], revision);
  const late = acksStream(module);
  const first = (await readSse(late)).value as { revision: number; base: number };
  expect(first).toMatchObject({ base: 30, revision: 31 });
  await late.cancel();
});

test("a tail that overflows says gap with the count it dropped, then delivers what it kept", async () => {
  const module = workspace(memoryStore().store);
  const write = bind(module);
  for (let revision = 0; revision < 5; revision++)
    await write.apply("pea", [{ path: ["count"], value: revision + 1 }], revision);
  const url = `http://host/pe/resources?${new URLSearchParams({ keys: JSON.stringify([{ kind: "work-acks", work: documentA }]) })}`;
  const reader = resourceResponse(
    new Request(url),
    observeResources(module, { observe: () => () => {} }),
    { frameBytes: 1 << 20, worldEvents: 64, workAckEvents: 2, stallMs: 10_000, logFrames: 8 },
  ).body!.getReader();
  expect(await readSse(reader)).toMatchObject({ kind: "gap", dropped: 3 });
  const kept = [(await readSse(reader)).value, (await readSse(reader)).value] as {
    revision: number;
  }[];
  expect(kept.map((value) => value.revision)).toEqual([4, 5]);
  await reader.cancel();
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
