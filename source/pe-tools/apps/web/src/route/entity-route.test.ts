import { expect, test, vi } from "vite-plus/test";

const run = vi.hoisted(() => vi.fn());
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: run,
}));

import {
  admissionPlan,
  entitySearch,
  entityRoute,
  type Ctx,
  type EntityPage,
  type PlanEntry,
  type PodRow,
} from "./manifest";

const base = {
  key: "things",
  name: "Things",
  entity: "thing",
  target: "document" as const,
  schema: "/schemas/settings/Things/things.json",
  capture: "family.capture" as const,
  apply: "family.apply" as const,
};

const row = (planHash: string, flag: string | null = null): PlanEntry => ({
  id: planHash,
  name: planHash,
  planHash,
  actions: 1,
  detail: "",
  flag,
  warnings: [],
});

const pods: PodRow[] = [
  {
    id: "p",
    name: "P",
    version: "1",
    folder: "Pods/p",
    entrypoints: [],
    members: [
      {
        path: "settings/a.json",
        sha256: "h",
        schema: "http://x:1/schemas/settings/Things/things.json",
      },
      { path: "settings/b.json", sha256: "i", schema: null },
    ],
    diagnostics: [],
  },
];

const ref = { session: "s", openId: "o" };
const source = { pod: "p", path: "settings/a.json", sha256: "h" };

function ctx(page: Partial<EntityPage>) {
  const state = {
    page: {
      stage: "audit",
      pod: "",
      path: "",
      selection: [],
      confirming: false,
      sheet: null,
      ...page,
    } as EntityPage,
  };
  const c = {
    target: { kind: "document", ref },
    readings: { pods: { state: "ready", observation: pods } },
    work: { key: {}, doc: null, revision: null },
    get page() {
      return state.page;
    },
    setPage: (next: Partial<EntityPage>) => Object.assign(state.page, next),
  } as unknown as Ctx<unknown, string, EntityPage>;
  return { c, state };
}

const planless = entityRoute(base).actions!;
const planned = entityRoute({
  ...base,
  plan: admissionPlan("family.apply", (plan) => row((plan as { planHash: string }).planHash)),
}).actions!;
const none = undefined as never;

test("capture is the host workflow into the chosen pod; the page lands on the new member", async () => {
  expect(planless.capture.ready(ctx({}).c as never, none)).toMatch(/choose the pod/);
  const { c, state } = ctx({ pod: "p" });
  run.mockReset().mockResolvedValue({
    state: "succeeded",
    result: { member: { pod: "p", path: "settings/family/x.json", sha256: "n" } },
  });
  await planless.capture.run(c as never, none);
  expect(run).toHaveBeenCalledWith("family.capture", { pod: "p" }, ref);
  expect(state.page.path).toBe("settings/family/x.json");
});

test("a selection route refuses capture until audit rows are picked, and clears them after", async () => {
  const actions = entityRoute({
    ...base,
    target: "selection",
    captureInput: (c) => ({ ids: c.page.selection }),
  }).actions!;
  expect(actions.capture.ready(ctx({ pod: "p" }).c as never, none)).toMatch(/pick rows/);
  const { c, state } = ctx({ pod: "p", selection: ["7", "9"] });
  expect(actions.capture.ready(c as never, none)).toBeNull();
  run.mockReset().mockResolvedValue({
    state: "succeeded",
    result: { members: [{ pod: "p", path: "settings/x/7.json" }] },
  });
  await actions.capture.run(c as never, none);
  expect(run).toHaveBeenCalledWith("family.capture", { pod: "p", ids: ["7", "9"] }, ref);
  expect(state.page).toMatchObject({ path: "settings/x/7.json", selection: [] });
});

test("apply refuses unsaved or foreign members; without a plan it applies the saved source", async () => {
  expect(planless.apply.ready(ctx({ pod: "p", path: "nope.json" }).c as never, none)).toMatch(
    /save/,
  );
  expect(planless.apply.ready(ctx({ pod: "p", path: "settings/b.json" }).c as never, none)).toMatch(
    /not a thing spec/,
  );
  expect(planless).not.toHaveProperty("confirm");
  const { c } = ctx({ pod: "p", path: "settings/a.json" });
  run.mockReset().mockResolvedValue({ state: "succeeded", result: {} });
  await planless.apply.run(c as never, none);
  expect(run.mock.calls).toEqual([["family.apply", { source }, ref]]);
});

test("with a plan, apply opens the sheet and changes nothing; confirm applies that hash", async () => {
  const { c, state } = ctx({ pod: "p", path: "settings/a.json" });
  expect(planned.confirm.ready(c as never, none)).toBe("plan first");
  run
    .mockReset()
    .mockResolvedValueOnce({ state: "succeeded", result: { plan: { planHash: "ph" } } });
  await planned.apply.run(c as never, none);
  expect(run.mock.calls).toEqual([["family.apply", { source }, ref]]);
  expect(state.page.confirming).toBe(true);
  expect(state.page.sheet?.entries.map((entry) => entry.planHash)).toEqual(["ph"]);
  expect(planned.confirm.ready(c as never, none)).toBeNull();
  run.mockResolvedValueOnce({ state: "succeeded", result: {} });
  await planned.confirm.run(c as never, none);
  expect(run.mock.calls[1]).toEqual(["family.apply", { source, planHash: "ph" }, ref]);
  expect(state.page).toMatchObject({ confirming: false, sheet: null });
});

test("confirm sends only included rows and refuses when nothing is left", async () => {
  const confirm = vi.fn(async (..._args: unknown[]) => {});
  const actions = entityRoute({
    ...base,
    plan: {
      read: async () => null,
      sheet: () => ({ id: "plan-1", entries: [row("a"), row("b"), row("c", "nothing to apply")] }),
      excluded: () => ["b"],
      confirm,
    },
  }).actions!;
  const { c } = ctx({ pod: "p", path: "settings/a.json", confirming: true });
  await actions.confirm.run(c as never, none);
  expect(confirm.mock.calls[0]![2]).toEqual([row("a")]);
  const flagged = entityRoute({
    ...base,
    plan: { read: async () => null, sheet: () => ({ entries: [row("c", "refused")] }), confirm },
  }).actions!;
  expect(
    flagged.confirm.ready(
      ctx({ pod: "p", path: "settings/a.json", confirming: true }).c as never,
      none,
    ),
  ).toMatch(/no included row/);
});

test("a refused workflow surfaces its reason", async () => {
  const { c } = ctx({ pod: "p", path: "settings/a.json" });
  run.mockReset().mockResolvedValue({ state: "failed", error: "member changed" });
  await expect(planless.apply.run(c as never, none)).rejects.toThrow("member changed");
});

test("the URL carries stage, pod and path, and nothing malformed", () => {
  expect(entitySearch({ stage: "apply", pod: "p", path: "a.json", x: 1 })).toEqual({
    stage: "apply",
    pod: "p",
    path: "a.json",
  });
  expect(entitySearch({ stage: "nope", pod: "", path: 3 })).toEqual({});
});

test("verbs need what their workflow contract needs; the route needs what the definition says", () => {
  // `family.capture` and `family.apply` need a family document.
  expect([planless.capture.needs, planless.apply.needs, planned.apply.needs]).toEqual([
    "family",
    "family",
    "family",
  ]);
  expect(entityRoute(base).needs).toBe("project");
  expect(entityRoute({ ...base, needs: "document" }).needs).toBe("document");
});
