import { expect, test, vi } from "vite-plus/test";

const run = vi.hoisted(() => vi.fn());
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: run,
}));

import { entityRoute, type Ctx, type EntityPage, type PodRow } from "./manifest";

const def = {
  key: "things",
  name: "Things",
  entity: "thing",
  target: "document" as const,
  schema: "/schemas/settings/Things/things.json",
  capture: "family.capture" as const,
  apply: "family.apply" as const,
  confirm: true,
};

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
function ctx(page: Partial<EntityPage>) {
  const state = { page: { stage: "audit", pod: "", path: "", ...page } as EntityPage };
  const c = {
    target: { kind: "document", ref },
    readings: { pods: { state: "ready", observation: pods } },
    get page() {
      return state.page;
    },
    setPage: (next: Partial<EntityPage>) => Object.assign(state.page, next),
  } as unknown as Ctx<unknown, string, EntityPage>;
  return { c, state };
}

const { actions } = entityRoute(def);

test("capture is the host workflow into the chosen pod; the page lands on the new member", async () => {
  expect(actions!.capture.ready(ctx({}).c as never, undefined as never)).toMatch(/choose the pod/);
  const { c, state } = ctx({ pod: "p" });
  run.mockReset().mockResolvedValue({
    state: "succeeded",
    result: { member: { pod: "p", path: "settings/family/x.json", sha256: "n" } },
  });
  await actions!.capture.run(c as never, undefined as never);
  expect(run).toHaveBeenCalledWith("family.capture", { pod: "p" }, ref);
  expect(state.page.path).toBe("settings/family/x.json");
});

test("apply refuses unsaved or foreign members, confirms the plan, then applies that hash", async () => {
  expect(
    actions!.apply.ready(ctx({ pod: "p", path: "nope.json" }).c as never, undefined as never),
  ).toMatch(/save/);
  expect(
    actions!.apply.ready(ctx({ pod: "p", path: "settings/b.json" }).c as never, undefined as never),
  ).toMatch(/not a thing spec/);
  const { c } = ctx({ pod: "p", path: "settings/a.json" });
  expect(actions!.apply.ready(c as never, undefined as never)).toBeNull();
  run
    .mockReset()
    .mockResolvedValueOnce({ state: "succeeded", result: { plan: { planHash: "ph" } } })
    .mockResolvedValueOnce({ state: "succeeded", result: {} });
  await actions!.apply.run(c as never, undefined as never);
  const source = { pod: "p", path: "settings/a.json", sha256: "h" };
  expect(run.mock.calls).toEqual([
    ["family.apply", { source }, ref],
    ["family.apply", { source, planHash: "ph" }, ref],
  ]);
});

test("a refused workflow surfaces its reason", async () => {
  const { c } = ctx({ pod: "p", path: "settings/a.json" });
  run.mockReset().mockResolvedValue({ state: "failed", error: "member changed" });
  await expect(actions!.apply.run(c as never, undefined as never)).rejects.toThrow(
    "member changed",
  );
});
