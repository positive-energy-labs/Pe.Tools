import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  bindWork,
  workKey,
  type RouteStatePatch,
  type WorkAuthor,
  type WorkWrite,
} from "@pe/agent-contracts";
import { z } from "zod";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { createWorkJournal, type JournalWriter } from "./journal";
import { projectTimeline, createRouteTimeline, TIMELINE_LIMIT } from "./timeline";
import { writeLabel } from "./work-writes";

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
    if (event.ok) {
      journal.observe(stored.get(workKey(key)) as { revision: number; doc: unknown });
      journal.accept(event, event.by === "human" ? { label: event.press ?? "Restore" } : undefined);
    }
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

test("undoing a Pea edit still refuses when its path changed elsewhere", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 99 }], null, "pea");
  // A write this journal did not author (a publish, another surface): foreign, overlapping.
  f.journal.accept({
    key: f.key,
    kind: "publish",
    by: "human",
    press: null,
    base: 1,
    revision: 2,
    patches: [{ path: ["settings", "width"], value: 50 }],
    inverse: [{ path: ["settings", "width"], value: 99 }],
    undoable: false,
  });
  const result = await f.journal.undo(f.writer);
  expect(result).toMatchObject({ ok: false, code: "barrier" });
  expect(!result.ok && result.message).toContain("changed elsewhere at r2");
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

test.each(["succeeded", "outcome-unknown"] as const)("%s: timeline eviction never removes the journal barrier", async (state) => {
  const f = fixture();
  f.timeline.append({ kind: "receipt", at: 100, receiptId: "earlier", paths: [[]] });
  await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  f.timeline.append({ kind: "checkpoint", at: 2, paths: [[]] });
  f.timeline.append({ kind: "receipt", at: 3, paths: [["cells"]] });
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: true });
  f.timeline.append({ kind: "receipt", at: 0, receiptId: "after-undo", outcome: { id: "after-undo", state, input: {} }, paths: [["settings"]] });
  for (let at = 0; at <= TIMELINE_LIMIT; at++) f.timeline.append({ kind: "invocation", at });
  expect(f.timeline.read().some(({ receiptId }) => receiptId === "after-undo")).toBe(false);
  expect(projectTimeline([], {}, f.journal.read()).filter((row) => row.kind === "journal")).toMatchObject([
    { move: { kind: "apply" }, barrier: { receiptId: "after-undo" } },
    { move: { kind: "undo" }, barrier: { receiptId: "after-undo" } },
  ]);
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

test("a missed accepted revision retains superseded history rather than restoring across unknown writes", async () => {
  const f = fixture();
  const ack = await f.apply([{ path: ["settings", "width"], value: 20 }], "human-1");
  f.journal.accept({ ...ack, kind: "publish", base: 3, revision: 4, press: null });
  expect(f.journal.read().undo[0]).toMatchObject({ press: "human-1", superseded: { revision: 4 } });
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: false, code: "barrier" });
  expect(f.requests).toEqual([]);
  expect(f.journal.read().revision).toBe(4);
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

test("labels and opaque metadata survive undo, redo and late annotation; a stale row restore refuses", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "clear-width");
  const detail = { label: "clear width", meta: { row: "width", was: 10, totals: [1, 2] } };
  f.journal.describe("clear-width", detail);
  detail.meta.totals[0] = 99;
  expect(f.journal.read().undo[0]).toMatchObject({
    label: "clear width",
    meta: { totals: [1, 2] },
  });
  expect(await f.journal.undo(f.writer, "another-press")).toMatchObject({
    ok: false,
    code: "entry-changed",
  });
  expect(f.requests).toEqual([]);
  expect(await f.journal.undo(f.writer, "clear-width")).toMatchObject({ ok: true });
  expect(f.journal.read().last).toMatchObject({ kind: "undo", step: { label: "clear width" } });
  f.journal.describe("clear-width", { meta: { row: "width", was: 10, totals: [1, 3] } });
  expect(await f.journal.redo(f.writer)).toMatchObject({ ok: true });
  const exposed = f.journal.read();
  expect(exposed.last).toMatchObject({
    kind: "redo",
    step: { label: "clear width", meta: { totals: [1, 3] } },
  });
  exposed.undo[0]!.label = "changed reader";
  expect(f.journal.read().undo[0]!.label).toBe("clear width");
  await f.apply([{ path: ["settings", "height"], value: 8 }], "newer-row");
  expect(await f.journal.undo(f.writer, "clear-width")).toMatchObject({
    ok: false,
    code: "entry-changed",
  });
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

