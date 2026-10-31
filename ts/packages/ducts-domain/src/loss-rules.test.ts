import { expect, it } from "vite-plus/test";

import convergingTables from "./fixtures/converging-tables.json" with { type: "json" };
import { lookupGrid, toGrids } from "./loss-grid.ts";
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

// Revit's converging tables as the live `ducts.tables` op served them (2026-10-28, probe-sheet).
const CONVERGING = toGrids({ tables: convergingTables });
type Snap = import("./types.ts").DuctSnapshot;
const rectPort = (index: number, widthIn: number, heightIn: number) => ({
  index,
  shape: "rectangular",
  widthIn,
  heightIn,
});
/** A takeoff collar of `w` x `h` on the 32x11 return trunk (mainArea 2.4444 ft2 read at the tap). */
const rectTap = (w: number, h: number) =>
  ({
    id: 13971115,
    kind: "fitting",
    family: "Rectangular Takeoff",
    partType: "TapAdjustable",
    connectors: [rectPort(0, w, h), rectPort(1, w, h)],
    facts: [
      { key: "takeoff", value: 1 },
      { key: "mainArea", value: (32 * 11) / 144 },
      { key: "abOverAc", value: (w * h) / (32 * 11) },
    ],
  }) as unknown as Snap["nodes"][number];
const trunk = {
  id: 13770924,
  shape: "rectangular",
  widthIn: 32,
  heightIn: 11,
} as unknown as Snap["segments"][number];
const tapFacts = async (
  tap: Snap["nodes"][number],
  main: Snap["segments"][number],
  extra: { converging?: boolean; bullhead?: boolean } = { converging: true },
) =>
  (await import("./kernel/fitting-facts.ts")).fittingFacts({
    fitting: tap,
    inlet: tap.connectors[0],
    outlet: undefined,
    main,
    ...extra,
  });

it("a rectangular takeoff where air joins prices on ER5-1 at its real Ab/Ac, Cb on the branch Pv, Cs on the main's", async () => {
  const { priceLeg } = await import("./kernel/price-leg.ts");
  const { friction, sectionOf } = await import("./loss-physics.ts");
  // Chadds' return takeoff 13971115: 12x8 on the 32x11 trunk 13770924, 400 of 1000 cfm.
  const tap = rectTap(12, 8);
  const facts = await tapFacts(tap, trunk);
  const flows = { through: 400, branch: 400, upstreamMain: 1000, downstreamMain: 600 };
  const ruled = (f: FittingFacts) =>
    LOSS_RULES.find((r) => r.when(f, { q: 400, qb: 400, qc: 1000, qs: 600 }))!.key;
  expect(ruled(facts)).toBe("tap-converging-rect");
  expect(ruled(await tapFacts(tap, trunk, {}))).toBe("tap-std");

  const abAc = (12 * 8) / (32 * 11);
  const cb = priceLeg({ kind: "fitting", fitting: tap, facts, flows, leg: "Cb" }, CONVERGING);
  // As/Ac 1 (As = Ac), Ab/Ac 0.273 between the 0.25 (0.47) and 0.5 (0.39) rows at Qb/Qc 0.4.
  const table = lookupGrid(CONVERGING["ER5-1"]!.Cb!, 0.4, abAc, 1).value;
  expect(table).toBeCloseTo(0.47 + ((abAc - 0.25) / 0.25) * (0.39 - 0.47), 12);
  expect(cb.unpriced).toBeNull();
  expect(cb.source).toMatchObject({
    rule: "tap-converging-rect",
    table: "ER5-1",
    coefficient: table,
    inputs: { res: "Cb", x: 0.4, y: abAc, z: 1, xLabel: "Qb/Qc", yLabel: "Ab/Ac", zLabel: "As/Ac" },
    notes: ["ER5-1 is a smooth-radius wye; this takeoff is read on it with As = Ac"],
  });
  expect(cb.lossInWg).toBeCloseTo(
    table * friction(sectionOf("rectangular", null, 12, 8)!, 400, 0).pv,
    12,
  );

  const cs = priceLeg({ kind: "fitting", fitting: tap, facts, flows, leg: "Cs" }, CONVERGING);
  const csTable = lookupGrid(CONVERGING["ER5-1"]!.Cs!, 0.6, abAc, 1).value;
  expect(cs.source).toMatchObject({ table: "ER5-1", coefficient: csTable });
  expect(cs.lossInWg).toBeCloseTo(
    csTable * friction({ areaFt2: (32 * 11) / 144, dhIn: 1 }, 600, 0).pv,
    12,
  );
});

