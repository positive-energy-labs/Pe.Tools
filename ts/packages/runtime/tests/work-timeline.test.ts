import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  actionStatusSchema,
  bindWork,
  refusalText,
  workTimelineSchema,
  type ActionStatus,
  type WorkKey,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { mergeTimeline, projectWorks } from "../src/work-timeline.ts";

/** Two Works in one Place, as Fans edits both its own Work and Ducts'. */
function place() {
  const ducts = bindWork("ducts-proof", null, "one"),
    fans = bindWork("fans-proof", null, "one");
  const saved = new Map<string, unknown>();
  const host = new RouteWorkspace({
    registrations: [ducts, fans].map((key) => ({
      spec: {
        route: key.route,
        title: key.route,
        description: "Proof",
        schema: z.object({ a: z.number().default(0), b: z.number().default(0) }),
      },
    })),
    store: {
      getState: async ({ targetKey, route }) => structuredClone(saved.get(`${route}:${targetKey}`) ?? null),
      setState: async ({ targetKey, route, value }) => {
        saved.set(`${route}:${targetKey}`, structuredClone(value));
      },
    },
  });
  const works = [ducts, fans];
  const edit = async (key: WorkKey, by: "human" | "pea", press: string, path: "a" | "b", value: number) => {
    const result = await host.write(key, key.route, by, {
      kind: "apply",
      press,
      label: press,
      expectedRevision: (await host.view(key, key.route))!.revision,
      patches: [{ path: [path], value }],
    });
    if (!result.ok) throw Error(refusalText(result));
    // Host stamps are milliseconds; the order across Works is their order.
    await new Promise((resolve) => setTimeout(resolve, 3));
    return result;
  };
  const read = async (by: "human" | "pea", receipts: ActionStatus[] = []) =>
    workTimelineSchema.parse(mergeTimeline([await host.timeline(works, by, receipts)]).timeline);
  const press = async (by: "human" | "pea", direction: "undo" | "redo", receipts: ActionStatus[] = []) => {
    const next = (await read(by, receipts))[direction];
    if (!next) throw Error(`The read offers no ${direction}`);
    const result = await host.step(works, by, direction, next, async () => receipts);
    await new Promise((resolve) => setTimeout(resolve, 3));
    return { next, result };
  };
  return { host, ducts, fans, works, edit, read, press };
}

/** A successful Revit write that consumed `key` at `revision`. */
const revitWrite = (key: WorkKey, revision: number, expected: unknown) =>
  actionStatusSchema.parse({
    id: "receipt-1",
    key: "ducts.push",
    state: "succeeded",
    result: {},
    caller: { kind: "pea", context: "minted", thread: "thread" },
    basis: null,
    target: { kind: "host" },
    input: {},
    startedAt: "2026-11-12T15:00:00Z",
    effects: [{ kind: "file", path: "C:/model" }],
    consumes: [{ kind: "work", probe: { handle: { key, revision }, paths: [["a"]] }, expected }],
  });

test("two Works: two undos then one redo through the door, and the read names each step the door takes", async () => {
  const f = place();
  await f.edit(f.ducts, "human", "ducts edit", "a", 1);
  await f.edit(f.fans, "human", "fans edit", "a", 2);
  expect((await f.read("human")).rows.map((row) => "label" in row && row.label)).toEqual([
    "ducts edit",
    "fans edit",
  ]);

  const first = await f.press("human", "undo");
  expect(first.next).toMatchObject({ work: f.fans, label: "fans edit" });
  expect(first.result).toMatchObject({ ok: true, doc: { a: 0 }, write: { key: f.fans } });
  const second = await f.press("human", "undo");
  expect(second.next).toMatchObject({ work: f.ducts, label: "ducts edit" });
  expect(second.result).toMatchObject({ ok: true, doc: { a: 0 }, write: { key: f.ducts } });

  // The most recently undone step comes back first.
  const redo = await f.press("human", "redo");
  expect(redo.next).toMatchObject({ work: f.ducts, label: "ducts edit" });
  expect(redo.result).toMatchObject({ ok: true, doc: { a: 1 }, write: { key: f.ducts } });
  const after = await f.read("human");
  expect(after.undo).toMatchObject({ work: f.ducts });
  expect(after.redo).toMatchObject({ work: f.fans });
  expect(after.rows.flatMap((row) => (row.kind === "edit" ? [row.state] : []))).toEqual(["applied", "undone"]);
});

