import { expect, it } from "vite-plus/test";
import { ductsPricingData } from "@pe/duct-systems-contract/ducts-read";
import { buildCalc } from "./index.ts";
import { inputsFor } from "@pe/ducts-domain/test-inputs";
import { connOf, nodeOf, snapshotOf } from "@pe/ducts-domain/test-snapshot";
import { rowOf, runsOf } from "@pe/ducts-domain/calc-runs";

const snapshot = snapshotOf({
  nodes: [
    nodeOf(1, "equipment", {
      connectors: [connOf(0, null, { direction: "out", classification: "SupplyAir" })],
    }),
  ],
});
const base = buildCalc({
  snapshot,
  fan: { unitId: 1, portIndex: 0 },
  roster: [],
  grids: {},
  inputs: inputsFor(snapshot),
});
const schema = ductsPricingData.shape.calcs.element;
const leg = schema.shape.legs.valueType.parse({
  id: "shared",
  elementId: 2,
  kind: "fitting",
  flowCfm: null,
  flowSource: null,
  velocityFpm: null,
  lossInWg: null,
  lossSource: { kind: "rule", ref: "shared" },
  equivalentFt: null,
  evidence: { kind: "unpriced", issueId: "missing:2" },
});
const fitting = (name: string, unpriced: string | null = name) =>
  schema.shape.fittings.element.parse({
    key: "2",
    elementId: 2,
    family: `family-${name}`,
    rule: `rule-${name}`,
    table: null,
    ruleSource: "assigned",
    tableSource: null,
    options: [],
    candidates: [],
    lossInWg: null,
    unpriced,
    typed: null,
  });
const blocker = schema.shape.blockers.element.parse({
  id: "not-priced:2",
  kind: "not-priced",
  elementId: 2,
  detail: "blocker detail",
  effectInWg: null,
  closer: { kind: "default", note: "price it" },
});
const calc = (name: string, unitId = 1) =>
  schema.parse({
    ...base,
    fan: { ...base.fan, unitId },
    legs: { priced: { ...leg, id: "priced", elementId: 5, lossInWg: 0.25 }, shared: leg },
    fittings: [fitting(name)],
    blockers: [blocker],
    paths: [
      {
        side: "supply",
        legIds: ["priced", leg.id],
        end: { kind: "terminal", elementId: 3 },
        knownInWg: 0.25,
        blockerIds: [],
      },
    ],
  });

it("P-075 preserves the unpriced reason in fitting, blocker, fallback order", () => {
  const own = calc("fitting reason");
  expect(rowOf(leg, own).error).toBe("fitting reason");
  own.fittings = [fitting("none", null)];
  expect(rowOf(leg, own).error).toBe("blocker detail");
  own.blockers = [];
  expect(rowOf(leg, own).error).toBe("No priced leg on this fan's calc");
  expect(rowOf({ ...leg, lossInWg: 0.1 }, own)).not.toHaveProperty("error");
});

it("P-076 shared elements keep each calc's own fitting and blocker metadata", () => {
  const first = calc("first");
  const second = calc("second", 4);
  second.fittings = [fitting("second", null)];
  second.blockers = [{ ...blocker, detail: "second blocker" }];
  expect(runsOf([first, second]).map((run) => run.rows.at(-1))).toMatchObject([
    { id: 2, rule: "rule-first", family: "family-first", error: "first" },
    { id: 2, rule: "rule-second", family: "family-second", error: "second blocker" },
  ]);
});

it("P-077 keeps a known subtotal separate from an incomplete total", () => {
  const unpriced = calc("unpriced");
  const blocked = calc("blocked");
  blocked.legs.shared = { ...leg, lossInWg: 0 };
  blocked.paths[0]!.blockerIds = [blocker.id];
  const complete = calc("complete");
  complete.legs.shared = { ...leg, lossInWg: 0 };
  complete.blockers = [];
  expect(
    runsOf([unpriced, blocked, complete]).map(({ total, knownInWg }) => ({ total, knownInWg })),
  ).toEqual([
    { total: null, knownInWg: 0.25 },
    { total: null, knownInWg: 0.25 },
    { total: 0.25, knownInWg: 0.25 },
  ]);
});