test.each(["undo", "redo"] as const)(
  "%s verifies current values independently of foreign delta marking",
  async (direction) => {
    const f = fixture();
    await f.apply([{ path: ["settings", "width"], value: 20 }], "width");
    if (direction === "redo") await f.journal.undo(f.writer);
    const current = (await f.workspace.read(f.key, f.key.route))!;
    f.journal.observe({
      revision: current.revision,
      doc: { ...f.initial, settings: { width: 99, height: 4 } },
    });
    f.requests.length = 0;
    expect(await f.journal[direction](f.writer)).toMatchObject({
      ok: false,
      code: "barrier",
      message: expect.stringContaining(`${direction} would overwrite it`),
    });
    expect(f.requests).toEqual([]);
    expect(f.journal.read()[direction][0]).toMatchObject({
      label: "width",
      superseded: { path: ["settings", "width"] },
    });
    expect(await f.workspace.read(f.key, f.key.route)).toEqual(current);
  },
);

test("a multi-write press verifies every transition before applying even a disjoint inverse", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "dimensions");
  await f.apply([{ path: ["settings", "height"], value: 8 }], "dimensions");
  f.journal.observe({ revision: 2, doc: { ...f.initial, settings: { width: 99, height: 8 } } });
  expect(await f.journal.undo(f.writer)).toMatchObject({ ok: false });
  expect(f.requests).toEqual([]);
  expect(f.journal.read().undo[0]!.cursor).toBe(2);
});

test("a newer snapshot without its accepted delta refuses without losing the named entry", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "width");
  f.journal.observe({ revision: 2, doc: f.initial });
  expect(await f.journal.undo(f.writer)).toMatchObject({
    ok: false,
    message: expect.stringContaining("current Work values are unverified"),
  });
  expect(f.requests).toEqual([]);
  expect(f.journal.read().undo[0]!.label).toBe("width");
});

test("empty descriptions cannot remove the accepted entry's required label", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "width");
  f.journal.describe("width", { label: "  ", meta: { late: true } });
  expect(f.journal.read().undo[0]).toMatchObject({ label: "width", meta: { late: true } });
});

test("explicit verb labels survive move, late describe and repeated namer registration", () => {
  const key = { route: "labels", binding: "host" as const, target: null };
  const journal = createWorkJournal(key);
  journal.name(() => ({ label: "Edit Work" }));
  journal.accept(
    {
      key,
      kind: "apply",
      by: "human",
      base: 0,
      revision: 1,
      press: "verb",
      undoable: true,
      patches: [{ path: ["flow"], value: 950 }],
      inverse: [{ path: ["flow"], value: 900 }],
    },
    { label: "Set fan flow" },
  );
  expect(journal.read().moves[0]?.label).toBe("Set fan flow");
  journal.describe("verb", { label: "Set MUAS-1 flow" });
  journal.name(() => ({ label: "Edit Work" }));
  expect(journal.read().undo[0]?.label).toBe("Set MUAS-1 flow");
  expect(journal.read().moves[0]?.label).toBe("Set MUAS-1 flow");
});

test("host history replay takes field and cell names even when the route arrives after acquisition", async () => {
  const f = fixture();
  await f.apply([{ path: ["settings", "width"], value: 20 }], "width");
  await f.apply([{ path: ["cells", "one", "edit"], value: { value: "after" } }], "cell");
  const replay = createWorkJournal(f.key);
  let stop = () => {};
  const saved = await new Promise<{
    revision: number;
    doc: unknown;
    history: Parameters<typeof replay.restoreView>[1];
  }>((resolve, reject) => {
    stop = f.workspace.observeFeed(
      f.key,
      (value) => resolve(value as Parameters<typeof resolve>[0]),
      () => {},
      reject,
    );
  });
  stop();
  replay.restoreView(saved, saved.history);
  replay.name((patches) =>
    writeLabel(patches, {
      workFields: { settings: { label: "dimensions" } },
      cells: [{ segment: "cells", noun: "unit flows", groupOf: (id) => [id] }],
    }),
  );
  expect(replay.read().moves.map((move) => move.label)).toEqual([
    "Edit dimensions",
    "Edit unit flows",
  ]);
  expect(await replay.undo(f.writer)).toMatchObject({ ok: true });
  expect((await f.workspace.read(f.key, f.key.route))!.doc).toEqual({
    ...f.initial,
    settings: { width: 20, height: 4 },
  });
});