it("a small collar off ER5-1's Ab/Ac axis is read at the table's edge on the velocity of the table's geometry, not blown up", async () => {
  const { priceLeg } = await import("./kernel/price-leg.ts");
  const { friction, sectionOf } = await import("./loss-physics.ts");
  // Chadds 13890167's case: a 4x4 collar (Ab/Ac 0.045) drawing 16 of 1600 cfm. ER5-1 stops at
  // Ab/Ac 0.25 (Cb -444 at Qb/Qc 0.01). On the 4x4's own Pv that is -0.57 in-wg, implausible; at
  // the table's Ab/Ac 0.25 the branch runs at (0.01 / 0.25) of the common velocity.
  const tap = rectTap(4, 4);
  const p = priceLeg(
    {
      kind: "fitting",
      fitting: tap,
      facts: await tapFacts(tap, trunk),
      flows: { through: 16, branch: 16, upstreamMain: 1600, downstreamMain: 1584 },
      leg: "Cb",
    },
    CONVERGING,
  );
  const common = friction({ areaFt2: (32 * 11) / 144, dhIn: 1 }, 1600, 0).pv;
  expect(-444 * friction(sectionOf("rectangular", null, 4, 4)!, 16, 0).pv).toBeLessThan(-0.5);
  expect(p.unpriced).toBeNull();
  expect(p.lossInWg).toBeCloseTo(-444 * common * (0.01 / 0.25) ** 2, 12);
  expect(p.source?.kind === "rule" && p.source.notes).toEqual([
    "Ab/Ac clamped at 0.25 (As/Ac 1)",
    "Cb x 0.0331: charged on the velocity the table's own geometry has where it was read",
    "ER5-1 is a smooth-radius wye; this takeoff is read on it with As = Ac",
  ]);
});

it("a junction past ED5-3's edge is refused, never charged an extrapolated coefficient (FC-23 13771256)", async () => {
  const { priceLeg } = await import("./kernel/price-leg.ts");
  // Live FC-23 (2026-10-29): the proposed tap from 13771256:0, a 20x20 collar, onto the 6 in round
  // duct 13973156, carrying 50 cfm one way (Qb = Qc). Ab/Ac 14.2 clamps to ED5-3's 1; Cb there is
  // -262998, and charging it on the collar's 18 fpm multiplied it by 200 to about -5.3e7.
  const tap = {
    id: 13771256,
    kind: "fitting",
    family: "proposed tap",
    partType: "Tap",
    connectors: [rectPort(0, 20, 20)],
    facts: [{ key: "takeoff", value: 1 }],
  } as unknown as Snap["nodes"][number];
  const main = {
    id: 13973156,
    shape: "round",
    diameterIn: 6,
  } as unknown as Snap["segments"][number];
  const p = priceLeg(
    {
      kind: "fitting",
      fitting: tap,
      facts: await tapFacts(tap, main),
      flows: { through: 50, branch: 50, upstreamMain: 50, downstreamMain: 0 },
      leg: "Cb",
    },
    CONVERGING,
  );
  expect(p.lossInWg).toBeNull();
  expect(p.implausible).toBeUndefined();
  expect(p.unpriced).toBe(
    "ED5-3 Cb not read: Ab/Ac 14.147, As/Ac 1: a branch or straight larger than its round common is outside ED5-3, which states area ratios up to 1",
  );
});

it("without ER5-1 served, ER5-2 prices at its own Ab/Ac 0.5 and says so; an assigned table is never swapped", async () => {
  const { priceLeg } = await import("./kernel/price-leg.ts");
  const { friction } = await import("./loss-physics.ts");
  const tap = rectTap(12, 8);
  const input = {
    kind: "fitting" as const,
    fitting: tap,
    facts: await tapFacts(tap, trunk),
    flows: { through: 400, branch: 400, upstreamMain: 1000, downstreamMain: 600 },
    leg: "Cb" as const,
  };
  const only = { "ER5-2": CONVERGING["ER5-2"]!, "ER5-3": CONVERGING["ER5-3"]! };
  const p = priceLeg(input, only);
  // ER5-2 Cb 0.65 at Qb/Qc 0.4, stated at Ab/Ac 0.5: on the common Pv, 0.65 x (0.4 / 0.5)^2.
  expect(p.source).toMatchObject({ table: "ER5-2" });
  expect(p.lossInWg).toBeCloseTo(
    0.65 * (0.4 / 0.5) ** 2 * friction({ areaFt2: (32 * 11) / 144, dhIn: 1 }, 1000, 0).pv,
    12,
  );
  expect(p.source?.kind === "rule" && p.source.notes).toEqual([
    "Cb x 0.298: charged on the velocity the table's own geometry has where it was read",
    "ER5-1 is not served; its fallback ER5-2 priced",
    "ER5-2 is stated for Ab/Ac 0.5, As = Ac; this junction's Ab/Ac is 0.273; round-tap table on a rectangular branch",
  ]);
  const assigned = priceLeg(input, only, { "tap-converging-rect": "ER5-3" });
  expect(assigned.source).toMatchObject({ table: "ER5-3" });
  expect(priceLeg(input, {}, { "tap-converging-rect": "ER5-1" }).unpriced).toBe(
    "ER5-1 Cb is not loaded",
  );
});

