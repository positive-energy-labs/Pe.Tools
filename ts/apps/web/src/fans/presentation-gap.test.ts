
import { expect, test } from "vite-plus/test";

import { presentFan } from "../ducts/reviews";
import { snapshot } from "../ducts/test-fixture";




test("assign-fan review also needs its declared snapshot to name the system and fan", () => {
  const response = { unitId: 100, systemId: snapshot.systems[0]!.id, outcome: "planned" };
  const bare = presentFan(response, { readings: {} });
  const named = presentFan(response, {
    readings: { ducts: { value: snapshot } },
  });
  expect(bare.rows[0]).not.toContain("FC-1");
  expect(named.rows[0]).toContain("FC-1");
});
