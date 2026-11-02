import { expect, test } from "vite-plus/test";
import { withComputed, type FanPort } from "./model";

const fan = (unitId: number, extra: Partial<FanPort> = {}) =>
  ({ unitId, portIndex: 2, uniqueId: `u${unitId}`, mark: `M${unitId}`, kind: "muas", ...extra }) as FanPort;

test("a fan the ledger computed never reads 'not computed' on the roster", () => {
  const roster = [fan(1), fan(2)];
  const sheet = [fan(1, { complete: false, blockerCount: 2, requiredEspInWg: null }), fan(2)];
  const rows = withComputed(roster, sheet);
  expect(rows[0]).toMatchObject({ complete: false, blockerCount: 2 });
  expect(rows[1]!.complete).toBeUndefined();
});