test.each(["human", "pea"] as const)(
  "after a Revit write consumed an edit, the door refuses %s's undo and names the receipt",
  async (by) => {
    const f = place();
    const edit = await f.edit(f.ducts, by, "friction", "a", 5);
    const receipts = [revitWrite(f.ducts, edit.revision, { a: 5 })];

    const read = await f.read(by, receipts);
    expect(read.undo).toBeNull();
    expect(read.refusal.undo).toContain("receipt-1");
    expect(read.rows.find((row) => row.kind === "edit")).toMatchObject({
      state: "blocked",
      blockedBy: { receipt: "receipt-1", label: "ducts.push" },
    });
    expect(read.rows.find((row) => row.kind === "receipt")).toMatchObject({ id: "receipt-1", work: f.ducts });

    // A client that still holds the step it was shown before the write landed is refused too.
    const shown = (await f.read(by)).undo!;
    const refused = await f.host.step(f.works, by, "undo", shown, async () => receipts);
    if (refused.ok) throw Error("The door restored a step a Revit write consumed");
    expect(refusalText(refused)).toContain("receipt-1");
    expect((await f.host.view(f.ducts, f.ducts.route))!.doc).toMatchObject({ a: 5 });
    // An edit made after the write is still the caller's to undo.
    await f.edit(f.ducts, by, "later", "b", 9);
    expect((await f.press(by, "undo", receipts)).result).toMatchObject({ ok: true, doc: { a: 5, b: 0 } });
  },
);

test("undo is per author on every Work, and a stale expected step is refused", async () => {
  const f = place();
  await f.edit(f.ducts, "human", "mine", "a", 1);
  await f.edit(f.ducts, "pea", "pea's", "b", 2);
  expect((await f.read("human")).undo).toMatchObject({ label: "mine" });
  expect((await f.read("pea")).undo).toMatchObject({ label: "pea's" });
  const shown = (await f.read("human")).undo!;
  await f.edit(f.fans, "human", "newer", "a", 3);
  expect(await f.host.step(f.works, "human", "undo", shown, async () => [])).toMatchObject({
    ok: false,
    code: "stale_revision",
  });
  expect((await f.press("human", "undo")).result).toMatchObject({ ok: true, write: { key: f.fans } });
  expect((await f.press("human", "undo")).result).toMatchObject({ ok: true, doc: { a: 0, b: 2 } });
});

test("T4: the projection never reads the clock: an ack stored without a stamp projects at 0", async () => {
  const f = place();
  const { at: _at, ...unstamped } = (await f.edit(f.ducts, "human", "old", "a", 1)).write;
  const work = { key: f.ducts, snapshot: { revision: 1, doc: { a: 1, b: 0 } }, acks: [unstamped] };
  const part = projectWorks([work], [], "human");
  expect(part.undo).toMatchObject({ at: 0, ref: { label: "old" } });
  expect(part.rows).toMatchObject([{ at: 0 }]);
});

test("a rejected Pea write marks consumed human edits not written and Pea edits rejected", async () => {
  const f = place();
  await f.edit(f.ducts, "human", "Human input", "a", 1);
  const pea = await f.edit(f.ducts, "pea", "Pea input", "b", 2);
  const reason = "rejected by person";
  const rejected = actionStatusSchema.parse({
    ...revitWrite(f.ducts, pea.revision, { a: 1, b: 2 }),
    state: "cancelled", error: reason, status: 409, effects: [],
    consumes: [{ kind: "work", probe: { handle: { key: f.ducts, revision: pea.revision }, paths: [["a"], ["b"]] }, expected: { a: 1, b: 2 } }],
  });
  expect((await f.read("human", [rejected])).rows.filter(row => row.kind === "edit")).toMatchObject([
    { by: "human", notWritten: { invocation: rejected.id, reason, rejected: false } },
    { by: "pea", notWritten: { invocation: rejected.id, reason, rejected: true } },
  ]);
});

test("a successful preview with no effects leaves the host Timeline step undoable", async () => {
  const f = place();
  const edit = await f.edit(f.ducts, "human", "Preview input", "a", 5);
  const preview = actionStatusSchema.parse({ ...revitWrite(f.ducts, edit.revision, { a: 5 }), key: "ducts.plan", effects: [] });
  const read = await f.read("human", [preview]);
  expect(read.undo).toMatchObject({ work: f.ducts, label: "Preview input" });
  expect(read.refusal.undo).toBeNull();
  expect((await f.press("human", "undo", [preview])).result).toMatchObject({ ok: true, doc: { a: 0 } });
});
