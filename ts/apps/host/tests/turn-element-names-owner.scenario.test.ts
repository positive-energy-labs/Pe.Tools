import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  HARNESS_EVENT_MAX_BYTES,
  address,
  type DocumentRequest,
  type HarnessEvent,
  type HarnessThreadBody,
} from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { createHarnessThreads } from "../src/harness/threads.ts";
import { createProviders } from "../src/harness/providers.ts";
import { HostLog } from "../src/host-log.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { human } from "./callers.ts";
import type { ObserveDocument } from "../src/thread-work-context.ts";
import type { TurnElementNamesNativeRead } from "../src/turn-element-names.ts";
import { turnElementNamesRequestSchema } from "../../../packages/agent-contracts/src/turn-element-names.ts";

let root = "";
const owners: ReturnType<typeof createHarnessThreads>[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-turn-names-owner-"));
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
});
afterAll(async () => {
  await Promise.all(owners.map((owner) => owner.close()));
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  await rm(root, { recursive: true, force: true });
});
function host(home: string, observeDocument?: ObserveDocument) {
  const log = new HostLog(join(home, "log"));
  const threads = createHarnessThreads({
    root: join(home, "threads"),
    log,
    observeDocument,
    worldRoot: tmpdir(),
    mcpServer: () => ({ name: "pea", command: "unused", args: [], env: [] }),
    providers: createProviders({ shellPath: async () => "", probeOnStart: false }),
  });
  owners.push(threads);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await withInvocationContext({ caller: human }, () =>
      threads.fetch(
        new Request(`http://host${path}`, {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    );
    return { status: response.status, body: await response.json() };
  };
  const read = async (id: string) =>
    (await call("GET", `/pe/threads/${id}`)).body as HarnessThreadBody;
  const set = async (id: string, targets: DocumentRequest[]) => {
    const revision = threads.heads.read(id).revision;
    expect(
      (
        await call("PUT", `/pe/scope/${id}`, {
          expectedRevision: revision,
          targets: targets.map((request) => ({ request })),
        })
      ).status,
    ).toBe(200);
  };
  const create = async () => {
    const result = await call("POST", "/pe/threads", { providerId: "claude" });
    expect(result.status).toBe(200);
    return result.body.id as string;
  };
  const prompt = async (id: string, turnId = randomUUID(), text = "Read names") => {
    expect((await call("POST", `/pe/threads/${id}/prompt`, { id: turnId, text })).status).toBe(200);
    await expect
      .poll(async () =>
        (await read(id)).events.some(
          (event) => event.kind === "turn_end" && event.turnId === turnId,
        ),
      )
      .toBe(true);
    return turnId;
  };
  return {
    threads,
    log,
    call,
    read,
    set,
    create,
    prompt,
    file: (id: string) => join(home, "threads", id, "events.jsonl"),
  };
}
const a = { session: "original-process", openId: "original-document" };
const b = { session: "original-process", openId: "second-document" };
const named: DocumentRequest = {
  kind: "named",
  session: b.session,
  address: address("C:/Models/B.rvt"),
};
const request = (thread: string, turnId: string, ids: number[]) => ({
  kind: "turn-element-names" as const,
  thread,
  turnId,
  ids,
});
const nativeValue = (
  ids: number[],
  entries: { elementId: number; elementUniqueId: string; name: string }[],
) => ({
  queryKind: "ElementReferences",
  requestedElementCount: ids.length,
  resolvedElementCount: entries.length,
  entries,
  issues: ids
    .filter((id) => !entries.some((entry) => entry.elementId === id))
    .map(() => ({ code: "ElementContextElementIdNotFound", severity: "Warning" })),
});

test("HTTP prompt pins exact refs; concurrent reads persist once and restart freezes every earlier outcome", async () => {
  const home = join(root, randomUUID());
  let observed = { ref: b, address: named.address, name: "B" };
  let h = host(home, () => observed);
  const id = await h.create();
  await h.set(id, [{ kind: "open", ref: a }, named]);
  const turnId = await h.prompt(id);
  const head = JSON.stringify(h.threads.heads.read(id));
  observed = { ...observed, ref: { ...b, openId: "replacement-document" } };
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nativeRead: TurnElementNamesNativeRead = async (_op, input, ref) => {
    calls.push(ref.openId);
    await gate;
    const entries =
      ref.openId === a.openId
        ? [101, 202].map((elementId) => ({
            elementId,
            elementUniqueId: `unique-${elementId}`,
            name: `Name ${elementId}`,
          }))
        : [{ elementId: 101, elementUniqueId: "other-101", name: "Other 101" }];
    return {
      value: nativeValue(input.query!.elementIds!, entries),
      target: { documentRef: { ...ref } },
    };
  };
  const reads = [
    h.threads.readTurnElementNames(request(id, turnId, [101, 202, 303]), nativeRead),
    h.threads.readTurnElementNames(request(id, turnId, [202, 303, 101]), nativeRead),
  ];
  await expect.poll(() => calls.length).toBe(2);
  release();
  const [first, duplicate] = await Promise.all(reads);
  expect(duplicate).toEqual(first);
  expect(first.snapshot.targets).toEqual([a, b]);
  expect(first.entries.map((entry) => entry.state)).toEqual([
    "ambiguous",
    "resolved",
    "unresolved",
  ]);
  expect(first.entries[1]).toMatchObject({ uniqueId: "unique-202", name: "Name 202" });
  const app = createPeRoutes({
    registrations: [],
    store: fileRouteDocumentStore(join(home, "work")),
    heads: h.threads.heads,
    turnElementNames: (input) => h.threads.readTurnElementNames(input, nativeRead),
  });
  const postNames = (input: unknown) =>
    app.fetch(
      new Request("http://host/pe/turn-element-names", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  const beforePost = calls.length;
  expect(await (await postNames(request(id, turnId, [202]))).json()).toEqual(first);
  expect(calls.length).toBe(beforePost);
  expect((await postNames({ ...request(id, turnId, [202]), targets: [a] })).status).toBe(400);
  expect((await postNames(request(id, randomUUID(), [202]))).status).toBe(409);
  expect(JSON.stringify(h.threads.heads.read(id))).toBe(head);
  const events = (await h.read(id)).events;
  expect(events.filter((event) => event.kind === "turn_element_names")).toHaveLength(1);
  expect(
    h.log
      .read(0)
      .entries.some(
        ({ event }) => event.kind === "thread" && event.event.kind === "turn_element_names",
      ),
  ).toBe(true);
  await h.threads.close();
  h = host(home, () => observed);
  let rereads = 0;
  const replacement: TurnElementNamesNativeRead = async (_op, input, ref) => {
    rereads++;
    if (ref.openId === a.openId) throw Error("original document closed");
    return {
      value: nativeValue(input.query!.elementIds!, [
        { elementId: 404, elementUniqueId: "replacement", name: "Wrong" },
      ]),
      target: { documentRef: observed.ref },
    };
  };
  expect(
    await h.threads.readTurnElementNames(request(id, turnId, [101, 202, 303]), replacement),
  ).toEqual(first);
  expect(rereads).toBe(0);
  const extended = await h.threads.readTurnElementNames(request(id, turnId, [404]), replacement);
  expect(extended.entries.slice(0, 3)).toEqual(first.entries);
  expect(extended.entries[3]).toEqual({
    state: "unresolved",
    elementId: 404,
    reason: "read-unavailable",
  });
  expect(rereads).toBe(2);
  await expect(
    h.threads.readTurnElementNames(request(id, randomUUID(), [101]), replacement),
  ).rejects.toThrow("delivered prompt");
  await expect(
    h.threads.readTurnElementNames(request(randomUUID(), turnId, [101]), replacement),
  ).rejects.toThrow("No available");
  expect(
    turnElementNamesRequestSchema.safeParse({ ...request(id, turnId, [101]), previous: first })
      .success,
  ).toBe(false);
});

test("unavailable named metadata keeps delivery successful and the whole pin set incomplete", async () => {
  const h = host(join(root, randomUUID()), () => null);
  const id = await h.create();
  await h.set(id, [{ kind: "open", ref: a }, named]);
  const turnId = await h.prompt(id);
  const result = await h.threads.readTurnElementNames(request(id, turnId, [101]), async () => {
    throw Error("must not call native");
  });
  expect(result.snapshot).toMatchObject({ targets: [a], complete: false });
  expect(result.entries).toEqual([
    { state: "unresolved", elementId: 101, reason: "targets-unpinned" },
  ]);
});

test.each(["refs", "string"] as const)(
  "pin %s bounds keep prompt delivery successful and names unresolved",
  async (bound) => {
    const h = host(join(root, randomUUID()));
    const id = await h.create();
    const refs =
      bound === "refs"
        ? Array.from({ length: 33 }, (_, index) => ({ ...a, openId: `document-${index}` }))
        : [{ ...a, openId: "x".repeat(257) }];
    await h.set(
      id,
      refs.map((ref) => ({ kind: "open", ref })),
    );
    const turnId = await h.prompt(id);
    const result = await h.threads.readTurnElementNames(request(id, turnId, [101]), async () => {
      throw Error("must not run");
    });
    expect(result.snapshot.complete).toBe(false);
    expect(result.entries).toEqual([
      { state: "unresolved", elementId: 101, reason: "targets-unpinned" },
    ]);
  },
);

test("a queued prompt pins its documents at delivery after the head changes", async () => {
  const h = host(join(root, randomUUID()));
  const id = await h.create();
  await h.set(id, [{ kind: "open", ref: a }]);
  const running = randomUUID();
  expect(
    (await h.call("POST", `/pe/threads/${id}/prompt`, { id: running, text: "hang" })).status,
  ).toBe(200);
  const queued = randomUUID();
  expect(
    (
      await h.call("POST", `/pe/threads/${id}/prompt`, {
        id: queued,
        text: "Read names",
        delivery: "queue",
      })
    ).body.state,
  ).toBe("queued");
  await h.set(id, [{ kind: "open", ref: b }]);
  const cancelled = await h.call("POST", `/pe/threads/${id}/cancel`, {});
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
  await expect
    .poll(async () =>
      (await h.read(id)).events.some(
        (event) => event.kind === "turn_end" && event.turnId === queued,
      ),
    )
    .toBe(true);
  const events = (await h.read(id)).events;
  expect(events).toContainEqual(
    expect.objectContaining({ kind: "turn_end", turnId: running, stopReason: "cancelled" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ kind: "turn_end", turnId: queued, stopReason: "end_turn" }),
  );
  const result = await h.threads.readTurnElementNames(
    request(id, queued, [101]),
    async (_op, input, ref) => ({
      value: nativeValue(input.query!.elementIds!, []),
      target: { documentRef: { ...ref } },
    }),
  );
  expect(result.snapshot.targets).toEqual([b]);
});

test.each(["open", "named"] as const)(
  "legacy %s prompt never rebinds through today's metadata",
  async (kind) => {
    const home = join(root, randomUUID());
    let h = host(home);
    const id = await h.create();
    await h.set(id, [kind === "open" ? { kind: "open", ref: a } : named]);
    const turnId = await h.prompt(id);
    await h.threads.close();
    const old = (await h.read(id)).events
      .filter((event) => event.kind !== "turn_element_targets")
      .map((event, index) => {
        if (event.kind === "prompt") delete event.elementNames;
        return { ...event, seq: index + 1 };
      });
    await writeFile(h.file(id), old.map((event) => JSON.stringify(event)).join("\n") + "\n");
    h = host(home, () => ({
      ref: { ...a, openId: "new-lifetime" },
      address: named.address,
      name: "Today",
    }));
    let calls = 0;
    const result = await h.threads.readTurnElementNames(
      request(id, turnId, [101]),
      async (_op, input, ref) => {
        calls++;
        expect(ref).toEqual(a);
        return {
          value: nativeValue(input.query!.elementIds!, []),
          target: { documentRef: { ...a, openId: "new-lifetime" } },
        };
      },
    );
    expect(result.entries[0]).toMatchObject({
      state: "unresolved",
      reason: kind === "open" ? "read-unavailable" : "targets-unpinned",
    });
    expect(calls).toBe(kind === "open" ? 1 : 0);
  },
);

test("escaped maximum refs/names are byte-chunked and incomplete or altered replay refuses native rereads", async () => {
  const home = join(root, randomUUID());
  let h = host(home);
  const id = await h.create();
  const refs = Array.from({ length: 32 }, (_, index) => ({
    session: "\u0000".repeat(256),
    openId: "\u0000".repeat(254) + String(index).padStart(2, "0"),
  }));
  await h.set(
    id,
    refs.map((ref) => ({ kind: "open", ref })),
  );
  const turnId = await h.prompt(id);
  const ids = Array.from({ length: 256 }, (_, index) => index + 1);
  const result = await h.threads.readTurnElementNames(
    request(id, turnId, ids),
    async (_op, input, ref) => ({
      value: nativeValue(
        input.query!.elementIds!,
        ref.openId === refs[0]!.openId
          ? ids.map((elementId) => ({
              elementId,
              elementUniqueId: "\u0000".repeat(256),
              name: "\u0000".repeat(512),
            }))
          : [],
      ),
      target: { documentRef: { ...ref } },
    }),
  );
  expect(result.entries.every((entry) => entry.state === "resolved")).toBe(true);
  const all = (await h.read(id)).events;
  const chunks = all.filter(
    (event) => event.kind === "turn_element_targets" || event.kind === "turn_element_names",
  );
  expect(chunks.filter((event) => event.kind === "turn_element_targets").length).toBeGreaterThan(1);
  expect(chunks.filter((event) => event.kind === "turn_element_names").length).toBeGreaterThan(1);
  for (const event of chunks)
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(HARNESS_EVENT_MAX_BYTES);
  await h.threads.close();
  const original = await readFile(h.file(id), "utf8");
  for (const fault of ["target-part", "name-part", "digest"] as const) {
    let events = original
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as HarnessEvent);
    if (fault === "digest") {
      const part = events.find((event) => event.kind === "turn_element_names");
      if (part?.kind === "turn_element_names")
        part.entries[0] = { state: "unresolved", elementId: 1, reason: "missing" };
    } else {
      const kind = fault === "target-part" ? "turn_element_targets" : "turn_element_names";
      const index = events.findLastIndex((event) => event.kind === kind);
      events = events.filter((_, at) => at !== index);
    }
    await writeFile(h.file(id), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    h = host(home);
    let nativeCalls = 0;
    await expect(
      h.threads.readTurnElementNames(request(id, turnId, [1]), async () => {
        nativeCalls++;
        throw Error("must not run");
      }),
    ).rejects.toThrow(/chunks|digest/);
    expect(nativeCalls).toBe(0);
    await h.threads.close();
  }
});

test("metadata refresh enriches remembered context once and leaves native admission unchanged", async () => {
  let observation: ReturnType<ObserveDocument> = null;
  const h = host(join(root, randomUUID()), () => observation);
  const id = await h.create();
  await h.set(id, [{ kind: "open", ref: a }]);
  const before = h.threads.heads.read(id);
  observation = { ref: a, address: address("C:/Models/A.rvt"), name: "Remembered A" };
  h.threads.refreshWorkContexts();
  const enriched = h.threads.workContexts().find((item) => item.threadId === id)!.context!;
  expect(enriched.documents).toHaveLength(1);
  expect(enriched.documents[0]).toMatchObject({
    name: "Remembered A",
    address: observation.address,
    refs: [a],
  });
  h.threads.refreshWorkContexts();
  expect(h.threads.workContexts().find((item) => item.threadId === id)!.context).toEqual(enriched);
  expect(h.threads.heads.read(id)).toEqual(before);
  await h.set(id, []);
  observation = null;
  h.threads.refreshWorkContexts();
  expect(h.threads.workContexts().find((item) => item.threadId === id)!.context).toEqual(enriched);
});
