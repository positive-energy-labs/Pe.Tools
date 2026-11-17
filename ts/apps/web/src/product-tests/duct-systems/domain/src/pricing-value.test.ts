import { expect, it } from "vite-plus/test";
import { designOf } from "@pe/ducts-domain/test-design";
import { connOf, nodeOf, snapshotOf } from "@pe/ducts-domain/test-snapshot";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { networkCalcs } from "@pe/fans-domain/calc/network-calcs";
import { TEST_FIRM } from "@pe/ducts-domain/test-inputs";
import { pricingValue } from "@pe/duct-systems-domain/pricing-value";

it.each(["terminalDrops", "componentDrops"])(
  "P-077 refuses an absent staged %s subject",
  (field) => {
    const subject = elementSubject(nodeOf(99, "terminal"));
    const design = designOf({
      [field]: {
        [subject]: {
          edit: { value: { inWg: 0.2 }, by: "human", ref: "test:drop" },
        },
      },
    });
    expect(() => pricingValue(snapshotOf(), [], design)).toThrow(
      `Work subject is absent from the acquisition: ${subject}`,
    );
  },
);

it("P-077 includes every suggested roster port, including two ports on one ERV", () => {
  const snapshot = snapshotOf({
    nodes: [
      nodeOf(1, "equipment", {
        family: "Broan ERV",
        connectors: [
          connOf(0, null, { direction: "out", classification: "SupplyAir" }),
          connOf(1, null, { direction: "in", classification: "SupplyAir" }),
          connOf(2, null, { direction: "out", classification: "ExhaustAir" }),
          connOf(3, null, { direction: "in", classification: "ExhaustAir" }),
        ],
      }),
    ],
  });
  const design = designOf();
  const calcs = networkCalcs(snapshot, {}, {}, design, TEST_FIRM, 0);
  const value = pricingValue(snapshot, calcs, design);
  expect(value.calcs.map(({ fan }) => [fan.unitId, fan.portIndex])).toEqual([
    [1, 0],
    [1, 2],
  ]);
});
