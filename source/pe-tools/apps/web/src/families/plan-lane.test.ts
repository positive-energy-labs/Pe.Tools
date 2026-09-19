import { expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({
  runSemanticAction: vi.fn(async (..._args: unknown[]) => ({
    state: "succeeded",
    result: {} as Record<string, unknown>,
  })),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => client);

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
  work: { key: { route: "families", target: null }, doc: seed.work, revision: 4 },
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
  expect(ctx.setPage).toHaveBeenCalledWith({
    stage: "apply",
    confirming: true,
    sheet: { entries: [expect.objectContaining({ id: "3101", planHash: "p" })] },
  });
});

test("held-back rows are the Work's exclusions, by name, as this sheet's row ids", () => {
  expect(familiesSpec.plan!.excluded!(view({ sheet: seed.page.sheet }) as never)).toEqual(["3102"]);
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
