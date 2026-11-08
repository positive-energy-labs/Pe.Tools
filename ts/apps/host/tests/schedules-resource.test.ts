import { expect, test } from "vite-plus/test";
import { setup } from "./schedule-test-fixture.ts";

test("cold Schedules HTTP publication settles, and a changed catalogue still refuses", async () => {
  const f = await setup();
  const request = { read: "schedules.view", subscription: "cold-schedules", generation: 1, args: { target: f.b, workspaceId: null } };
  const cold = await f.post("/pe/reads/value", request);
  expect(cold.status).toBe(200);
  expect(cold.value.state, JSON.stringify(cold.value)).toBe("current");
  expect(cold.value.value.data.catalog.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Reviewed Apply Proof" })]));
  let calls = 0;
  f.onCatalog(() => { if (++calls === 2) f.select("fresh-schedule-13-revit.catalog.schedules"); });
  const changed = await f.post("/pe/reads/value", { ...request, subscription: "changed-schedules" });
  expect(changed.value).toMatchObject({ state: "refresh-needed", value: null });
  expect(changed.value.reason).toMatch(/schedule-reading.*catalog.*changed during evaluation/);
  f.onCatalog(() => {});
  const settled = await f.post("/pe/reads/value", { ...request, generation: 2 });
  expect(settled.value.state).toBe("current");
  expect(settled.value.value.data.catalog.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Recorded catalogue addition" })]));
});
