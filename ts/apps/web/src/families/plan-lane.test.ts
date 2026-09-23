import { expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({
  runSemanticAction: vi.fn(async (..._args: unknown[]) => ({
    state: "succeeded",
    result: {} as Record<string, unknown>,
  })),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => client);
const pods = vi.hoisted(() => ({
  write: vi.fn(async (..._args: unknown[]) => ({ pod: "", path: "", sha256: "" })),
}));
vi.mock("#/route/pods", async (importOriginal) => {
  const real = await importOriginal<typeof import("#/route/pods")>();
  return { ...real, podHost: { ...real.podHost, write: pods.write } };
});

import { familyCellKey } from "@pe/agent-contracts";

import { FAMILIES_SEEDS } from "./seeds";
import { familiesSpec, manifest } from "./manifest";
import { captureEvidenceOf } from "./store";

const seed = FAMILIES_SEEDS.apply as unknown as {
  work: { excluded: Record<string, { by: string }> };
  readings: { pods: unknown };
  page: { pod: string; path: string; sheet: { entries: unknown[] } };
};
const ref = { session: "s", openId: "o" };
const source = { pod: seed.page.pod, path: seed.page.path, sha256: "8".repeat(64) };
const view = (page: Record<string, unknown> = {}) => ({
  target: { kind: "document", ref },
  work: {
    key: { binding: "host" as const, route: "families", target: null },
    doc: seed.work,
    revision: 4,
  },
  readings: { pods: { state: "ready", observation: seed.readings.pods } },
  page: {
    stage: "apply",
    pod: seed.page.pod,
    path: seed.page.path,
    selection: [],
    confirming: false,
    sheet: null,
    draft: { placement: "AllLoaded", categories: [], families: [] },
    ...page,
  },
  write: vi.fn(async () => null),
  setPage: vi.fn(),
});

test("plan reads the page's member against the reviewed Work, and writes no Work", async () => {
  const ctx = view();
  const plan = [{ familyId: 3101, familyName: "A", planHash: "p", changes: [], runEffects: ["x"] }];
  client.runSemanticAction.mockResolvedValueOnce({
    state: "succeeded",
    result: {
      plan: plan.map((row) => ({ ...row, refusals: [], warnings: [] })),
      included: { "3101": "p" },
    },
  });
  await manifest.actions!.plan.run(ctx as never, undefined as never);
  expect(client.runSemanticAction).toHaveBeenLastCalledWith(
    "families.plan",
    // Exclusions are the reviewed Work's; the plan reads them there and is never sent them.
    { source },
    ref,
    { work: { key: ctx.work.key, revision: 4 } },
  );
  expect(ctx.write).not.toHaveBeenCalled();
  expect(ctx.setPage).toHaveBeenCalledWith(
    {
      confirming: true,
      // The row is its family, by name; the id the plan resolved is apply's hash key only.
      sheet: { entries: [expect.objectContaining({ id: "A", hashKey: "3101", planHash: "p" })] },
    },
    ["stage", "pod", "path", "selection"],
  );
});

test("held-back rows are the Work's exclusions, by name, as this sheet's row ids", () => {
  expect(familiesSpec.plan!.excluded!(view({ sheet: seed.page.sheet }) as never)).toEqual([
    "Heat Pump - Split",
  ]);
});

test("apply names its plan with exactly the included hashes", async () => {
  const ctx = view({ confirming: true, sheet: seed.page.sheet });
  expect(manifest.actions!.apply.ready(ctx as never, undefined as never)).toBeNull();
  await manifest.actions!.apply.run(ctx as never, undefined as never);
  expect(client.runSemanticAction).toHaveBeenLastCalledWith(
    "families.apply",
    { plan: "demo-plan", expectedPlanHashes: { "3101": "plan-3101" } },
    ref,
    undefined,
  );
});

test("capture evidence is read off the capture's own receipt, failures included", () => {
  const result = {
    members: [{ pod: "p", path: "settings/families/a.json", sha256: "a".repeat(64) }],
    evidence: {
      diagnostics: [],
      families: [
        {
          familyId: 1,
          familyName: "A",
          success: true,
          coverage: { types: "Full" },
          unmodeledCount: 2,
          issues: [],
        },
        { familyId: 2, success: false, error: "cannot open" },
      ],
    },
  };
  const captured = captureEvidenceOf([{ id: "c", result }], "c");
  expect(
    captured?.evidence.families.map((f) => [f.familyId, f.unmodeledCount, f.error ?? null]),
  ).toEqual([
    [1, 2, null],
    [2, 0, "cannot open"],
  ]);
  expect(captureEvidenceOf([{ id: "c", result: { member: {} } }], "c")).toBeNull();
  expect(captureEvidenceOf(undefined, "c")).toBeNull();
});

/* F-J3-6: plan words what it plans; saving the draft to the pod is its own, optional verb. */
const staged = (familyName: string, value: string) => [
  familyCellKey({ familyName, typeName: "T", parameter: "Mark" }),
  { staged: { value: { value, storageType: "String" } } },
];
const stagedView = () =>
  view({
    stage: "audit",
    path: null,
  }) as ReturnType<typeof view> & { work: { doc: Record<string, unknown> } };
const withCells = (ctx: ReturnType<typeof stagedView>) => {
  ctx.work.doc = {
    ...seed.work,
    cells: Object.fromEntries([staged("Alpha", "a"), staged("Beta", "b")]),
  };
  return ctx;
};

test("plan's words follow the state: the staged draft when cells are staged, the saved spec otherwise", () => {
  const plan = manifest.actions!.plan;
  expect(plan.saysNow!(withCells(stagedView()) as never)).toMatch(/staged draft/);
  expect(plan.saysNow!(view() as never)).toMatch(/saved families spec/);
  expect(plan.says).toMatch(/staged draft.*saved families spec/);
});

test("plan files nothing in the pod; save draft files one member per family, a copy plan never needs", async () => {
  const ctx = withCells(stagedView());
  client.runSemanticAction.mockResolvedValue({
    state: "succeeded",
    result: {
      id: "plan-x",
      plan: [
        {
          familyId: 1,
          familyName: "Alpha",
          planHash: "p",
          changes: [],
          runEffects: [],
          refusals: [],
          warnings: [],
        },
      ],
    },
  });
  await manifest.actions!.plan.run(ctx as never, undefined as never);
  expect(pods.write).not.toHaveBeenCalled();

  const save = manifest.actions!["save-draft"];
  expect(save.label).toBe("save draft to pod");
  expect(save.says).toMatch(/copy/);
  expect(save.says).toMatch(/plan does not need it/);
  expect(save.ready(ctx as never, undefined as never)).toBeNull();
  expect(save.ready(view() as never, undefined as never)).toBe("nothing is staged to save");
  await save.run(ctx as never, undefined as never);
  expect(pods.write.mock.calls.map(([ref]) => ref)).toEqual([
    { pod: seed.page.pod, path: "staged/Alpha.json" },
    { pod: seed.page.pod, path: "staged/Beta.json" },
  ]);
  expect(JSON.parse(pods.write.mock.calls[0]![1] as string)).toMatchObject({
    $schema: expect.any(String),
  });
});

test("capture resolves the named picks to this reading's ids at the press; a name gone refuses", () => {
  const input = (selection: string[]) =>
    familiesSpec.captureInput!(view({ selection, loaded: { Alpha: 202, Beta: 303 } }) as never);
  expect(input(["Alpha", "Beta"])).toEqual({ familyIds: [202, 303] });
  expect(input(["Alpha", "Gamma"])).toBe("'Gamma' is no longer loaded; pick again");
});
