import { expect, test } from "vite-plus/test";
import { setup } from "./schedule-recorded-fixture.ts";

test("cold Schedules HTTP publication settles, and a catalogue that changes mid-read settles on the change", async () => {
  const f = await setup();
  const request = { read: "schedules.view", subscription: "cold-schedules", generation: 1, args: { target: f.b, workspaceId: null } };
  const cold = await f.post("/pe/reads/value", request);
  expect(cold.status).toBe(200);
  expect(cold.value.state, JSON.stringify(cold.value)).toBe("current");
  expect(cold.value.value.data.catalog.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Reviewed Apply Proof" })]));
  let calls = 0;
  f.onCatalog(() => { if (++calls === 2) f.select("fresh-schedule-13-revit.catalog.schedules"); });
  const changed = await f.post("/pe/reads/value", { ...request, subscription: "changed-schedules" });
  // A first publication that raced is re-evaluated on the host (`Publications.publish`), never refused raw.
  expect(changed.value.state, JSON.stringify(changed.value).slice(0, 300)).toBe("current");
  expect(calls, "the raced evaluation and its re-evaluation both read the catalogue").toBeGreaterThan(2);
  expect(changed.value.value.data.catalog.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Recorded catalogue addition" })]));
  f.onCatalog(() => {});
  const settled = await f.post("/pe/reads/value", { ...request, generation: 2 });
  expect(settled.value.state).toBe("current");
  expect(settled.value.value.data.catalog.schedules).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Recorded catalogue addition" })]));
});
