import { expect, it } from "vite-plus/test";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { inputsFor } from "@pe/ducts-domain/test-inputs";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { ductsFanCalcSchema } from "@pe/fans-contract/fan-calc-data";
import { buildCalc } from "./build.ts";
import fc4 from "./fixtures/chadds-fc4-extension.json" with { type: "json" };

it("publishes the friction evidence from FC-4's proposed return extension", () => {
  // Five elements and the open-end measurement from chadds-snapshot-health.json.
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(fc4);
  const { fans, suggestions } = suggestRoster(snapshot);
  const roster = [...fans, ...suggestions];
  const fan = { unitId: 6034271, portIndex: 1 };
  const calc = ductsFanCalcSchema.parse(
    buildCalc({
      snapshot,
      grids: {},
      inputs: inputsFor(snapshot, { slot: "revit:Flow" }),
      roster,
      fan,
    }),
  );
  const extension = calc.assumed.legs["heal:6034271:3|6404729:4:extension"];
  expect(extension?.evidence).toMatchObject({
    kind: "friction",
    lengthFt: expect.closeTo(0.32947857, 7),
    hydraulicDiameterFt: expect.closeTo((2 * 17.5 * 21) / (17.5 + 21) / 12, 7),
  });
});