it("a round junction where air joins prices on ED5-3 by Dc, Ab/Ac and As/Ac: a takeoff and a tee", async () => {
  const { fittingFacts } = await import("./kernel/fitting-facts.ts");
  const { priceLeg } = await import("./kernel/price-leg.ts");
  const { friction, roundSection } = await import("./loss-physics.ts");
  const tap = {
    id: 5,
    kind: "fitting",
    family: "Round Takeoff",
    partType: "Tap",
    connectors: [{ index: 0, shape: "round", diameterIn: 6 }],
    facts: [{ key: "takeoff", value: 1 }],
  } as unknown as Snap["nodes"][number];
  const flows = { through: 100, branch: 100, upstreamMain: 300, downstreamMain: 200 };
  for (const [d, res] of [
    [10, "Cb"],
    [12, "Cb#2"],
  ] as const) {
    const main = { id: 6, shape: "round", diameterIn: d } as unknown as Snap["segments"][number];
    const p = priceLeg(
      { kind: "fitting", fitting: tap, facts: await tapFacts(tap, main), flows, leg: "Cb" },
      CONVERGING,
    );
    const abAc = 36 / d ** 2;
    const v = lookupGrid(CONVERGING["ED5-3"]![res]!, 1 / 3, abAc, 1).value;
    expect(p.source).toMatchObject({
      rule: "junction-converging-round",
      table: "ED5-3",
      coefficient: expect.closeTo(v, 12),
      inputs: { res, y: abAc, z: 1 },
    });
    expect(p.lossInWg).toBeCloseTo(v * friction(roundSection(6), 100, 0).pv, 12);
  }

  // A converging tee, walked in at its run port toward the fan (connector 0, the common): the leg
  // is the port the path leaves by, Cb on the 6 in branch, Cs on the 8 in straight.
  const ports = [
    { index: 0, facing: [-1, 0, 0], shape: "round", diameterIn: 10 },
    { index: 1, facing: [1, 0, 0], shape: "round", diameterIn: 8 },
    { index: 2, facing: [0, 1, 0], shape: "round", diameterIn: 6 },
  ];
  const tee = {
    id: 7,
    kind: "fitting",
    family: "Round Tee",
    partType: "Tee",
    connectors: ports,
    facts: [],
  } as unknown as Snap["nodes"][number];
  for (const [out, res, cfm, section] of [
    [2, "Cb", 100, 6],
    [1, "Cs", 200, 8],
  ] as const) {
    const facts = fittingFacts({
      fitting: tee,
      inlet: tee.connectors[0],
      outlet: tee.connectors[out],
      converging: true,
    });
    const p = priceLeg(
      { kind: "fitting", fitting: tee, facts, flows: { ...flows, through: cfm }, leg: "C" },
      CONVERGING,
    );
    const v = lookupGrid(CONVERGING["ED5-3"]![res]!, cfm / 300, 0.36, 0.64).value;
    expect(p.source).toMatchObject({
      rule: "junction-converging-round",
      coefficient: expect.closeTo(v, 12),
      inputs: { res },
    });
    expect(p.lossInWg).toBeCloseTo(v * friction(roundSection(section), cfm, 0).pv, 12);
  }
});

