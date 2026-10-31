/**
 * `applyRequest` from a flat list of priced legs and one fan port: rule legs become pe-server
 * fitting writes once per element (a tap's two legs collapse to one), unpriced and inferred
 * (negative id) legs are left out, ESP is written only when the total is complete, and the store
 * is carried forward with this apply over it.
 */
import { expect, it } from "vite-plus/test";

import { applyRequest } from "./apply-request.ts";
import type { PricedLeg } from "./price-leg.ts";

const rule = (
  elementId: number,
  coefficient: number,
  extra: Partial<PricedLeg> = {},
): PricedLeg => ({
  kind: "fitting",
  elementId,
  lossInWg: 0.01,
  velocityFpm: 600,
  unpriced: null,
  source: {
    kind: "rule",
    rule: "tap-std",
    table: "SD5-9",
    coefficient,
    pv: 0.02,
    inputs: { res: "Cb", x: 0.33333, y: 0.5625, xLabel: "Qb/Qc", yLabel: "Ab/Ac" },
    notes: [],
  },
  ...extra,
});
const legs: PricedLeg[] = [
  {
    kind: "duct",
    elementId: 1,
    lossInWg: 0.015,
    velocityFpm: 859,
    unpriced: null,
    lengthFt: 10,
    source: { kind: "friction", f: 0.02, roughnessFt: 0.0003, rateInWgPer100Ft: 0.15 },
  },
  rule(4, 3.15333),
  rule(4, 0.13667, {
    source: {
      kind: "rule",
      rule: "tap-std",
      table: "SD5-9",
      coefficient: 0.13667,
      pv: 0.01,
      inputs: { res: "Cs", x: 0.6667, y: 1, xLabel: "Qs/Qc", yLabel: "As/Ac" },
      notes: [],
    },
  }),
  rule(-1, 1.2),
  rule(5, 0.3, { unpriced: "SR4-3 Co is not loaded", lossInWg: null }),
  {
    kind: "drop",
    elementId: 6,
    lossInWg: 0.05,
    velocityFpm: null,
    unpriced: null,
    source: { kind: "drop", source: "parameter" },
  },
];
const base = {
  fan: { unitId: 100, port: 0 },
  legs,
  terminalFlows: [
    { id: 8, cfm: 100, source: "slot:PE_Airflow" },
    { id: 6, cfm: 200, source: "override" },
  ],
  drops: [
    { id: 8, inWg: 0.08, source: "typed", kind: "terminal" as const },
    { id: 6, inWg: 0.05, source: "parameter", kind: "terminal" as const },
    { id: 12, inWg: 0.2, source: "firm default v1", kind: "component" as const },
  ],
  choices: { "tap-std": "sd5-9" },
  slots: { fanStatic: "PE_ESP" },
  store: {
    version: 2,
    rules: {},
    instances: { "77": { coefficient: 0.5, appliedAt: "earlier" } },
    terminals: {},
    terminalFlows: {},
    equipmentFlows: {},
    verdicts: { x: { verdict: "ignore", ruledAt: "earlier" } },
    roles: {},
    workRevision: 3,
    extra: "kept",
  },
  appliedAt: "2026-10-27T00:00:00Z",
};

it("writes each rule-priced fitting once, in id order, and carries the store forward", () => {
  const req = applyRequest({ ...base, requiredEspInWg: 0.1674, designFlowCfm: 300 });
  expect(req.fittings).toEqual([
    {
      id: 4,
      method: "pe-server",
      coefficient: 3.15333,
      table: "SD5-9",
      inputs: "Qb/Qc=0.3333, Ab/Ac=0.5625",
      ruleKey: "tap-std",
    },
  ]);
  expect(req.terminals.map((t) => t.id)).toEqual([6, 8]);
  expect(req.components).toEqual([{ id: 12, inWg: 0.2, source: "firm default v1" }]);
  expect(req.terminalFlows.map((t) => t.id)).toEqual([6, 8]);
  expect(req.equipment).toEqual([{ id: 100, externalStaticInWg: 0.1674 }]);
  expect(req.equipmentFlows).toEqual([
    { id: 100, cfm: 300, source: "sheet: sum of reached terminals" },
  ]);
  expect(req.store).toMatchObject({
    version: 2,
    rules: { "tap-std": { table: "SD5-9" } },
    instances: {
      "77": { coefficient: 0.5 },
      "4": { coefficient: 3.15333, table: "SD5-9", appliedAt: base.appliedAt },
    },
    terminals: { "8": { inWg: 0.08, source: "typed" } },
    terminalFlows: { "8": { cfm: 100, source: "slot:PE_Airflow" } },
    equipmentFlows: { "100": { cfm: 300 } },
    verdicts: { x: { verdict: "ignore" } },
    slots: { fanStatic: "PE_ESP" },
    workRevision: 3,
    extra: "kept",
    appliedAt: base.appliedAt,
  });
});

it("an incomplete total writes no ESP and no design flow", () => {
  const req = applyRequest({ ...base, requiredEspInWg: null, designFlowCfm: null });
  expect(req.equipment).toEqual([]);
  expect(req.equipmentFlows).toEqual([]);
  expect(req.fittings).toHaveLength(1);
});
