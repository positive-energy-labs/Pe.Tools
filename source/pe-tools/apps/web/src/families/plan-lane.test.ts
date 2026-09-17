import { expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({
  runSemanticAction: vi.fn(async () => ({ state: "succeeded", result: {} })),
  readFamilyCapture: vi.fn(async () => ({})),
  actionResult: (row: unknown) => row,
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => client);

import { FAMILIES_SEEDS } from "./seeds";
import { familiesSheetOf, familiesSpec, manifest } from "./manifest";

const seed = FAMILIES_SEEDS.apply as unknown as {
  work: { spec: { pod: string; path: string }; excludedIds: number[] };
  readings: { families: unknown; pods: unknown };
  page: { pod: string; path: string };
};
const ref = { session: "s", openId: "o" };
const page = {
  stage: "apply",
  pod: seed.page.pod,
  path: seed.page.path,
  selection: [],
  confirming: true,
  sheet: null,
  draft: { placement: "AllLoaded", categories: [], families: [] },
};
const view = (over: Partial<typeof page> = {}, doc: unknown = seed.work) => ({
  target: { kind: "document", ref },
  work: { key: { route: "families", target: null }, doc, revision: 4 },
  readings: {
    families: { state: "ready", observation: seed.readings.families },
    pods: { state: "ready", observation: seed.readings.pods },
  },
  page: { ...page, ...over },
  write: vi.fn(async () => null),
  setPage: vi.fn(),
});

test("the sheet is the plan for the page's spec, and nothing for another spec", () => {
  const sheet = familiesSheetOf(view() as never);
  expect(sheet?.entries.map((entry) => [entry.id, entry.flag])).toEqual([
    ["3101", null],
    ["3102", null],
    ["3103", expect.stringContaining("no mapping source")],
  ]);
  expect(familiesSheetOf(view({ path: "settings/families/other.json" }) as never)).toBeNull();
});

test("plan makes the page's spec the Work's spec before the host reads the plan", async () => {
  const ctx = view({ path: "settings/families/other.json" });
  await familiesSpec.plan!.read(ctx as never, {
    pod: page.pod,
    path: "settings/families/other.json",
    sha256: "a".repeat(64),
  });
  expect(ctx.write).toHaveBeenCalledWith([
    { path: ["spec"], value: { pod: page.pod, path: "settings/families/other.json" } },
    { path: ["excludedIds"], value: [] },
  ]);
  expect(client.readFamilyCapture).toHaveBeenCalledWith("families.plan", {}, ctx.work.key, ref);
});

test("confirm applies the plan id with exactly the included hashes, against the reviewed revision", async () => {
  const ctx = view();
  expect(manifest.actions!.confirm.ready(ctx as never, undefined as never)).toBeNull();
  await manifest.actions!.confirm.run(ctx as never, undefined as never);
  expect(client.runSemanticAction).toHaveBeenCalledWith(
    "families.apply",
    { planId: "9".repeat(64), expectedPlanHashes: { "3101": "plan-3101" } },
    ref,
    { work: { key: ctx.work.key, revision: 4 } },
  );
});
