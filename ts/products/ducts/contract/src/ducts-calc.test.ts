import { expect, it } from "vite-plus/test";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts/subject-ref";

import {
  criteriaMeta,
  ductsCriteriaLayerSchema,
  ductsBaseSchema,
  ductsFirmSchema,
  ductsCalcEditsSchema,
  calcEditsSchema,
  fittingPricingSchema,
} from "@pe/fans-contract/calc-read";

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

it("refuses withdrawn source text on drop, flow and ESP edit values", () => {
  const key = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("fixture:1") });
  const edits = {
    flows: { [key]: { cfm: 100, source: "balancing report" } },
    equipmentFlows: { [key]: { cfm: 200, source: "submittal" } },
    terminalDrops: { [key]: { inWg: 0.1, source: "catalog page" } },
    componentDrops: { [key]: { inWg: 0.2, source: "catalog page" } },
    fittingDrops: { "proposed:pair>straight": { inWg: 0.3, source: "fitting submittal" } },
  };
  for (const [segment, values] of Object.entries(edits))
    expect(calcEditsSchema.safeParse({ [segment]: values }).success).toBe(false);
  expect(calcEditsSchema.safeParse({ esp: { [key]: { inWg: 1, source: "unsupported" } } }).success).toBe(false);
});
const key = "proposed:14106988:1|14122436:1>straight";
const proposed = {
  pair: ["14122436:1", "14106988:1"],
  kind: "transition",
  path: "straight",
  toward: null,
};

it("a proposed fitting is identified by its key and pair, with no element id (fix6 defect 1)", () => {
  // MUAS-1 live, 2026-10-29: the C3 transition carried elementId 0 and the whole fans.calc-detail
  // response failed its output schema at fittings[35].elementId.
  expect(fittingPricingSchema.safeParse({ ...row, key, elementId: null, proposed }).success).toBe(
    true,
  );
  expect(fittingPricingSchema.safeParse({ ...row, key, elementId: 0, proposed }).success).toBe(
    false,
  );
  // A proposed row never borrows a real element's id; a real fitting always has one.
  expect(
    fittingPricingSchema.safeParse({ ...row, key, elementId: 14122436, proposed }).success,
  ).toBe(false);
  expect(
    fittingPricingSchema.safeParse({ ...row, key: "14806947", elementId: 14806947 }).success,
  ).toBe(true);
  expect(fittingPricingSchema.safeParse({ ...row, key: "14806947", elementId: null }).success).toBe(
    false,
  );
});

it("lets a layer or a tier file hold one side of a sided criterion; the engine base states both", () => {
  expect(ductsCriteriaLayerSchema.parse({ velocityLimitFpm: { supply: 850 } })).toEqual({
    velocityLimitFpm: { supply: 850 },
  });
  expect(ductsCalcEditsSchema.parse({ criteria: { velocityLimitFpm: { return: null } } })).toEqual(
    {
      criteria: { velocityLimitFpm: { return: null } },
    },
  );
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
  // Slice 6b: a home tier's file states any subset (the write door saves one value); the base the engine runs on states both sides.
  expect(ductsFirmSchema.safeParse(firm).success).toBe(true);
  expect(ductsBaseSchema.safeParse(firm).success).toBe(false);
});

it("criteriaMeta keeps who staged each criterion, and a cell with no `by` has no entry (P-032)", () => {
  expect(
    criteriaMeta({
      terminalDropInWg: { edit: { by: "pea", ref: "work:duct-systems/criteria/x" } },
      allowanceSupplyInWg: { edit: { by: "human" } },
      allowanceReturnInWg: { edit: {} },
    } as never),
  ).toEqual({
    terminalDropInWg: { by: "pea", ref: "work:duct-systems/criteria/x" },
    allowanceSupplyInWg: { by: "human", ref: "work:duct-systems/criteria/allowanceSupplyInWg" },
  });
});

it("a resolved wire value agrees with its status, as the kernel resolution does (P-024)", async () => {
  const { ductsInputsSchema } = await import("@pe/fans-contract/calc-read");
  const cfm = ductsInputsSchema.shape.terminals.valueType.shape.cfm;
  const base = { units: "cfm", version: null };
  const ok = [
    { ...base, status: "valid", value: 100, source: "model", author: null, ref: "model:7/Flow" },
    { ...base, status: "valid", value: 100, source: "Work", author: "pea", ref: "work:fans/flows/k" },
    { ...base, status: "invalid", value: null, source: "Work", author: null, ref: "work:fans/flows/k" },
    { ...base, status: "missing", value: null, source: "none", author: null, ref: null },
    // A refused model value (a family placeholder) is invalid from the model, citing why.
    { ...base, status: "invalid", value: null, source: "model", author: null, ref: "family placeholder 1 on 2" },
  ];
  const bad = [
    { ...base, status: "valid", value: 100, source: "none", author: null, ref: null },
    { ...base, status: "valid", value: 100, source: "Work", author: null, ref: "work:fans/flows/k" },
    { ...base, status: "valid", value: null, source: "model", author: null, ref: "model:7/Flow" },
    { ...base, status: "invalid", value: 100, source: "model", author: null, ref: "model:7/Flow" },
    { ...base, status: "missing", value: null, source: "firm", author: null, ref: "firm:x" },
    // P-041: the wire is the kernel union, so a missing value carries no ref.
    { ...base, status: "missing", value: null, source: "none", author: null, ref: "family placeholder 1 on 2" },
    { ...base, status: "valid", value: 100, source: "model", author: null, ref: " " },
  ];
  expect(ok.map(v => cfm.safeParse(v).success)).toEqual(ok.map(() => true));
  expect(bad.map(v => cfm.safeParse(v).success)).toEqual(bad.map(() => false));
});
