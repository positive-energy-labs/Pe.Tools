import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  bindWork,
  workKey,
  type RouteStatePatch,
  type WorkAuthor,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { z } from "zod";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { createWorkJournal, type JournalWriter } from "./journal";
import { createRouteTimeline, TIMELINE_LIMIT } from "./timeline";

afterEach(() => vi.useRealTimers());

function fixture() {
  const key = bindWork("journal-proof", null, "one");
  const initial = {
    settings: { width: 10, height: 4 },
    cells: {
      one: {
        edit: { value: "before", by: "pea" as const, at: "2026-10-28T00:00:00.000Z", base: 0 },
      },
    },
  };
  const cell = z.object({
    value: z.string(),
    by: z.enum(["human", "pea"]).optional(),
    at: z.string().optional(),
    base: z.number().optional(),
  });
  const spec = {
    route: key.route,
    title: "Journal proof",
    description: "Deterministic journal proof",
    schema: z.object({
      settings: z.object({ width: z.number(), height: z.number() }),
      cells: z.object({ one: z.object({ edit: cell }) }),
    }),
  };
  const stored = new Map<string, unknown>([
    [workKey(key), { version: 1, revision: 0, doc: initial }],
  ]);
  const workspace = new RouteWorkspace({
    registrations: [{ spec }],
    store: {
      getState: async ({ targetKey }) => structuredClone(stored.get(targetKey) ?? null),
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  const journal = createWorkJournal(key);
  const timeline = createRouteTimeline();
  timeline.subscribe(journal.record);
  workspace.subscribe((event) => {
    if (event.ok) journal.accept(event);
  });
  const requests: WorkWrite[] = [];
  const writer: JournalWriter = (write) => {
    requests.push(structuredClone(write));
    return workspace.write(key, key.route, "human", write);
  };
  const apply = async (
    patches: RouteStatePatch[],
    press: string | null,
    by: WorkAuthor = "human",
  ) => {
    const current = await workspace.view(key, key.route);
    const result = await workspace.write(key, key.route, by, {
      patches,
      press,
      kind: "apply",
      expectedRevision: current!.revision,
    });
    if (!result.ok) throw Error("Expected admitted fixture write");
    return result.write;
  };
  return { key, initial, stored, workspace, journal, timeline, writer, requests, apply };
}

test("two accepted writes in one press are one step; undo and redo chain real host-issued restores", async () => {
  const f = fixture();
  const first = await f.apply([{ path: ["settings", "width"], value: 20 }], "cap-1");
  const second = await f.apply(
    [{ path: ["cells", "one", "edit"], value: { value: "after" } }],
    "cap-1",
  );
  const authored = (await f.workspace.read(f.key, f.key.route))!.doc;
  expect(f.journal.read().undo).toHaveLength(1);
  expect(f.journal.read().undo[0]!.transitions).toHaveLength(2);
  expect(await f.journal.undo(f.writer)).toEqual({ ok: true, press: "cap-1", revision: 4 });
  expect(f.requests).toEqual([
    { kind: "restore", patches: second.inverse, expectedRevision: 2, press: null },
    { kind: "restore", patches: first.inverse, expectedRevision: 3, press: null },
  ]);
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toEqual(f.initial);
  expect(f.journal.read().undo).toEqual([]);
  expect(f.journal.read().redo).toHaveLength(1);
  expect(await f.journal.redo(f.writer)).toEqual({ ok: true, press: "cap-1", revision: 6 });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toEqual(authored);
  expect(f.requests.slice(2).every(({ kind, press }) => kind === "restore" && press === null)).toBe(
    true,
  );
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true, revision: 8 });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toEqual(f.initial);
});

test("two presses 10 ms apart stay two steps, including on the same path", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T21:00:00.000Z"));
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "cap-1");
  vi.advanceTimersByTime(10);
  await f.apply([{ path: ["settings", "width"], value: 30 }], "cap-2");
  expect(f.journal.read().undo.map(({ press }) => press)).toEqual(["cap-1", "cap-2"]);
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true, press: "cap-2" });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toMatchObject({
    settings: { width: 20 },
  });
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true, press: "cap-1" });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toEqual(f.initial);
});

test("Pea writes never become steps; disjoint paths remain undoable", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  await f.apply([{ path: ["settings", "height"], value: 99 }], "forged-human-press", "pea");
  expect(f.journal.read().undo.map(({ press }) => press)).toEqual(["human-1"]);
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true, revision: 3 });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toMatchObject({
    settings: { width: 10, height: 99 },
  });
});

test("an overlapping Pea write is a named barrier even after Pea puts the old value back", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  await f.apply([{ path: ["settings", "width"], value: 99 }], null, "pea");
  await f.apply([{ path: ["settings", "width"], value: 20 }], null, "pea");
  const result = await f.journal.undo(f.writer);
  expect(result).toMatchObject({
    ok: false,
    code: "barrier",
    barrier: { receiptId: `work:${workKey(f.key)}:r2` },
  });
  expect(!result.ok && result.message).toContain(`work:${workKey(f.key)}:r2`);
  expect(f.requests).toEqual([]);
});

test.each([{ path: ["settings"] }, { path: ["settings", "width", "child"] }, { path: [] }])(
  "timeline receipt footprint $path refuses overlapping undo without any Work revision",
  async ({ path }) => {
    const f = fixture();
    await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
    f.timeline.append({
      kind: "receipt",
      at: 1,
      verb: "rooms.apply",
      receiptId: "revit-receipt-1",
      paths: [path],
    });
    expect(f.journal.read().revision).toBe(1);
    expect(await f.journal.undo(f.writer)).toMatchObject({
      ok: false,
      code: "barrier",
      barrier: { receiptId: "revit-receipt-1" },
    });
    expect(f.requests).toEqual([]);
  },
);

