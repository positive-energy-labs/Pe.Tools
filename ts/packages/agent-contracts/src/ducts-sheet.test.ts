import { expect, it } from "vite-plus/test";

import {
  ductsCriteriaLayerSchema,
  ductsFirmSchema,
  ductsSheetEditsSchema,
  fittingPricingSchema,
} from "./ducts-sheet.ts";

const row = {
  family: "proposed transition",
  rule: "trx-inlet",
  table: "SD4-2",
  ruleSource: "matched",
  tableSource: "default",
  options: ["SD4-2"],
  candidates: [],
  lossInWg: 0.00175,
  unpriced: null,
  typed: null,
};
const key = "proposed:14106988:1|14122436:1>straight";
const proposed = {
  pair: ["14122436:1", "14106988:1"],
  kind: "transition",
  path: "straight",
  toward: null,
};

it("a proposed fitting is identified by its key and pair, with no element id (fix6 defect 1)", () => {
  // MUAS-1 live, 2026-10-29: the C3 transition carried elementId 0 and the whole ducts.sheet
  // response failed its output schema at fittings[35].elementId.
  expect(fittingPricingSchema.safeParse({ ...row, key, elementId: null, proposed }).success).toBe(true);
  expect(fittingPricingSchema.safeParse({ ...row, key, elementId: 0, proposed }).success).toBe(false);
  // A proposed row never borrows a real element's id; a real fitting always has one.
  expect(fittingPricingSchema.safeParse({ ...row, key, elementId: 14122436, proposed }).success).toBe(false);
  expect(
    fittingPricingSchema.safeParse({ ...row, key: "14806947", elementId: 14806947 }).success,
  ).toBe(true);
  expect(fittingPricingSchema.safeParse({ ...row, key: "14806947", elementId: null }).success).toBe(false);
});

it("lets the project layer hold one side of a sided criterion; the firm file states both", () => {
  expect(ductsCriteriaLayerSchema.parse({ velocityLimitFpm: { supply: 850 } })).toEqual({
    velocityLimitFpm: { supply: 850 },
  });
  expect(ductsSheetEditsSchema.parse({ criteria: { velocityLimitFpm: { return: null } } })).toEqual({
    criteria: { velocityLimitFpm: { return: null } },
  });
  const firm = {
    version: "f",
    criteria: {
      velocityLimitFpm: { supply: 900 },
      terminalDropInWg: 0.03,
      autoJoinGapIn: 3,
      healBoxIn: 36,
      splitPolicy: "even",
      allowanceInWg: { supply: 0, return: 0 },
    },
  };
  expect(ductsFirmSchema.safeParse(firm).success).toBe(false);
});