it("a bullhead (entered from its branch, the main bringing air both ways) prices on ER5-5 or ED5-4, never a tap table", async () => {
  const { priceLeg } = await import("./kernel/price-leg.ts");
  const { friction, roundSection, sectionOf } = await import("./loss-physics.ts");
  // 12x8 collar on the 32x11 trunk: 300 cfm from one side, 100 from the other, 400 up the collar.
  const tap = rectTap(12, 8);
  const facts = await tapFacts(tap, trunk, { converging: true, bullhead: true });
  const flows = { through: 400, branch: 300, upstreamMain: 400, downstreamMain: 100 };
  const rect = priceLeg({ kind: "fitting", fitting: tap, facts, flows, leg: "Cb" }, CONVERGING);
  // Ab1/Ac 3.67 is past ER5-5's 1: Cb1 read at Ab1/Ac 1, Qb1/Qc 0.75 (2.59), on branch 1's velocity
  // at that geometry, which is 0.75 of the collar's.
  const collar = friction(sectionOf("rectangular", null, 12, 8)!, 400, 0).pv;
  expect(rect.source).toMatchObject({
    rule: "bullhead-converging-rect",
    table: "ER5-5",
    inputs: { res: "Cb1", x: 0.75 },
  });
  expect(rect.lossInWg).toBeCloseTo(((2.8 + 2.38) / 2) * collar * 0.75 ** 2, 12);
  expect(rect.source?.kind === "rule" && rect.source.notes[0]).toBe("Ab1/Ac clamped at 1");

  // The round bullhead: a 6 in collar on an 8 in main, ED5-4 at Ab1/Ac = Ab2/Ac 1.78 (clamped at 1).
  const round = {
    id: 9,
    kind: "fitting",
    family: "Round Takeoff",
    partType: "Tap",
    connectors: [{ index: 0, shape: "round", diameterIn: 6 }],
    facts: [{ key: "takeoff", value: 1 }],
  } as unknown as Snap["nodes"][number];
  const main = { id: 10, shape: "round", diameterIn: 8 } as unknown as Snap["segments"][number];
  const rf = await tapFacts(round, main, { converging: true, bullhead: true });
  const r = priceLeg({ kind: "fitting", fitting: round, facts: rf, flows, leg: "Cb" }, CONVERGING);
  const v = lookupGrid(CONVERGING["ED5-4"]!.Cb1!, 0.75, 1, 1).value;
  expect(r.source).toMatchObject({ rule: "bullhead-converging-round", table: "ED5-4" });
  expect(r.lossInWg).toBeCloseTo(v * friction(roundSection(6), 400, 0).pv * 0.75 ** 2, 12);
  expect(
    LOSS_RULES.filter((rule) => rule.when(rf, { q: 400, qb: 300, qc: 400, qs: 100 })).map(
      (rule) => rule.key,
    ),
  ).toEqual(["bullhead-converging-round"]);
});

it("a supply bullhead (collar air dividing both ways along a round main) reads SD5-18 Cb1 per path, never SD5-9", async () => {
  // MUAS-1 takeoff 14806947: 115 cfm up a 6 in collar dividing 50 / 65 along an 8 in main.
  const round = {
    id: 9,
    kind: "fitting",
    family: "Round Takeoff",
    partType: "Tap",
    connectors: [{ index: 0, shape: "round", diameterIn: 6 }],
    facts: [{ key: "takeoff", value: 1 }],
  } as unknown as Snap["nodes"][number];
  const main = { id: 10, shape: "round", diameterIn: 8 } as unknown as Snap["segments"][number];
  const rf = await tapFacts(round, main, { converging: false, bullhead: true });
  const flows = { q: 115, qb: 65, qc: 115, qs: 50 };
  const matched = LOSS_RULES.filter((rule) => rule.when(rf, flows));
  expect(matched.map((rule) => rule.key)).toEqual(["bullhead-diverging-round"]);
  const input = matched[0]!.input(rf, flows, "SD5-18", "Cb");
  expect(input).toMatchObject({ res: "Cb1", x: 65 / 115 });
  expect(input.y).toBeCloseTo(8 ** 2 / 6 ** 2, 12);
});

it("a rectangular plain damper prices fully open on CR9-1 (Theta 0, H/W), a round one on CD9-1", () => {
  const rect: FittingFacts = {
    ...accessory("Damper_Volume_Square"),
    inlet: { shape: "rectangular", section: null, widthIn: 12, heightIn: 6 },
  };
  const rule = LOSS_RULES.find((r) => r.when(rect, { q: 100 }))!;
  expect(rule.key).toBe("damper-rect");
  expect(rule.input(rect, { q: 100 }, "CR9-1", "C")).toEqual({ res: "Co", x: 0, y: 0.5 });
  expect(ruleOf("Damper_Volume_Round")).toBe("damper");
});

it("a round elbow read with centerRadius but no rOverD still finds its rule (live from/ids reads)", async () => {
  const { fittingFacts } = await import("./kernel/fitting-facts.ts");
  const port = (index: number) => ({
    index,
    kind: "end",
    shape: "round",
    diameterIn: 10,
    point: [0, 0, 0],
  });
  const elbow = {
    id: 14606857,
    kind: "fitting",
    family: "Round Elbow",
    type: "0.75 D",
    partType: "Elbow",
    connectors: [port(0), port(1)],
    facts: [
      { key: "angle", value: 90 },
      { key: "centerRadius", value: 7.5 },
    ],
  } as never;
  const facts = fittingFacts({
    fitting: elbow,
    inlet: (elbow as { connectors: never[] }).connectors[0],
    outlet: undefined,
  } as never);
  expect(facts.rOverD).toBe(0.75);
  expect(LOSS_RULES.find((r) => r.when(facts, { q: 100 } as never))?.key).toBe("elbow-075d");
});