test("only later overlapping receipts block a step, and timeline eviction never removes its barrier", async () => {
  const f = fixture();
  f.timeline.append({ kind: "receipt", at: 100, receiptId: "earlier", paths: [[]] });
  await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  f.timeline.append({ kind: "checkpoint", at: 2, paths: [[]] });
  f.timeline.append({ kind: "receipt", at: 3, paths: [["cells"]] });
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true });
  f.timeline.append({ kind: "receipt", at: 0, receiptId: "after-undo", paths: [["settings"]] });
  for (let at = 0; at <= TIMELINE_LIMIT; at++) f.timeline.append({ kind: "invocation", at });
  expect(f.timeline.read().some(({ receiptId }) => receiptId === "after-undo")).toBe(false);
  expect(await f.journal.redo(f.writer)).toMatchObject({
    ok: false,
    code: "barrier",
    barrier: { receiptId: "after-undo" },
  });
});

test("a barrier between acknowledgements of one press is retained", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  f.timeline.append({ kind: "receipt", at: 1, receiptId: "apply-between", paths: [["settings"]] });
  await f.apply([{ path: ["settings", "height"], value: 8 }], "human-1");
  expect(f.journal.read().undo).toHaveLength(1);
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: false, code: "barrier" });
});

test("failed restore leaves the step; a partially completed press resumes without repeating accepted restores", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  await f.apply([{ path: ["settings", "height"], value: 8 }], "human-1");
  let calls = 0;
  const flaky: JournalWriter = (write) =>
    ++calls === 2
      ? Promise.resolve({
          ok: false,
          kind: "refused",
          error: "not now",
          hint: "retry the same inverse",
        })
      : f.writer(write);
  expect(await f.journal.undo(flaky)).toMatchObject({
    ok: false,
    code: "write-refused",
    message: "not now",
  });
  expect(f.journal.read().undo[0]!.cursor).toBe(1);
  expect(await f.journal.redo(f.writer)).toMatchObject({ ok: false, code: "busy" });
  expect(await f.journal.undo(flaky)).toMatchObject({ ok: true, revision: 4 });
  expect(f.requests.map(({ expectedRevision }) => expectedRevision)).toEqual([2, 3]);
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toEqual(f.initial);
});

test("new human press clears redo, duplicate acks do not add steps, and Work identities stay separate", async () => {
  const f = fixture();
  const ack = await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  f.journal.accept(ack);
  f.journal.accept({ ...ack, key: bindWork(f.key.route, null, "other"), revision: 10 });
  expect(f.journal.read().undo).toHaveLength(1);
  expect(f.journal.read().revision).toBe(1);
  await f.journal.undo(f.writer);
  await f.apply([{ path: ["settings", "height"], value: 8 }], "human-2");
  expect(await f.journal.redo(f.writer)).toMatchObject({ ok: false, code: "empty" });
  expect(createWorkJournal(f.key).read().undo).toEqual([]); // No persistence or module-global route instance.
});

test("a missed accepted revision clears history rather than restoring across unknown writes", async () => {
  const f = fixture();
  const ack = await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  f.journal.accept({ ...ack, kind: "publish", base: 3, revision: 4, press: null });
  expect(f.journal.read().undo).toEqual([]);
  expect(f.journal.read().revision).toBe(4);
});

test("non-undoable start-fresh acknowledgement clears undo and redo", async () => {
  const f = fixture();
  const ack = await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  await f.journal.undo(f.writer);
  const fresh: WorkWriteAck = {
    ...ack,
    kind: "start-fresh",
    base: 2,
    revision: 3,
    press: null,
    undoable: false,
    patches: [{ path: [], value: {} }],
    inverse: [],
  };
  f.journal.accept(fresh);
  expect(f.journal.read()).toMatchObject({ revision: 3, undo: [], redo: [] });
});

test("interleaved disjoint presses remain one step each and undo in last-acknowledged order", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "press-a");
  await f.apply([{ path: ["settings", "height"], value: 8 }], "press-b");
  await f.apply([{ path: ["settings", "width"], value: 30 }], "press-a");
  expect(f.journal.read().undo.map(({ press }) => press)).toEqual(["press-b", "press-a"]);
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true, press: "press-a" });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toMatchObject({
    settings: { width: 10, height: 8 },
  });
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true, press: "press-b" });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toEqual(f.initial);
});

test("interleaved overlapping presses refuse instead of overwriting an intervening human edit", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "press-a");
  await f.apply([{ path: ["settings", "width"], value: 30 }], "press-b");
  await f.apply([{ path: ["settings", "width"], value: 40 }], "press-a");
  expect(f.journal.read().undo).toHaveLength(2);
  expect(await f.journal.undo(f.writer)).toMatchObject({
    ok: false,
    code: "barrier",
    barrier: { receiptId: "press:press-b" },
  });
  expect(f.requests).toEqual([]);
});

test("a held conflict is a barrier: no undo or redo until it is released", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  f.journal.hold(true);
  expect(await f.journal.undo(f.writer)).toEqual({
    ok: false,
    code: "barrier",
    message: "Work changed; review and retry",
  });
  expect(f.requests).toEqual([]);
  expect(f.journal.read().undo).toHaveLength(1);
  f.journal.hold(false);
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true, press: "human-1" });
});
