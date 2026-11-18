import { afterEach, expect, test } from "vite-plus/test";
import { nativeFixture } from "./fans-work-fixture.ts";
import { closedFan, recordedTables } from "./closed-fan.fixture.ts";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

/*
 * Ruling D9 (2026-11-18; field map invariant 8), through the real fans `sheet.plan` and `sheet.apply`: a
 * /fans apply writes a scoped rule's fitting coefficient to its element, and persists and retires no
 * /duct-systems ruling. Each of `actions.ts`, `action-runtime.ts` and `staged.ts` at 272c0120 fails it alone.
 */
const RULE = "elbow-1d-gt10", VERDICT = "open-end:101:1";

test("a /fans apply writes a scoped rule's fitting coefficient and leaves the /duct-systems rule and verdict staged", async () => {
  const f = await nativeFixture("real", (_key, input) => closedFan(100, { requiredEsp: input.slots?.requiredEsp }), null,
    { native: (key) => (key === "ducts.tables" ? recordedTables() : undefined) });
  closes.push(() => f.close());
  const key = { ...f.key, route: "fans" };
  const staged = await f.saved.apply(key, "fans", "human", [{ path: ["writeIntent", "edit"], value: { value: { walk: { unitId: 100, portIndex: 0 } } } }], 0);
  const table = "CD3-21";
  const ducts = await f.saved.apply(f.key, "duct-systems", "human", [
    { path: ["writeIntent", "edit"], value: { value: { cells: [["rules", RULE]] } } },
    { path: ["rules", RULE, "edit"], value: { value: { table } } },
    { path: ["assumptions", VERDICT, "edit"], value: { value: { kind: "verdict", verdict: "ignore" } } },
  ], 0);
  expect([staged, ducts]).toMatchObject([{ ok: true }, { ok: true }]);
  const work = { key, revision: staged.ok ? staged.revision : -1 };
  for (const [id, command] of [["v6-plan", "sheet.plan"], ["v6-apply", "sheet.apply"]] as const) {
    const response = await f.post("/actions", { id, key: command, target: f.target, input: { work } });
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    expect(await f.journal.wait(id), id).toMatchObject({ state: "succeeded" });
  }
  const sent = f.dispatched.filter((row) => row.key === "ducts.apply").map((row) => row.input as {
    fittings: { id: number; coefficient: number; ruleKey?: string }[]; store: { rules: object; verdicts?: object }; storeDeletes: object });
  expect(sent).toHaveLength(1);
  // The element write: the elbow's coefficient. No rule key rides it, so the native store composes no rule from it.
  expect(sent[0]!.fittings).toEqual([expect.objectContaining({ id: 2, coefficient: expect.any(Number) })]);
  expect(sent[0]!.fittings[0]).not.toHaveProperty("ruleKey");
  expect(sent[0]!.store.rules ?? {}).toEqual({});
  expect(sent[0]!.store.verdicts ?? {}).toEqual({});
  expect(sent[0]!.storeDeletes).toEqual({ roles: [] });
  // Both /duct-systems cells are still staged, and the Work was not touched by the apply.
  const after = (await f.saved.view(f.key, "duct-systems"))!;
  expect(after.revision).toBe(ducts.ok ? ducts.revision : -1);
  expect(after.doc).toMatchObject({ rules: { [RULE]: { edit: { value: { table } } } }, assumptions: { [VERDICT]: { edit: { value: { verdict: "ignore" } } } } });
});
