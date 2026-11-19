import { afterEach, expect, test } from "vite-plus/test";
import { nativeFixture } from "./fans-work-fixture.ts";
import { closedFan, recordedTables } from "../../../../products/fans/host/src/tests/closed-fan.fixture.ts";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

/*
 * P-069, P-060: a type-owned required ESP is one value for every unit of the type. The host plan reads
 * each cohort peer's own walk and builds its claim, and the mint writes only when all are complete and
 * equal. Emptying the host's peer loop turns the first case into the mint's "missing" refusal.
 */
async function plan(peerSupplyFt: number) {
  const walks: number[] = [];
  const f = await nativeFixture("real", (_key, input) => {
    const unit = input.selector?.unitId ?? 100;
    walks.push(unit);
    // The cohort names the slot this read resolved, as the native read does.
    return closedFan(unit, { cohort: [100, 200], requiredEsp: input.slots?.requiredEsp, supplyFt: unit === 200 ? peerSupplyFt : 10 });
  }, null, { native: (key) => (key === "ducts.tables" ? recordedTables() : undefined) });
  closes.push(() => f.close());
  const key = { ...f.key, route: "fans" };
  const staged = await f.saved.apply(key, "fans", "human", [{ path: ["writeIntent", "edit"], value: { value: { walk: { unitId: 100, portIndex: 0 } } } }], 0);
  expect(staged).toMatchObject({ ok: true });
  const response = await f.post("/actions", { id: "peer-plan", key: "sheet.plan", target: f.target, input: { work: { key, revision: staged.ok ? staged.revision : -1 } } });
  expect(response.status, await response.clone().text()).toBeLessThan(400);
  return { receipt: await f.journal.wait("peer-plan"), walks };
}

test("a type cohort whose peers are complete and equal plans the claimed ESP on both units", async () => {
  const { receipt, walks } = await plan(10);
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded" });
  const { derivedRequest, claim } = (receipt as unknown as { result: { derivedRequest: { equipment: { id: number; externalStaticInWg: number }[] }; claim: { requiredEspInWg: number } } }).result;
  expect(claim.requiredEspInWg).toBeGreaterThan(0);
  expect(derivedRequest.equipment).toEqual([100, 200].map((id) => ({ id, externalStaticInWg: claim.requiredEspInWg })));
  // The peer's claim came from its own walk, read in this plan.
  expect(walks).toContain(200);
});

test("a type cohort whose peers claim different ESP is refused, naming both", async () => {
  const { receipt } = await plan(60);
  expect(receipt).not.toMatchObject({ state: "succeeded" });
  expect(JSON.stringify(receipt)).toMatch(/Required ESP type cohort cannot share one claimed value: .*100.*200/);
});
