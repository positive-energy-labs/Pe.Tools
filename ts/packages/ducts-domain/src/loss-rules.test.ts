import { expect, it } from "vite-plus/test";

import { LOSS_RULES, type FittingFacts } from "./loss-rules.ts";
import type { LossResult } from "./losses.ts";
import { catalogFindings } from "./pricing.ts";

const accessory = (family: string | null): FittingFacts => ({
  kind: "accessory",
  family,
  partType: null,
  rOverD: null,
  aoOverA1: null,
  inlet: { shape: "round", section: null },
  outlet: null,
  main: null,
  abOverAc: null,
  takeoff: false,
});
const ruleOf = (family: string | null) =>
  LOSS_RULES.find((rule) => rule.when(accessory(family), { q: 100 }))?.key ?? null;

it("prices only a plain damper family as the fully open damper; every other accessory has no rule", () => {
  expect(ruleOf("Volume Damper - Rectangular")).toBe("damper");
  expect(ruleOf("Mechanical Damper")).toBe("damper");
  expect(ruleOf("Fire Damper")).toBeNull();
  expect(ruleOf("Smoke Damper")).toBeNull();
  expect(ruleOf("Flex Connector")).toBeNull();
  expect(ruleOf(null)).toBeNull();
});

it("gathers the fittings no rule prices into one no-rule finding per family", () => {
  const row = (id: number, family?: string) => ({
    id,
    kind: "fitting" as const,
    dp: 0,
    desc: "no rule",
    error: "no rule",
    finding: "no-rule" as const,
    ...(family ? { family } : {}),
  });
  const result = {
    paths: { 1: { rows: [row(7, "Flex Connector"), row(5, "Flex Connector"), row(9)] } },
  } as unknown as LossResult;
  const found = catalogFindings(result);
  expect(found.map((f) => [f.id, f.kind, f.elementIds])).toEqual([
    ["no-rule:Flex Connector", "no-rule", [5, 7]],
    ["no-rule:#9", "no-rule", [9]],
  ]);
});

it("prices rectangular radius elbows with CR3-1 Cp and its angle factor, and round 1.5D/2D elbows with CD3-12", async () => {
  const { priceLeg } = await import("./kernel/price-leg.ts");
  const { fittingFacts } = await import("./kernel/fitting-facts.ts");
  const { roundSection } = await import("./loss-physics.ts");
  const inlet = { index: 0, shape: "rectangular", widthIn: 10, heightIn: 10 };
  const outlet = { ...inlet, index: 1 };
  const node = {
    id: 1,
    kind: "fitting",
    family: "Rectangular Elbow - Radius",
    partType: "Elbow",
    connectors: [inlet, outlet],
    facts: [
      { key: "centerRadius", value: 10 },
      { key: "angle", value: 45 },
    ],
  } as unknown as import("./types.ts").DuctSnapshot["nodes"][number];
  const facts = fittingFacts({
    fitting: node,
    inlet: node.connectors[0],
    outlet: node.connectors[1],
  });
  const rect = priceLeg(
    { kind: "fitting", fitting: node, facts, flows: { through: 300 }, leg: "C" },
    {
      "CR3-1": {
        Cp: {
          title: "CR3-1 smooth radius without vanes",
          xLabel: "H/W",
          x: [1],
          yLabel: "r/W",
          y: [1],
          grid: [[0.21]],
        },
      },
    },
  );
  expect(rect.unpriced).toBeNull();
  expect(rect.source).toMatchObject({
    kind: "rule",
    table: "CR3-1",
    coefficient: expect.closeTo(0.21 * 0.6, 10),
  });
  expect(rect.lossInWg).toBeGreaterThan(0);
  for (const rOverD of [1.5, 2]) {
    const roundFacts = {
      ...facts,
      family: "Round Elbow",
      angleDeg: 90,
      rOverD,
      inlet: { shape: "round", section: roundSection(12) },
      outlet: { shape: "round", section: roundSection(12) },
    };
    const priced = priceLeg(
      { kind: "fitting", fitting: node, facts: roundFacts, flows: { through: 300 }, leg: "C" },
      {
        "CD3-12": {
          Co: {
            title: "CD3-12 3 gore",
            xLabel: "r/D",
            x: [0.75, 1, 1.5, 2],
            grid: [0.54, 0.42, 0.34, 0.33],
          },
        },
      },
    );
    expect(priced.source).toMatchObject({
      table: "CD3-12",
      coefficient: rOverD === 1.5 ? 0.34 : 0.33,
    });
    expect(priced.unpriced).toBeNull();
  }
});

it("maps a plain round tee to SD5-9 with distinct branch and straight Pv; branch entry stays unpriced", async () => {
  const { fittingFacts } = await import("./kernel/fitting-facts.ts");
  const { priceLeg } = await import("./kernel/price-leg.ts");
  const { friction, roundSection } = await import("./loss-physics.ts");
  const ports = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ].map((facing, index) => ({ index, facing, shape: "round", diameterIn: 8 }));
  const node = {
    id: 2,
    kind: "fitting",
    family: "Round Tee",
    partType: "Tee",
    connectors: ports,
    facts: [],
  } as unknown as import("./types.ts").DuctSnapshot["nodes"][number];
  for (const [out, res, cfm, coefficient] of [
    [1, "Cs", 200, 0.13],
    [2, "Cb", 100, 0.65],
  ] as const) {
    const facts = fittingFacts({
      fitting: node,
      inlet: node.connectors[0],
      outlet: node.connectors[out],
    });
    const rule = LOSS_RULES.find((r) => r.when(facts, { q: cfm, qb: 100, qc: 300, qs: 200 }))!;
    expect(rule.table).toBe("SD5-9");
    expect(rule.input(facts, { q: cfm, qb: 100, qc: 300, qs: 200 }, "SD5-9", "C")).toMatchObject({
      res,
      x: cfm / 300,
      y: 1,
    });
    const grid = {
      title: "SD5-9",
      xLabel: "flow ratio",
      x: [cfm / 300],
      yLabel: "area ratio",
      y: [1],
      grid: [[coefficient]],
    };
    const priced = priceLeg(
      {
        kind: "fitting",
        fitting: node,
        facts,
        flows: { through: cfm, branch: 100, upstreamMain: 300, downstreamMain: 200 },
        leg: "C",
      },
      { "SD5-9": { [res]: grid } },
    );
    expect(priced.lossInWg).toBeCloseTo(coefficient * friction(roundSection(8), cfm, 0).pv, 10);
  }
  const branchEntry = fittingFacts({
    fitting: node,
    inlet: node.connectors[2],
    outlet: node.connectors[0],
  });
  expect(branchEntry.junction).toBeUndefined();
  expect(LOSS_RULES.some((r) => r.when(branchEntry, { q: 100, qc: 300 }))).toBe(false);
});

it("small 1.5D round elbows use retained CD3-1 at 90 degrees and CD3-3 at 45 degrees", () => {
  const facts: FittingFacts = {
    ...accessory("Round Elbow"),
    kind: "fitting",
    partType: "Elbow",
    rOverD: 1.5,
    inlet: { shape: "round", section: { areaFt2: Math.PI / 4, dhIn: 8 } },
  };
  for (const [angleDeg, table] of [
    [90, "CD3-1"],
    [45, "CD3-3"],
  ] as const) {
    const input = { ...facts, angleDeg };
    const rule = LOSS_RULES.find((r) => r.when(input, { q: 100 }))!;
    expect(rule.table).toBe(table);
    expect(rule.input(input, { q: 100 }, table, "C")).toEqual({ res: "Co", x: 8 });
  }
});
