import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  actionStatusSchema,
  bindWork,
  workTimelineSchema,
  type Caller,
  type WorkKey,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { withInvocationContext } from "@pe/runtime/context";
import { createPeRoutes } from "../src/pe-routes.ts";
import { hostTimeline, registerTimelineSource } from "../src/reads/work-timeline.ts";
import { graphRoute } from "../src/reads/routes.ts";
import { inputPort } from "../src/reads/inputs.ts";
import { approvedPea, human } from "./callers.ts";

/** The production step door over two Works of one Place, with receipts read from the action journal. */
function doors() {
  const ducts = bindWork("ducts-proof", null, "one"),
    fans = bindWork("fans-proof", null, "one");
  const registrations = [ducts, fans].map((key) => ({
    spec: {
      route: key.route,
      title: key.route,
      description: "Proof",
      schema: z.object({ a: z.number().default(0) }),
    },
  }));
  const saved = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations,
    store: {
      getState: async ({ targetKey, route }) =>
        structuredClone(saved.get(`${route}:${targetKey}`) ?? null),
      setState: async ({ targetKey, route, value }) =>
        void saved.set(`${route}:${targetKey}`, structuredClone(value)),
    },
  });
  const receipts: unknown[] = [];
  /** Receipts that exist only from the nth journal read on: a write landing while a step is in flight. */
  const late = { from: Infinity, rows: [] as unknown[], reads: 0 };
  const journal = async () =>
    [...receipts, ...(++late.reads >= late.from ? late.rows : [])].map((value) =>
      actionStatusSchema.parse(value),
    );
  const routes = createPeRoutes({ workspace, timelineReceipts: journal, registrations });
  const works = [ducts, fans];
  const post = async (key: WorkKey, verb: "apply" | "history", body: unknown, caller: Caller) => {
    const response = await withInvocationContext({ caller }, () =>
      routes.fetch(
        new Request(`http://host/pe/route-state/${key.route}/${verb}?work=one`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  let presses = 0;
  return {
    ducts,
    fans,
    works,
    receipts,
    late,
    /** The raw inverse posted to the apply door, as the browser journal's undo sends it. */
    restore: (key: WorkKey, of: { revision: number; inverse: unknown }, caller: Caller) =>
      post(
        key,
        "apply",
        {
          patches: of.inverse,
          expectedRevision: of.revision,
          press: null,
          kind: "restore",
          restoreOf: of.revision,
        },
        caller,
      ),
    timeline: hostTimeline(workspace, journal),
    read: (by: "human" | "pea") => hostTimeline(workspace, journal).read(works, by),
    value: async (key: WorkKey) => ((await workspace.view(key, key.route))!.doc as { a: number }).a,
    async edit(key: WorkKey, caller: Caller, a: number) {
      const written = await post(
        key,
        "apply",
        {
          patches: [{ path: ["a"], value: a }],
          expectedRevision: (await workspace.view(key, key.route))!.revision,
          press: `press-${++presses}`,
          label: `${key.route} a=${a}`,
        },
        caller,
      );
      expect(written.body, JSON.stringify(written.body)).toMatchObject({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 3));
      return (written.body as { write: { revision: number; inverse: unknown } }).write;
    },
    async step(direction: "undo" | "redo", caller: Caller, expected: unknown) {
      const result = await post(ducts, "history", { direction, works, expected }, caller);
      await new Promise((resolve) => setTimeout(resolve, 3));
      return result;
    },
  };
}
const authorOf = (caller: Caller) => (caller.kind === "pea" ? "pea" : "human");

test("two Works: two undos then one redo through the door succeed, and the read names the step each takes", async () => {
  const d = doors();
  await d.edit(d.ducts, human, 1);
  await d.edit(d.fans, human, 2);
  for (const [direction, work, left] of [
    ["undo", d.fans, 0],
    ["undo", d.ducts, 0],
    ["redo", d.ducts, 1],
  ] as const) {
    const shown = workTimelineSchema.parse(await d.read("human"))[direction];
    expect(shown).toMatchObject({ work });
    expect((await d.step(direction, human, shown)).body).toMatchObject({
      ok: true,
      write: { key: work },
    });
    expect(await d.value(work)).toBe(left);
  }
  expect(await d.read("human")).toMatchObject({ undo: { work: d.ducts }, redo: { work: d.fans } });
});

test.each([
  ["a person", human],
  ["Pea", approvedPea("timeline-door")],
] as const)(
  "after a Revit write consumed an edit the door refuses the undo for %s and names the receipt",
  async (_name, caller) => {
    const d = doors();
    const edit = await d.edit(d.ducts, caller, 5);
    const shown = (await d.read(authorOf(caller))).undo;
    expect(shown).toMatchObject({ work: d.ducts });
    d.receipts.push({
      id: "receipt-9",
      key: "ducts.push",
      state: "succeeded",
      result: {},
      caller: approvedPea("timeline-door"),
      basis: null,
      target: { kind: "host" },
      input: {},
      startedAt: "2026-11-12T15:00:00Z",
      effects: [{ kind: "file", path: "C:/model" }],
      consumes: [
        {
          kind: "work",
          probe: { handle: { key: d.ducts, revision: edit.revision }, paths: [["a"]] },
          expected: { a: 5 },
        },
      ],
    });
    const read = await d.read(authorOf(caller));
    expect(read.undo).toBeNull();
    expect(read.refusal.undo).toContain("receipt-9");
    const refused = await d.step("undo", caller, shown);
    expect(refused.body).toMatchObject({ ok: false, error: expect.stringContaining("receipt-9") });
    expect(await d.value(d.ducts)).toBe(5);
  },
);

test("the door refuses a body with no expected step, a step it would not take, and a caller that is neither author", async () => {
  const d = doors();
  await d.edit(d.ducts, human, 1);
  const shown = (await d.read("human")).undo;
  expect((await d.step("undo", human, undefined)).status).toBe(400);
  await d.edit(d.fans, human, 2);
  expect((await d.step("undo", human, shown)).body).toMatchObject({
    ok: false,
    code: "stale_revision",
  });
  expect((await d.step("undo", { kind: "anonymous" }, shown)).status).toBe(403);
  expect([await d.value(d.ducts), await d.value(d.fans)]).toEqual([1, 2]);
});

test("a registered second source competes for the next step, and the door routes the step to it (K-A5)", async () => {
  const d = doors();
  await d.edit(d.ducts, human, 1);
  const home = {
    home: "C:/home/Settings/ducts.json",
    sha256: "ab",
    label: "ducts designFriction at project",
  };
  const taken: unknown[] = [];
  const release = registerTimelineSource({
    read: () => ({
      rows: [],
      undo: { ref: home, at: Date.now() + 60_000, refusal: null },
      redo: null,
    }),
    step: async (direction, expected, caller) => (
      taken.push([direction, expected, caller.kind]),
      { ok: true, sha256: "cd" }
    ),
  });
  try {
    expect((await d.read("human")).undo).toEqual(home);
    expect((await d.step("undo", human, home)).body).toEqual({ ok: true, sha256: "cd" });
    expect(taken).toEqual([["undo", home, "human"]]);
    expect(await d.value(d.ducts)).toBe(1);
  } finally {
    release();
  }
  expect((await d.read("human")).undo).toMatchObject({ work: d.ducts });
});

test("the read door stamps the caller's author over anything the client sent, and the port answers from the Timeline", async () => {
  const d = doors();
  await d.edit(d.ducts, approvedPea("timeline-door"), 4);
  const request = {
    read: "work.timeline",
    args: { works: d.works, by: "human" },
    subscription: "s",
    generation: 0,
  };
  const bound = graphRoute("reads.value", request, undefined, "pea");
  expect(bound.args).toMatchObject({ by: "pea" });
  const port = inputPort({
    source: {} as never,
    workspace: {} as never,
    marks: {} as never,
    run: (async () => undefined) as never,
    evaluation: "test",
    origin: () => null,
    revision: () => 0,
    timeline: d.timeline,
  });
  expect(workTimelineSchema.parse(await bound.evaluate(port))).toMatchObject({
    undo: { work: d.ducts },
  });
  // A person has no step here: the edit is Pea's.
  expect(await graphRoute("reads.value", request, undefined, "human").evaluate(port)).toMatchObject(
    { undo: null },
  );
  // A lane with no action journal refuses the read; it never builds a Timeline without receipts.
  await expect(
    bound.evaluate(
      inputPort({
        source: {} as never,
        workspace: {} as never,
        marks: {} as never,
        run: (async () => undefined) as never,
        evaluation: "test",
        origin: () => null,
        revision: () => 0,
      }),
    ),
  ).rejects.toThrow(/action journal/);
});

/** A Revit write that consumed `key` at `revision`, in the given state. */
const consumed = (
  key: WorkKey,
  revision: number,
  a: number,
  state: "running" | "succeeded" | "failed" = "succeeded",
) => ({
  id: "receipt-9",
  key: "ducts.push",
  state,
  ...(state === "succeeded"
    ? { result: {} }
    : state === "failed"
      ? { error: "native failed", status: 500 }
      : {}),
  caller: approvedPea("timeline-door"),
  basis: null,
  target: { kind: "host" },
  input: {},
  startedAt: "2026-11-12T15:00:00Z",
  effects: [{ kind: "file", path: "C:/model" }],
  consumes: [
    { kind: "work", probe: { handle: { key, revision }, paths: [["a"]] }, expected: { a } },
  ],
});

test.each([
  ["a person", human],
  ["Pea", approvedPea("timeline-door")],
] as const)(
  "T1: a raw restore through /apply is the caller's own next step or it is refused, for %s",
  async (_name, caller) => {
    const d = doors();
    const other = caller.kind === "pea" ? human : approvedPea("timeline-door");
    const edit = await d.edit(d.ducts, caller, 5);
    // The other author cannot post this author's inverse.
    const foreign = await d.restore(d.ducts, edit, other);
    expect(foreign.body).toMatchObject({
      ok: false,
      error: expect.stringContaining("own next Timeline step"),
    });
    expect(await d.value(d.ducts)).toBe(5);
    // After a Revit write consumed the edit, its own author cannot either, and the refusal names the receipt.
    d.receipts.push(consumed(d.ducts, edit.revision, 5));
    const held = await d.restore(d.ducts, edit, caller);
    expect(held.body).toMatchObject({ ok: false, error: expect.stringContaining("receipt-9") });
    expect(await d.value(d.ducts)).toBe(5);
    // With no write holding it, the author's own raw restore still lands: the browser's undo keeps working.
    d.receipts.length = 0;
    expect((await d.restore(d.ducts, edit, caller)).body).toMatchObject({
      ok: true,
      write: { kind: "restore" },
    });
    expect(await d.value(d.ducts)).toBe(0);
  },
);

test("T2: a running Revit write that consumed the edit holds undo; only a terminal outcome without a write releases it", async () => {
  const d = doors();
  const edit = await d.edit(d.ducts, human, 5);
  const shown = (await d.read("human")).undo;
  d.receipts.push(consumed(d.ducts, edit.revision, 5, "running"));
  const read = await d.read("human");
  expect(read.undo).toBeNull();
  expect(read.refusal.undo).toContain("receipt-9");
  expect((await d.step("undo", human, shown)).body).toMatchObject({
    ok: false,
    error: expect.stringContaining("receipt-9"),
  });
  expect((await d.restore(d.ducts, edit, human)).body).toMatchObject({
    ok: false,
    error: expect.stringContaining("receipt-9"),
  });
  expect(await d.value(d.ducts)).toBe(5);
  d.receipts[0] = consumed(d.ducts, edit.revision, 5, "failed");
  expect((await d.step("undo", human, shown)).body).toMatchObject({ ok: true });
  expect(await d.value(d.ducts)).toBe(0);
});

test("T3: a Revit write that lands after the step was chosen is seen inside the write boundary", async () => {
  const d = doors();
  const edit = await d.edit(d.ducts, human, 5);
  const shown = (await d.read("human")).undo;
  // The door reads receipts to merge, then to choose, then inside the restore's write boundary.
  d.late.rows.push(consumed(d.ducts, edit.revision, 5));
  d.late.from = d.late.reads + 3;
  expect((await d.step("undo", human, shown)).body).toMatchObject({
    ok: false,
    error: expect.stringContaining("receipt-9"),
  });
  expect(d.late.reads).toBe(d.late.from);
  expect(await d.value(d.ducts)).toBe(5);
});
