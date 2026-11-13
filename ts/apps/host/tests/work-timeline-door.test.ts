import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, workTimelineSchema, type Caller, type WorkKey } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { withInvocationContext } from "@pe/runtime/context";
import type { ActionJournal } from "../src/action-journal.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { hostTimeline, registerTimelineSource } from "../src/reads/work-timeline.ts";
import { approvedPea, human } from "./callers.ts";

/** The production step door over two Works of one Place, with receipts read from the action journal. */
function doors() {
  const ducts = bindWork("ducts-proof", null, "one"),
    fans = bindWork("fans-proof", null, "one");
  const registrations = [ducts, fans].map((key) => ({
    spec: { route: key.route, title: key.route, description: "Proof", schema: z.object({ a: z.number().default(0) }) },
  }));
  const saved = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations,
    store: {
      getState: async ({ targetKey, route }) => structuredClone(saved.get(`${route}:${targetKey}`) ?? null),
      setState: async ({ targetKey, route, value }) => void saved.set(`${route}:${targetKey}`, structuredClone(value)),
    },
  });
  const receipts: unknown[] = [];
  const journal = {
    read: async () => receipts.map((value, revision) => ({ revision, body: { kind: "action", value } })),
  } as unknown as ActionJournal;
  const routes = createPeRoutes({ workspace, journal, registrations });
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
    read: (by: "human" | "pea") => hostTimeline(workspace, journal).read(works, by),
    value: async (key: WorkKey) => ((await workspace.view(key, key.route))!.doc as { a: number }).a,
    async edit(key: WorkKey, caller: Caller, a: number) {
      const written = await post(
        key,
        "apply",
        { patches: [{ path: ["a"], value: a }], expectedRevision: (await workspace.view(key, key.route))!.revision, press: `press-${++presses}`, label: `${key.route} a=${a}` },
        caller,
      );
      expect(written.body, JSON.stringify(written.body)).toMatchObject({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 3));
      return written.body as { revision: number };
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
  for (const [direction, work, left] of [["undo", d.fans, 0], ["undo", d.ducts, 0], ["redo", d.ducts, 1]] as const) {
    const shown = workTimelineSchema.parse(await d.read("human"))[direction];
    expect(shown).toMatchObject({ work });
    expect((await d.step(direction, human, shown)).body).toMatchObject({ ok: true, write: { key: work } });
    expect(await d.value(work)).toBe(left);
  }
  expect(await d.read("human")).toMatchObject({ undo: { work: d.ducts }, redo: { work: d.fans } });
});

test.each([["a person", human], ["Pea", approvedPea("timeline-door")]] as const)(
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
      consumes: [{ kind: "work", probe: { handle: { key: d.ducts, revision: edit.revision }, paths: [["a"]] }, expected: { a: 5 } }],
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
  expect((await d.step("undo", human, shown)).body).toMatchObject({ ok: false, code: "stale_revision" });
  expect((await d.step("undo", { kind: "anonymous" }, shown)).status).toBe(403);
  expect([await d.value(d.ducts), await d.value(d.fans)]).toEqual([1, 2]);
});

test("a registered second source competes for the next step, and the door routes the step to it (K-A5)", async () => {
  const d = doors();
  await d.edit(d.ducts, human, 1);
  const home = { home: "C:/home/Settings/ducts.json", sha256: "ab", label: "ducts designFriction at project" };
  const taken: unknown[] = [];
  const release = registerTimelineSource({
    read: () => ({ rows: [], undo: { ref: home, at: Date.now() + 60_000, refusal: null }, redo: null }),
    step: async (direction, expected, caller) => (taken.push([direction, expected, caller.kind]), { ok: true, sha256: "cd" }),
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
