import { inputsFor, TEST_FIRM, TEST_SLOTS, TEST_WALK } from "@pe/ducts-domain/test-inputs";
/**
 * The path engine, deterministic. Synthetic: the kernel's independently computed network
 * (price-leg.test.ts, handcalc.py totals T6/T8) hung off a roster fan with a return run; a
 * side-stream merges into another fan's return, auto-joins, and unresolved open ends.
 * Retained: MUAS-1 on the raw Chadds snapshot, skipped when the file is absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { resolveValue } from "@pe/agent-contracts/work-value";
import { mintWriteRequest } from "./write-request.ts";

import { lookupGrid } from "@pe/ducts-domain/loss-grid";
import { friction, roundSection } from "@pe/ducts-domain/loss-physics";
import { suggestRoster, type FanPort } from "@pe/ducts-domain/roster";
import { uniqueIdOf, type Connector as Conn, type Node, type Segment } from "@pe/ducts-domain/test-snapshot";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { withHealth } from "@pe/ducts-domain/health.fixture";
import { buildChain, buildCalc, type CalcSnapshot } from "./index.ts";
import { grids } from "@pe/ducts-domain/tables.fixture";

// `conn`, `node` and `duct` keep their casts: `withHealth` keys the recorded C# health by a hash of
// the exact node and segment JSON (field order included), so these shapes stay byte-for-byte until
// the fixture is re-recorded through Revit. Everything built from them is typed.
const round = (d: number) => ({ shape: "round" as const, size: `${d}`, diameterIn: d });
const rect = (w: number, h: number) => ({
  shape: "rectangular" as const,
  size: `${w}x${h}`,
  widthIn: w,
  heightIn: h,
});
const conn = (
  index: number,
  to: [number, number] | null,
  size: object,
  kind = "end",
  point = [0, 0, 0],
  classification?: string,
): Conn =>
  ({
    index,
    kind,
    point,
    direction: "out",
    connectedTo: to ? { elementId: to[0], connector: to[1] } : null,
    ...(classification ? { classification } : {}),
    ...size,
  }) as Conn;
const node = (id: number, kind: string, extra: object): Node =>
  ({
    uniqueId: uniqueIdOf(id),
    id,
    kind,
    category: "",
    point: [0, 0, 0],
    groupId: "g1",
    facts: [],
    ...extra,
  }) as unknown as Node;
const duct = (
  id: number,
  lengthFt: number,
  size: object,
  polyline: number[][],
  connectors: Conn[],
): Segment =>
  ({
    uniqueId: uniqueIdOf(id),
    id,
    kind: "duct",
    curveKind: "line",
    ...size,
    lengthFt,
    polyline,
    groupId: "g1",
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors,
  }) as unknown as Segment;
const snapshot = (nodes: Node[], segments: Segment[]): CalcSnapshot => ({
  nodes,
  segments,
  walk: TEST_WALK,
  document: {
    title: "synthetic",
    readAt: "2026-10-27",
    elapsedMs: 0,
    networkBasedCalculations: false,
  },
});
const fanPort = (unitId: number, portIndex: number, inletPortIndex?: number): FanPort => ({
  unitId,
  portIndex,
  tag: `F-${unitId}`,
  side: "supply",
  kind: "air-handler",
  source: "ruling",
  ...(inletPortIndex == null ? {} : { inletPortIndex }),
});

// Supply: unit 100:0 -> duct 1 -> elbow 2 -> duct 3 (tap 4 at 5 ft) -> transition 5 -> grille 6; tap 4 -> duct 7 -> terminal 8.
// Return: unit 100:1 -> duct 9 (20 ft) -> grille 10.
const unit = node(100, "equipment", {
  connectors: [conn(0, [1, 0], round(8)), conn(1, [9, 0], round(8))],
});
const elbow = node(2, "fitting", {
  partType: "Elbow",
  connectors: [conn(0, [1, 1], round(8)), conn(1, [3, 0], round(8))],
  facts: [{ key: "rOverD", value: 1, unit: "", provenance: "geometry" }],
});
const tap = node(4, "fitting", {
  partType: "TapAdjustable",
  connectors: [conn(0, [3, 2], round(6), "curve"), conn(1, [7, 0], round(6))],
  facts: [{ key: "mainSegment", value: 3, unit: "", provenance: "geometry" }],
});
const transition = node(5, "fitting", {
  partType: "Transition",
  connectors: [{ ...conn(0, [3, 1], round(8)), direction: "in" }, conn(1, [6, 0], rect(12, 4))],
  facts: [{ key: "angle", value: 45, unit: "deg", provenance: "designer-stated" }],
});
const grille6 = node(6, "terminal", { connectors: [conn(0, [5, 1], rect(12, 4))] });
const terminal8 = node(8, "terminal", { connectors: [conn(0, [7, 1], round(6))] });
const grille10 = node(10, "terminal", { connectors: [conn(0, [9, 1], round(8))] });
const duct1 = duct(
  1,
  10,
  round(8),
  [
    [0, 0, 0],
    [10, 0, 0],
  ],
  [conn(0, [100, 0], round(8), "end", [0, 0, 0]), conn(1, [2, 0], round(8), "end", [10, 0, 0])],
);
const duct3 = duct(
  3,
  12,
  round(8),
  [
    [10, 0, 0],
    [10, 12, 0],
  ],
  [
    conn(0, [2, 1], round(8), "end", [10, 0, 0]),
    conn(1, [5, 0], round(8), "end", [10, 12, 0]),
    conn(2, [4, 0], round(6), "curve", [10, 5, 0]),
  ],
);
const duct7 = duct(
  7,
  3,
  round(6),
  [
    [10, 5, 0],
    [10, 5, 3],
  ],
  [conn(0, [4, 1], round(6)), conn(1, [8, 0], round(6))],
);
const duct9 = duct(
  9,
  20,
  round(8),
  [
    [0, 0, 0],
    [-20, 0, 0],
  ],
  [conn(0, [100, 1], round(8), "end", [0, 0, 0]), conn(1, [10, 0], round(8), "end", [-20, 0, 0])],
);
const network = snapshot(
  [unit, elbow, tap, transition, grille6, terminal8, grille10],
  [duct1, duct3, duct7, duct9],
);
const T6 = 0.09187933;
const T8 = 0.16736657;

it("a complete sheet: required ESP = worst supply + worst return + allowances", () => {
  const sheet = buildCalc({
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(network, {
      endCfm: { 6: 200, 8: 100, 10: 300 },
      drops: { 6: 0.05, 8: 0.08, 10: 0.03 },
      allowanceInWg: { supply: 0.1, return: 0.05 },
    }),
  });
  const R = friction(roundSection(8), 300, 20, 0.0003).dp + 0.03;
  const supply = sheet.paths.filter((p) => p.side === "supply");
  expect(supply.map((p) => p.end.elementId)).toEqual([8, 6]); // ranked worst first
  expect(supply[0]!.knownInWg).toBeCloseTo(T8, 6);
  expect(supply[1]!.knownInWg).toBeCloseTo(T6, 6);
  expect(sheet.paths.find((p) => p.side === "return")!.knownInWg).toBeCloseTo(R, 6);
  expect(sheet.claim.kind).toBe("complete");
  expect(sheet.blockers).toEqual([]);
  expect(sheet.totals.supply).toMatchObject({
    worstPath: expect.closeTo(T8, 6),
    allowanceInWg: 0.1,
  });
  expect(sheet.totals.requiredEspInWg).toBeCloseTo(T8 + R + 0.15, 5);
  expect(sheet.fan).toMatchObject({ flowCfm: 300, inletPortIndex: 1, mark: "F-100" });
  // Legs are keyed once; flow is the sum of the ends reached through each leg.
  expect(supply[0]!.legIds.filter((id) => supply[1]!.legIds.includes(id))).toEqual([
    "1:0>1",
    "2:0>1",
  ]);
  // A tapped duct's leg shows the flow it is priced at where it enters, as its velocity is (fix6
  // defect 6): both legs on duct 3 carry 300 up to tap 4; past it 200 runs on to grille 6, 100
  // leaves by the tap. The leaving flow is in the leg's flowSource.
  expect(sheet.legs["3:0>1"]).toMatchObject({ flowCfm: 300, kind: "duct" });
  expect(sheet.legs["3:0>1"]!.flowSource).toContain(
    "300 cfm where it enters, 200 cfm leaves by connector 1",
  );
  expect(sheet.legs["3:0>2"]).toMatchObject({ flowCfm: 300 });
  expect(sheet.legs["3:0>2"]!.velocityFpm).toBeCloseTo(300 / roundSection(8).areaFt2, 6);
  expect(sheet.legs["4:0>1"]).toMatchObject({ flowCfm: 100 });
  expect(sheet.legs["1:0>1"]).toMatchObject({ flowCfm: 300, equivalentFt: 10 });
  expect(sheet.legs["4:0>1"]!.lossSource).toMatchObject({
    kind: "rule",
    ref: expect.stringContaining("SD5-9 Cb"),
  });
  expect(sheet.totals.supply.telFt).toBeGreaterThan(10 + 5 + 3);
  // The same inputs give the same basis; a changed input changes it.
  const again = buildCalc({
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(network, {
      endCfm: { 6: 200, 8: 100, 10: 300 },
      drops: { 6: 0.05, 8: 0.08, 10: 0.03 },
      allowanceInWg: { supply: 0.1, return: 0.05 },
    }),
  });
  expect(again.basis).toBe(sheet.basis);
  const missing = buildCalc({
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(network, {
      endCfm: { 6: 200, 10: 300 },
      drops: { 6: 0.05, 8: 0.08, 10: 0.03 },
    }),
  });
  expect(missing.basis).not.toBe(sheet.basis);
  // A terminal with no flow withholds every leg it shares, and the total.
  expect(missing.blockers.map((b) => b.id)).toContain("no-flow:8:0");
  expect(missing.claim.kind).toBe("incomplete");
  expect(missing.totals.requiredEspInWg).toBeNull();
});

it("chain mode prices one asserted chain at a typed flow, with no ESP claim", () => {
  const chain = buildChain({
    roster: [],
    snapshot: network,
    start: { elementId: 100, connector: 0 },
    end: { elementId: 8 },
    direction: "supply",
    grids,
    flowCfm: 100,
    inputs: inputsFor(network, { drops: { 8: 0.08 } }),
  });
  expect(chain.path!.legIds).toEqual(["1:0>1", "2:0>1", "3:0>2", "4:0>1", "7:0>1", "8:0>"]);
  expect(Object.values(chain.legs).every((l) => l.flowCfm === 100)).toBe(true);
  // P-031: chain legs carry the pricer's evidence, never the shared placeholder.
  expect(Object.values(chain.legs).map((l) => l.evidence.kind)).not.toContain("unpriced");
  expect(chain.path!.end.kind).toBe("terminal");
  expect(chain).not.toHaveProperty("totals");
});

it("a side-stream into another fan's return ends at the merge without a class-change or shared-leg blocker", () => {
  // F 300:0 (supply air) -> duct 31 (return air main) -> G 400:1; duct 31 tap 32 -> duct 33 -> return grille 34 (500 cfm, G's).
  const SA = "SupplyAir",
    RA = "ReturnAir";
  const f = node(300, "equipment", {
    connectors: [
      conn(0, [31, 0], round(8), "end", [0, 0, 0], SA),
      conn(1, null, round(8), "end", [0, 0, 0], RA),
    ],
  });
  const g = node(400, "equipment", {
    connectors: [
      conn(1, [31, 1], round(8), "end", [20, 0, 0], RA),
      conn(2, null, round(8), "end", [20, 0, 0], SA),
    ],
  });
  const tap32 = node(32, "fitting", {
    partType: "TapAdjustable",
    connectors: [
      conn(0, [31, 2], round(6), "curve", [10, 0, 0], RA),
      conn(1, [33, 0], round(6), "end", [10, 0, 0], RA),
    ],
  });
  const grille34 = node(34, "terminal", {
    flowParameter: "PE_M_Grd_AirFlow",
    facts: [{ key: "flow", value: 500, unit: "cfm", provenance: "designer-stated" }],
    connectors: [conn(0, [33, 1], round(6), "end", [10, 3, 0], RA)],
  });
  const d31 = duct(
    31,
    20,
    round(8),
    [
      [0, 0, 0],
      [20, 0, 0],
    ],
    [
      conn(0, [300, 0], round(8), "end", [0, 0, 0], RA),
      conn(1, [400, 1], round(8), "end", [20, 0, 0], RA),
      conn(2, [32, 0], round(6), "curve", [10, 0, 0], RA),
    ],
  );
  const d33 = duct(
    33,
    3,
    round(6),
    [
      [10, 0, 0],
      [10, 3, 0],
    ],
    [
      conn(0, [32, 1], round(6), "end", [10, 0, 0], RA),
      conn(1, [34, 0], round(6), "end", [10, 3, 0], RA),
    ],
  );
  const calcSnapshot1 = snapshot([f, g, tap32, grille34], [d31, d33]);
  const input1 = (s: CalcSnapshot) => ({
    snapshot: s,
    fan: { unitId: 300, portIndex: 0 },
    roster: [fanPort(300, 0), fanPort(400, 2, 1)],
    grids,
  });
  const sheet = buildCalc({
    ...input1(calcSnapshot1),
    inputs: inputsFor(calcSnapshot1, { slot: "PE_M_Grd_AirFlow", endCfm: { 300: 100 } }),
  });
  expect(sheet.paths.map((p) => [p.end.kind, p.end.elementId])).toContainEqual([
    "joins-other-fan",
    31,
  ]);
  expect(sheet.paths.some((p) => p.end.elementId === 34)).toBe(false);
  expect(sheet.blockers.some((b) => b.kind === "class-change" || b.kind === "shared-leg")).toBe(
    false,
  );
  expect(sheet.blockers.map((b) => b.id)).toContain("open-end:300");
  expect(sheet.totals.requiredEspInWg).toBeNull();
  // fix6 defect 2's boundary: a unit's design flow is its share only at its own port. Joined by a
  // merge into G's stream (MUAS-1 into FC-23's 1200 cfm return), G's flow is G's whole stream, so
  // F's own 100 still lands there.
  const withG: CalcSnapshot = {
    ...calcSnapshot1,
    slots: {
      ...TEST_SLOTS,
      fanFlow: "PE_M_Fan_AirFlowDesign",
      terminalFlow: "PE_M_Grd_AirFlow",
    },
    nodes: calcSnapshot1.nodes.map((n) =>
      n.id === 400
        ? {
            ...n,
            facts: [{ key: "fanFlow", value: 1200, unit: "cfm", provenance: "designer-stated" }],
          }
        : n,
    ),
  };
  const gInputs = inputsFor(withG, { endCfm: { 300: 100 } });
  expect(gInputs.units["400"]!.cfm).toMatchObject({ value: 1200, source: "model" });
  const merged = buildCalc({ ...input1(withG), inputs: gInputs });
  expect(merged.paths.map((p) => p.end.kind)).toContain("joins-other-fan");
  expect(merged.fan.flowCfm).toBe(100);
  expect(merged.blockers.some((b) => b.kind === "no-flow")).toBe(false);
});

it("an open end blocks its side; a vacant opposed port within the default gap auto-joins with provenance", () => {
  const IN = 1 / 12;
  const fan = node(500, "equipment", {
    connectors: [conn(0, [51, 0], round(6)), conn(1, [52, 0], round(6))],
  });
  const open = duct(
    51,
    5,
    round(6),
    [
      [0, 0, 0],
      [0, -5, 0],
    ],
    [conn(0, [500, 0], round(6), "end", [0, 0, 0]), conn(1, null, round(6), "end", [0, -5, 0])],
  );
  const d52 = duct(
    52,
    10,
    round(6),
    [
      [0, 0, 0],
      [10, 0, 0],
    ],
    [conn(0, [500, 1], round(6), "end", [0, 0, 0]), conn(1, null, round(6), "end", [10, 0, 0])],
  );
  const d53 = duct(
    53,
    10,
    round(6),
    [
      [10 + 0.4 * IN, 0, 0],
      [20, 0, 0],
    ],
    [
      conn(0, null, round(6), "end", [10 + 0.4 * IN, 0, 0]),
      conn(1, [54, 0], round(6), "end", [20, 0, 0]),
    ],
  );
  const grille = node(54, "terminal", {
    connectors: [conn(0, [53, 1], round(6), "end", [20, 0, 0])],
  });
  const calcSnapshot2 = withHealth(snapshot([fan, grille], [open, d52, d53]));
  const input = {
    snapshot: calcSnapshot2,
    fan: { unitId: 500, portIndex: 0 },
    roster: [fanPort(500, 0, 1)],
    grids,
    inputs: inputsFor(calcSnapshot2, { endCfm: { 54: 100 }, drops: { 54: 0.02 } }),
  };
  const sheet = buildCalc(input);
  const supply = sheet.paths.find((p) => p.side === "supply")!;
  expect(supply.end).toEqual({ kind: "open-end", elementId: 51, connector: 1 });
  expect(sheet.blockers.find((b) => b.id === "open-end:51:1")).toMatchObject({
    closer: { kind: "ruling" },
    // Slice 5: a blocker names its element by the codec's UniqueId SubjectRef, minted here.
    subject: `UniqueId:6d52156a-3876-4d76-b641-341454252f26-${(51).toString(16).padStart(8, "0")}`,
  });
  expect(sheet.totals.supply).toMatchObject({ worstPath: null });
  // The supply's one end carries nothing, so it carries what the return delivers.
  expect(sheet.legs["51:0>1"]).toMatchObject({
    flowCfm: 100,
    flowSource: expect.stringContaining("balance"),
  });
  const ret = sheet.paths.find((p) => p.side === "return")!;
  expect(ret.end).toMatchObject({ kind: "terminal", elementId: 54 });
  expect(sheet.blockers.some((b) => b.id === "inferred-join:52:1")).toBe(false);
  expect(
    sheet.notes.some((i) =>
      i.text.includes("across 0.400 in, default \u22643 in"),
    ),
  ).toBe(true);
  expect(sheet.legs["53:0>1"]!.lossSource.ref).toContain("auto-joined");
  expect(ret.blockerIds).toEqual([]);
  expect(sheet.totals.requiredEspInWg).toBeNull();
  // A person's accept closes the join; the open supply end still withholds ESP.
  const ruled = buildCalc({
    ...input,
    inputs: inputsFor(input.snapshot, {
      endCfm: { 54: 100 },
      drops: { 54: 0.02 },
      rulings: [{ pair: ["52:1", "53:0"], verdict: "accept" }],
    }),
  });
  expect(ruled.paths.find((p) => p.side === "return")!.blockerIds).toEqual([]);
  expect(ruled.totals.return.worstPath).toBeCloseTo(
    friction(roundSection(6), 100, 10 + 10, 0.0003).dp + 0.02,
    5,
  );
  expect(ruled.totals.requiredEspInWg).toBeNull();
});

it("R-FACE: two walked stubs whose vacant ends face each other propose a join; within the auto-join gap they auto-join", () => {
  // Fan 600:0 -> duct 61 (0..10 ft, +x) -> grille 70. Taps 62 (at 3 ft) and 63 (at 7 ft) feed two
  // stubs that rise 4 ft and turn toward each other along y = 4: 64 ends at x = 3 + reach facing
  // +x, 65 ends at x = 7 - reach facing -x. Both stubs are walked from the trunk before either
  // open end is reached; before R-FACE `proposeHeals` never saw a walked element.
  const facing = (reach: number) => {
    const fan = node(600, "equipment", {
      connectors: [conn(0, [61, 0], round(6)), conn(1, [71, 0], round(6), "end", [-1, 0, 0])],
    });
    const grille = node(70, "terminal", {
      connectors: [conn(0, [61, 1], round(6), "end", [10, 0, 0])],
    });
    const back = node(71, "terminal", {
      connectors: [conn(0, [600, 1], round(6), "end", [-1, 0, 0])],
    });
    const tap62 = node(62, "fitting", {
      partType: "TapAdjustable",
      connectors: [
        conn(0, [61, 2], round(6), "curve", [3, 0, 0]),
        conn(1, [64, 0], round(6), "end", [3, 0, 0]),
      ],
    });
    const tap63 = node(63, "fitting", {
      partType: "TapAdjustable",
      connectors: [
        conn(0, [61, 3], round(6), "curve", [7, 0, 0]),
        conn(1, [65, 0], round(6), "end", [7, 0, 0]),
      ],
    });
    const trunk = duct(
      61,
      10,
      round(6),
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [
        conn(0, [600, 0], round(6), "end", [0, 0, 0]),
        conn(1, [70, 0], round(6), "end", [10, 0, 0]),
        conn(2, [62, 0], round(6), "curve", [3, 0, 0]),
        conn(3, [63, 0], round(6), "curve", [7, 0, 0]),
      ],
    );
    const stub64 = duct(
      64,
      4 + reach,
      round(6),
      [
        [3, 0, 0],
        [3, 4, 0],
        [3 + reach, 4, 0],
      ],
      [
        conn(0, [62, 1], round(6), "end", [3, 0, 0]),
        conn(1, null, round(6), "end", [3 + reach, 4, 0]),
      ],
    );
    const stub65 = duct(
      65,
      4 + reach,
      round(6),
      [
        [7, 0, 0],
        [7, 4, 0],
        [7 - reach, 4, 0],
      ],
      [
        conn(0, [63, 1], round(6), "end", [7, 0, 0]),
        conn(1, null, round(6), "end", [7 - reach, 4, 0]),
      ],
    );
    const calcSnapshot3 = withHealth(
      snapshot([fan, grille, back, tap62, tap63], [trunk, stub64, stub65]),
    );
    return {
      snapshot: calcSnapshot3,
      fan: { unitId: 600, portIndex: 0 },
      roster: [fanPort(600, 0, 1)],
      grids: {},
      inputs: inputsFor(calcSnapshot3, {
        endCfm: { 70: 100, 71: 100 },
        drops: { 70: 0.02, 71: 0.02 },
      }),
    };
  };
  const gaps = (s: ReturnType<typeof buildCalc>) =>
    [...s.blockers, ...s.assumed.blockers].filter((b) => b.kind !== "not-priced").map((b) => b.id);
  // 12 in apart: a join proposal each way, no blocker beyond the pair, closed by one accept.
  const apart = buildCalc(facing(1.5));
  expect(apart.blockers.find((b) => b.id === "inferred-join:64:1")!.proposal).toMatchObject({
    kind: "join",
    pair: ["64:1", "65:1"],
    gapIn: 12,
    fittingChange: false,
  });
  expect(apart.blockers.find((b) => b.id === "inferred-join:65:1")!.proposal).toMatchObject({
    pair: ["65:1", "64:1"],
  });
  expect(gaps(apart).sort()).toEqual(["inferred-join:64:1", "inferred-join:65:1"]);
  // The assumed walk takes the join: the far side is no end, so nothing is raised there.
  expect(apart.assumed.paths.map((p) => p.end.elementId)).toEqual([70, 71]);
  const input = facing(1.5);
  const ruled = buildCalc({
    ...input,
    inputs: inputsFor(input.snapshot, {
      endCfm: { 70: 100, 71: 100 },
      drops: { 70: 0.02, 71: 0.02 },
      rulings: [{ pair: ["64:1", "65:1"], verdict: "accept" }],
    }),
  });
  expect(gaps(ruled)).toEqual([]);
  expect(ruled.paths.map((p) => [p.end.kind, p.end.elementId])).toEqual([
    ["terminal", 70],
    ["terminal", 71],
  ]);
  expect(ruled.notes.some((i) => i.text.startsWith("join 64:1 to 65:1"))).toBe(true);
  // 2.4 in apart: auto-joined on the known walk, with provenance, and no blocker at all.
  const close = buildCalc(facing(2 - 0.1));
  expect(gaps(close)).toEqual([]);
  expect(close.paths.map((p) => [p.end.kind, p.end.elementId])).toEqual([
    ["terminal", 70],
    ["terminal", 71],
  ]);
  expect(close.notes.some((i) => i.text.startsWith("auto-joined") && i.text.includes("across 2.400 in"))).toBe(
    true,
  );
  expect(close.walkedElementIds).toEqual(expect.arrayContaining([64, 65]));
});

const CHADDS =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";
it.skipIf(!existsSync(CHADDS))(
  "MUAS-1 on Chadds: bounded walk, the capped plenum named, FC-23 a stop, no ESP",
  () => {
    // Kept: an untyped file boundary (a retained host capture outside git), not a constructed shape.
    const snap = (JSON.parse(readFileSync(CHADDS, "utf8")) as { result: DuctSnapshot }).result;
    const r = suggestRoster(snap);
    const roster = [...r.fans, ...r.suggestions];
    const port = roster.find((p) => p.unitId === 14577391)!;
    const sheet = buildCalc({
      snapshot: snap,
      inputs: inputsFor(snap),
      fan: { unitId: 14577391, portIndex: port.portIndex },
      roster,
      grids,
    });
    expect(sheet.walkedElementIds.length).toBeLessThan(500); // W0-A's all-to-all walk leaked to 1470
    const plenum = sheet.blockers.find((b) => b.id === "inferred-join:14122436:1")!;
    expect(plenum.detail).toMatch(/^this end faces .+, already capped/);
    expect(plenum.closer.candidate).toMatchObject({ toElementId: 14106988, toConnector: 1 });
    // Q4 (kaitpw 2026-11-16): MUAS-1's family states c2 out, c1 in, and now sets the roles; its ends read the
    // other way, which is the mismatch fact. Each line below names what the network-chosen roles gave.
    // Q4: was a `joins-other-fan` end on the supply; FC-23 is now met on the return side as a sibling.
    expect(sheet.paths.find((p) => p.end.fan?.unitId === 13760867)).toMatchObject({
      side: "return",
      end: { kind: "sibling-fan" },
    });
    // Q4: was { inletPortIndex: 2, dischargePortIndex: 1 }. FANS-W2-COSUPPLY: the only evidence for c1 here
    // was three other-fan ends, which are encounters and no longer vote, and c2 reaches no classified end
    // before the plenum join is accepted. So this read states no network direction and no mismatch
    // (it was { discharge: 2, networkDischarge: 1 }); muas-regression holds the mismatch with the louver reached.
    expect(sheet.fan).toMatchObject({
      inletPortIndex: 1,
      dischargePortIndex: 2,
      directionMismatch: null,
    });
    // Q4: was "ends:".
    expect(sheet.notes.find((i) => i.kind === "direction")!.text).toContain(
      "family connector direction",
    );
    // Q4: was "return".
    expect(sheet.paths.find((p) => p.end.elementId === 14122436)!.side).toBe("supply");
    expect(sheet.blockers.some((b) => b.kind === "class-change")).toBe(false);
    expect(sheet.totals.requiredEspInWg).toBeNull();

    // Ends infer the .r10 orientation without an input; the ERVs' design flows are their shares,
    // FC-23's merge takes the remainder (fix6 defect 2: a unit's design flow, FC-23's included, is
    // a share only at that unit's own port; FC-23's flow is its whole stream).
    const asserted = buildCalc({
      snapshot: snap,
      fan: { unitId: 14577391, portIndex: port.portIndex },
      roster,
      grids,
      inputs: inputsFor(snap, {
        endCfm: { 14577391: 150, 6105264: 35, 6953852: 50, 13760867: 1200 },
      }),
    });
    // Q4: was 150. Under the family's roles the typed flow reaches no carrying end: the intake is the
    // supply side and ends at the capped plenum's open end, and the real discharge is siblings carrying none.
    expect(asserted.fan.flowCfm).toBe(0);
    // Q4: was 0.006478 (the intake at 150 cfm, W0-A's independent sum). Nothing is priced on either side now.
    expect(asserted.totals.return.knownInWg).toBe(0);
    expect(asserted.totals.supply.knownInWg).toBe(0);
    expect(asserted.totals.requiredEspInWg).toBeNull();
  },
  // Parses a 14 MB retained snapshot; under the serial verify suite it took 11.8 s.
  120_000,
);

it("firm terminal drop is priced and visible; typed and catalog drops take precedence", () => {
  const input = {
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(network, { endCfm: { 6: 200, 8: 100, 10: 300 } }),
  };
  const firm = buildCalc(input);
  expect(firm.blockers).toEqual([]);
  expect(firm.totals.requiredEspInWg).not.toBeNull();
  for (const leg of Object.values(firm.legs).filter((l) => l.kind === "terminal")) {
    expect(leg.lossInWg).toBe(0.03);
    expect(leg.lossSource.ref).toBe("firm:test");
  }
  const typed = buildCalc({
    ...input,
    inputs: inputsFor(input.snapshot, {
      endCfm: { 6: 200, 8: 100, 10: 300 },
      drops: { 6: 0.07 },
      firm: {
        ...TEST_FIRM,
        version: "firm-1",
        criteria: { ...TEST_FIRM.criteria, terminalDropInWg: 0.04 },
      },
    }),
  });
  expect(typed.legs["6:0>"]!.lossInWg).toBe(0.07);
  expect(typed.legs["8:0>"]!.lossInWg).toBe(0.04);
  const catalog = structuredClone(network);
  catalog.nodes.find((n) => n.id === 8)!.terminalDrop = {
    catalogDropInWg: 0.09,
    writable: false,
  };
  const priced = buildCalc({
    ...input,
    snapshot: catalog,
    inputs: inputsFor(catalog, {
      endCfm: { 6: 200, 8: 100, 10: 300 },
      firm: { ...TEST_FIRM, criteria: { ...TEST_FIRM.criteria, terminalDropInWg: 0.04 } },
    }),
  });
  expect(priced.legs["8:0>"]!.lossInWg).toBe(0.09);
  expect(priced.legs["6:0>"]!.lossSource.ref).toBe("firm:test");
});

it("side-stream design flow: a receiving unit's design flow is its share at its own port whatever its source; only the remainder splits by policy", () => {
  // One trunk forks to three roster fan ports. Drop overrides isolate the flow behavior.
  const design = (cfm: number) => [
    { key: "fanFlow", value: cfm, unit: "cfm", provenance: "designer-stated" },
  ];
  const f = node(100, "equipment", { connectors: [conn(0, [1, 0], round(8))], facts: design(300) });
  const fork = node(2, "fitting", {
    connectors: [
      conn(0, [1, 1], round(8)),
      conn(1, [3, 0], round(8)),
      conn(2, [4, 0], round(8)),
      conn(3, [5, 0], round(8)),
    ],
  });
  const receivers = [200, 300, 400].map((id, i) =>
    node(id, "equipment", {
      facts: design((i + 1) * 50),
      connectors: [conn(0, [i + 3, 1], round(8))],
    }),
  );
  const runs = [1, 3, 4, 5].map((id, i) =>
    duct(
      id,
      10,
      round(8),
      [
        [i * 20, 0, 0],
        [i * 20 + 10, 0, 0],
      ],
      i === 0
        ? [conn(0, [100, 0], round(8)), conn(1, [2, 0], round(8))]
        : [conn(0, [2, i], round(8)), conn(1, [[200, 300, 400][i - 1]!, 0], round(8))],
    ),
  );
  const snap = snapshot([f, fork, ...receivers], runs);
  snap.slots = { ...TEST_SLOTS, fanFlow: "PE_M_Fan_AirFlowDesign" };
  const input = {
    snapshot: snap,
    fan: { unitId: 100, portIndex: 0 },
    // Receivers are reached at their inlet (port 0); A-INFLOW treats a reached discharge as a source.
    roster: [fanPort(100, 0), ...[200, 300, 400].map((id) => fanPort(id, 1, 0))],
    grids,
    inputs: inputsFor(snap, { drops: { 2: 0 } }),
  };
  // fix6 defect 2 (MUAS-1, 2026-10-29): RV-15 35 and RV-7 50 read from Revit split MUAS-1's 150 as
  // 50/50/50; a design flow read from Revit is the unit's share exactly as a typed one is.
  const shares = buildCalc(input);
  expect(shares.fan.flowCfm).toBe(300);
  expect(shares.legs["1:0>1"]!.flowCfm).toBe(300);
  expect([3, 4, 5].map((id) => shares.legs[`${id}:0>1`]!.flowCfm)).toEqual([50, 100, 150]);
  expect(shares.legs["4:0>1"]!.flowSource).toContain(
    "unit design flow model:PE_M_Fan_AirFlowDesign",
  );
  expect(shares.blockers.some((b) => b.kind === "no-flow")).toBe(false);
  // Typed over Revit: the typed share wins; the others keep theirs.
  const typedOver = buildCalc({
    ...input,
    inputs: inputsFor(snap, { drops: { 2: 0 }, endCfm: { 200: 30 } }),
  });
  expect([3, 4, 5].map((id) => typedOver.legs[`${id}:0>1`]!.flowCfm)).toEqual([30, 100, 150]);
  // Receivers with no design flow take the remainder by the policy.
  for (const id of [300, 400]) snap.nodes.find((n) => n.id === id)!.facts = [];
  const even = buildCalc({ ...input, inputs: inputsFor(snap, { drops: { 2: 0 } }) });
  expect([3, 4, 5].map((id) => even.legs[`${id}:0>1`]!.flowCfm)).toEqual([50, 125, 125]);
  expect(even.legs["4:0>1"]!.flowSource).toContain("splitPolicy:even");
  const fallback = buildCalc({
    ...input,
    inputs: inputsFor(snap, { drops: { 2: 0 }, splitPolicy: "proportional", endCfm: { 200: 50 } }),
  });
  expect([3, 4, 5].map((id) => fallback.legs[`${id}:0>1`]!.flowCfm)).toEqual([50, 125, 125]);
  expect(fallback.legs["4:0>1"]!.flowSource).toContain("even (receiving fan design flow missing");
  expect(fallback.basis).not.toBe(even.basis);
  snap.nodes.find((n) => n.id === 200)!.facts = [];
  snap.nodes.find((n) => n.id === 100)!.facts = [];
  const missing = buildCalc({ ...input, inputs: inputsFor(snap, { drops: { 2: 0 } }) });
  expect(missing.blockers.some((b) => b.kind === "no-flow")).toBe(true);
  const typed = buildCalc({
    ...input,
    inputs: inputsFor(snap, { drops: { 2: 0 }, endCfm: { 200: 30, 300: 40, 400: 50 } }),
  });
  expect(typed.fan.flowCfm).toBe(120);
  expect(typed.blockers.some((b) => b.kind === "no-flow")).toBe(false);
  const over = buildCalc({
    ...input,
    inputs: inputsFor(snap, { drops: { 2: 0 }, endCfm: { 100: 20, 200: 30 } }),
  });
  expect(over.legs["3:0>1"]!.flowCfm).toBe(30);
  expect(over.blockers.some((b) => b.detail.includes("exceeds"))).toBe(true);
  // The closer on an "exceeds" row writes the receiving unit's design flow (equipmentFlows), the
  // one door that closes it (UAT 2026-10-29: a per-end flows cell on a unit is never read).
  const closed = buildCalc({
    ...input,
    inputs: inputsFor(snap, { drops: { 2: 0 }, endCfm: { 100: 20, 200: 30, 300: 40, 400: 50 } }),
  });
  expect(closed.blockers.some((b) => b.kind === "no-flow")).toBe(false);
  expect([3, 4, 5].map((id) => closed.legs[`${id}:0>1`]!.flowCfm)).toEqual([30, 40, 50]);
});

it("end terminals decide direction despite reversed metadata; an outdoor louver is an inlet end", () => {
  const f = node(100, "equipment", {
    connectors: [conn(0, [10, 0], round(8)), conn(1, [20, 0], round(8))],
  });
  const louver = node(10, "terminal", {
    family: "Outdoor Louver",
    connectors: [conn(0, [100, 0], round(8), "end", [0, 0, 0], "OutdoorAir")],
  });
  const supply = node(20, "terminal", {
    family: "Supply Grille",
    connectors: [conn(0, [100, 1], round(8), "end", [0, 0, 0], "SupplyAir")],
  });
  const calcSnapshot4 = snapshot([f, louver, supply], []);
  const sheet = buildCalc({
    snapshot: calcSnapshot4,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(calcSnapshot4, { endCfm: { 10: 100, 20: 100 } }),
  });
  expect(sheet.fan).toMatchObject({ portIndex: 0, dischargePortIndex: 1, inletPortIndex: 0 });
  expect(sheet.paths.map((p) => [p.side, p.end.elementId])).toEqual([
    ["supply", 20],
    ["return", 10],
  ]);
  expect(sheet.notes.find((i) => i.kind === "direction")!.text).toContain("ends:");
  // Both connectors read `out`: the family states no direction, so none is manufactured and no mismatch is claimed.
  expect(sheet.fan.directionMismatch).toBeNull();
  expect(sheet.blockers).toEqual([]);
  // Q4: one `out` facing one `in` is the family's word; it sets the roles and the network's reading is a mismatch fact.
  const stated = snapshot(
    [
      node(100, "equipment", {
        connectors: [conn(0, [10, 0], round(8)), { ...conn(1, [20, 0], round(8)), direction: "in" }],
      }),
      louver,
      supply,
    ],
    [],
  );
  const ruled = buildCalc({
    snapshot: stated,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(stated, { endCfm: { 10: 100, 20: 100 } }),
  });
  expect(ruled.fan).toMatchObject({
    dischargePortIndex: 0,
    inletPortIndex: 1,
    directionMismatch: { discharge: 0, networkDischarge: 1 },
  });
  expect(ruled.notes.find((i) => i.kind === "direction")!.text).toContain("family connector direction");
  // The mismatch is the only thing wrong with this calc, and it alone withholds `complete`.
  expect(ruled.claim).toMatchObject({
    kind: "incomplete",
    coverage: [],
    blockingIds: ["direction-mismatch:100"],
  });
  expect(ruled.issues).toEqual([
    expect.objectContaining({ id: "direction-mismatch:100", severity: "blocking", closer: expect.objectContaining({ kind: "none" }) }),
  ]);
  expect(ruled.totals.requiredEspInWg).toBeNull();
});

it("a Greenheck ESD louver classified Supply Air is still an outdoor inlet end (Chadds 14088043)", () => {
  const f = node(100, "equipment", {
    connectors: [conn(0, [10, 0], round(8)), conn(1, [20, 0], round(8))],
  });
  const louver = node(10, "terminal", {
    family: "Greenheck Circular ESD-403",
    connectors: [conn(0, [100, 0], round(8), "end", [0, 0, 0], "SupplyAir")],
  });
  const supply = node(20, "terminal", {
    family: "Supply Grille",
    connectors: [conn(0, [100, 1], round(8), "end", [0, 0, 0], "SupplyAir")],
  });
  // Port 0 reaches the louver. Read by classification alone the two sides tie at one supply end each.
  const calcSnapshot5 = snapshot([f, louver, supply], []);
  const sheet = buildCalc({
    snapshot: calcSnapshot5,
    fan: { unitId: 100, portIndex: 0 },
    // The roster names port 0 the discharge; only the louver rule can make it the inlet.
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(calcSnapshot5, { endCfm: { 10: 100, 20: 100 } }),
  });
  expect(sheet.fan).toMatchObject({ dischargePortIndex: 1, inletPortIndex: 0 });
  expect(sheet.paths.map((p) => [p.side, p.end.elementId])).toEqual([
    ["supply", 20],
    ["return", 10],
  ]);
});

it("a branch-entry tap onto this fan's own network is a split (R-Q4): the walk continues both ways along the main and prices the branch from the modelled main flow", () => {
  const f = node(100, "equipment", {
    connectors: [conn(0, [1, 0], round(6))],
    facts: [{ key: "fanFlow", value: 100 }],
  });
  const g = node(200, "equipment", { connectors: [conn(0, [3, 0], round(8))] });
  const branch = duct(
    1,
    10,
    round(6),
    [
      [0, 0, 0],
      [10, 0, 0],
    ],
    [conn(0, [100, 0], round(6)), conn(1, [2, 1], round(6))],
  );
  const tap = node(2, "fitting", {
    partType: "TapAdjustable",
    connectors: [conn(0, [3, 2], round(6)), conn(1, [1, 1], round(6))],
  });
  const main = duct(
    3,
    20,
    round(8),
    [
      [10, 0, 0],
      [30, 0, 0],
    ],
    [conn(0, [200, 0], round(8)), conn(1, [4, 0], round(8)), conn(2, [2, 0], round(6), "curve")],
  );
  const grille = node(4, "terminal", { connectors: [conn(0, [3, 1], round(8))] });
  const calcSnapshot6 = snapshot([f, g, tap, grille], [branch, main]);
  const input = {
    snapshot: calcSnapshot6,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0), fanPort(200, 1, 0)],
    grids,
    inputs: inputsFor(calcSnapshot6, { endCfm: { 4: 60 } }),
  };
  const sheet = buildCalc(input);
  // Both directions along the main: the grille, and the other fan's inlet taking the remainder.
  expect(sheet.paths.map((p) => [p.end.kind, p.end.elementId])).toEqual([
    ["terminal", 4],
    ["roster-fan-port", 200],
  ]);
  // fix6 defect 4 (MUAS-1 takeoff 14806947): the collar's 100 cfm divides 60 / 40 along the main.
  // Each path is its own leg through the tap, keyed by the element it continues into, at its own
  // share of the real collar total, as a proposed takeoff's paths are; never one leg charged on
  // both paths at a main flow invented beside the collar (Qb/Qc 100/160).
  expect(sheet.paths.find((p) => p.end.elementId === 4)!.legIds).toEqual([
    "1:0>1",
    "2:1>0>4",
    "3:2>1",
    "4:0>",
  ]);
  expect(sheet.paths.find((p) => p.end.elementId === 200)!.legIds).toEqual([
    "1:0>1",
    "2:1>0>200",
    "3:2>0",
  ]);
  expect(sheet.legs["3:2>1"]!.flowCfm).toBe(60);
  expect(sheet.legs["3:2>0"]!.flowCfm).toBe(40);
  expect(sheet.blockers.some((b) => b.kind === "no-flow" || b.kind === "class-change")).toBe(false);
  const collar = roundSection(6);
  const main8 = roundSection(8);
  // Air dividing both ways from the collar is a diverging bullhead: SD5-18 Cb1 per path (branch 1),
  // on branch 1's own velocity along the main (2026-10-30; the basis is verified in loss-rules.ts).
  for (const [id, q] of [
    ["2:1>0>4", 60],
    ["2:1>0>200", 40],
  ] as const) {
    const leg = sheet.legs[id]!;
    expect(leg.flowCfm).toBe(q);
    // Was velocity q/main8 (171.887 for 60 cfm), rule source and positive loss; ruling (c), P-102.
    expect(leg.velocityFpm).toBeNull();
    expect(leg.lossInWg).toBeNull();
    expect(leg.lossSource.ref).toBe("unpriced");
    expect(sheet.blockers.some((b) => b.kind === "not-priced" && b.detail.includes("outside table"))).toBe(true);
  }
  expect(collar.areaFt2).toBeLessThan(main8.areaFt2);
  expect(sheet.legs["2:1>0"]).toBeUndefined();
  // fix6, one way (FC-23 takeoffs 13885163, 9448322, 9448375): all 100 cfm turns toward the
  // grille. Qc is the real collar total, Qb/Qc 1, never the branch plus the main it turns into
  // (100/200, which priced every one-way supply split at half its flow ratio).
  const oneWay = buildCalc({
    ...input,
    inputs: inputsFor(calcSnapshot6, { endCfm: { 4: 100 } }),
  });
  expect(oneWay.paths.find((p) => p.end.elementId === 4)!.legIds).toEqual([
    "1:0>1",
    "2:1>0",
    "3:2>1",
    "4:0>",
  ]);
  const turn = oneWay.legs["2:1>0"]!;
  expect(turn.flowCfm).toBe(100);
  const cb1 = lookupGrid(grids["SD5-9"]!.Cb!, 1, collar.areaFt2 / main8.areaFt2).value;
  expect(turn.lossSource.ref).toContain(`SD5-9 Cb=${+cb1.toFixed(6)}`);
  expect(turn.lossSource.ref).toContain("all 100 cfm turns one way along the main");
  expect(turn.lossInWg).toBeCloseTo(cb1 * 0.075 * (100 / collar.areaFt2 / 1097) ** 2, 4);
  expect(
    sheet.notes.some((i) => i.kind === "merge" && i.text.startsWith("merge 2 branch loss:")),
  ).toBe(false);
  // Was no path blockers; ruling (c), P-102 leaves these out-of-range legs unpriced.
  expect(sheet.paths.flatMap((p) => p.blockerIds)).not.toEqual([]);
  const beyond = buildChain({
    ...input,
    start: { elementId: 100, connector: 0 },
    end: { elementId: 4 },
    direction: "supply",
    flowCfm: 100,
  });
  expect(beyond.path!.end).toMatchObject({ kind: "terminal", elementId: 4 });
});

it("an inline damper C# finds inside a walked duct is priced in series; without it the walk passes it by", () => {
  // Fan 700:0 -> duct 71 (0..10 ft, +x) -> grille 73 at x 10. Damper 72 sits inside 71 at x 7,
  // its ports 0.06 in apart and connected to nothing (Project A 13568060; ruling 2026-10-29).
  const half = 0.03 / 12;
  const fan = node(700, "equipment", {
    point: [0, 0, 0],
    connectors: [conn(0, [71, 0], round(8))],
  });
  const host = duct(
    71,
    10,
    round(8),
    [
      [0, 0, 0],
      [10, 0, 0],
    ],
    [conn(0, [700, 0], round(8), "end", [0, 0, 0]), conn(1, [73, 0], round(8), "end", [10, 0, 0])],
  );
  const grille = node(73, "terminal", {
    point: [10, 0, 0],
    connectors: [conn(0, [71, 1], round(8), "end", [10, 0, 0])],
  });
  const damper = node(72, "accessory", {
    family: "Damper_Volume_Round",
    point: [7, 0, 0],
    connectors: [
      { ...conn(1, null, round(8), "end", [7 + half, 0, 0]), facing: [1, 0, 0] },
      { ...conn(2, null, round(8), "end", [7 - half, 0, 0]), facing: [-1, 0, 0] },
    ],
  });
  const raw = snapshot([fan, grille, damper], [host]);
  const healthy = withHealth(raw);
  expect(healthy.issues.find((i) => i.kind === "inline")).toMatchObject({
    id: "inline:72",
    inline: { segmentId: 71, ports: [2, 1] },
  });
  const calcOf = (s: CalcSnapshot) =>
    buildCalc({
      snapshot: s,
      fan: { unitId: 700, portIndex: 0 },
      roster: [fanPort(700, 0)],
      grids,
      inputs: inputsFor(s, { endCfm: { 73: 200 }, drops: { 73: 0.03, 72: 0.05 } }),
    });
  const before = calcOf({ ...healthy, issues: healthy.issues.filter((i) => i.kind !== "inline") });
  const after = calcOf(healthy);
  const path = (s: ReturnType<typeof calcOf>) => s.paths.find((p) => p.side === "supply")!;
  expect(path(before).legIds).toEqual(["71:0>1", "73:0>"]);
  // Nearer the duct's far end, so it sits between that end and the grille; the duct keeps its length.
  expect(path(after).legIds).toEqual(["71:0>1", "72:2>1", "73:0>"]);
  expect(after.legs["72:2>1"]).toMatchObject({ flowCfm: 200, lossInWg: 0.05 });
  expect(after.legs["71:0>1"]!.lossInWg).toBeCloseTo(before.legs["71:0>1"]!.lossInWg!, 9);
  expect(path(after).knownInWg).toBeCloseTo(path(before).knownInWg! + 0.05, 9);
  expect(after.blockers).toEqual(before.blockers);
  // The input snapshot is never rewired.
  expect(host.connectors[1]!.connectedTo).toEqual({ elementId: 73, connector: 0 });
});

it("R-SHARE: a louver shared with a sibling's inlet carries both consumers; this fan's own legs carry its flow; the louver's stated flow is a cross-check", () => {
  // Intake: louver 30 -> plenum duct 13 -> tee 12 -> duct 11 -> unit 100:0 (inlet). Tee 12's third
  // mouth -> duct 14 -> sibling ERV 200:0 (its outdoor-air inlet; ERV 200:1 feeds grille 40).
  // Discharge: unit 100:1 -> grille 20. Mirrors Chadds MUAS-1 and louver 14088043 (2026-10-29).
  const muas = node(100, "equipment", {
    family: "MUAS",
    connectors: [conn(0, [11, 0], round(10)), conn(1, [20, 0], round(10))],
  });
  const erv = node(200, "equipment", {
    family: "ERV",
    connectors: [conn(0, [14, 1], round(6)), conn(1, [40, 0], round(6))],
    facts: [{ key: "fanFlow", value: 50, unit: "cfm", provenance: "designer-stated" }],
  });
  const tee = node(12, "fitting", {
    partType: "Tee",
    connectors: [
      conn(0, [11, 1], round(10)),
      conn(1, [13, 0], round(12)),
      conn(2, [14, 0], round(6)),
    ],
  });
  const louver = node(30, "terminal", {
    family: "Outdoor Louver",
    connectors: [conn(0, [13, 1], round(12), "end", [0, 0, 0], "OutdoorAir")],
  });
  const grille20 = node(20, "terminal", {
    family: "Supply Grille",
    connectors: [conn(0, [100, 1], round(10), "end", [0, 0, 0], "SupplyAir")],
  });
  const grille40 = node(40, "terminal", {
    family: "Supply Grille",
    connectors: [conn(0, [200, 1], round(6), "end", [0, 0, 0], "SupplyAir")],
  });
  const line = (a: number[], b: number[]) => [a, b];
  const d11 = duct(11, 10, round(10), line([0, 0, 0], [10, 0, 0]), [
    conn(0, [100, 0], round(10), "end", [0, 0, 0]),
    conn(1, [12, 0], round(10), "end", [10, 0, 0]),
  ]);
  const d13 = duct(13, 5, round(12), line([10, 0, 0], [15, 0, 0]), [
    conn(0, [12, 1], round(12), "end", [10, 0, 0]),
    conn(1, [30, 0], round(12), "end", [15, 0, 0]),
  ]);
  const d14 = duct(14, 4, round(6), line([10, 0, 0], [10, 4, 0]), [
    conn(0, [12, 2], round(6), "end", [10, 0, 0]),
    conn(1, [200, 0], round(6), "end", [10, 4, 0]),
  ]);
  const snap = snapshot([muas, erv, tee, louver, grille20, grille40], [d11, d13, d14]);
  const roster = [fanPort(100, 1, 0), fanPort(200, 1, 0)];
  const flowsOn = (sheet: ReturnType<typeof buildCalc>) => {
    const intake = sheet.paths.find((p) => p.side === "return" && p.end.elementId === 30)!;
    return intake.legIds.map((id) => [sheet.legs[id]!.elementId, sheet.legs[id]!.flowCfm]);
  };

  // The unit's design flow is typed (the side-stream exception), the louver states 1120.
  const typed = buildCalc({
    snapshot: snap,
    fan: { unitId: 100, portIndex: 1 },
    roster,
    grids,
    inputs: inputsFor(snap, { endCfm: { 100: 150, 20: 150, 30: 1120 } }),
  });
  expect(typed.fan).toMatchObject({ dischargePortIndex: 1, inletPortIndex: 0 });
  // Two fans sharing a trunk: the encounter is accepted with no static, so the shared legs carry the
  // total physical flow (asserted below) and the sibling's pressure is never summed into this fan's.
  expect(typed.encounters).toEqual([
    expect.objectContaining({
      host: { unitId: 200, portIndex: 1 },
      side: "return",
      verdict: "accepted",
      static: { kind: "none" },
    }),
  ]);
  expect(typed.blockers.some((b) => b.kind === "backflow")).toBe(false);
  expect(
    typed.claim.kind === "complete" ? typed.claim.requiredEspInWg : typed.claim.knownInWg,
  ).toBeCloseTo(typed.totals.supply.knownInWg + typed.totals.return.knownInWg, 6);
  expect(typed.paths.find((p) => p.side === "return" && p.end.fan?.unitId === 200)?.end.kind).toBe(
    "sibling-fan",
  );
  // Unit 100's own duct carries 150; from the tee out to the louver, 150 + the ERV's 50.
  expect(flowsOn(typed)).toEqual([
    [11, 150],
    [12, 200],
    [13, 200],
    [30, 200],
  ]);
  expect(typed.blockers.filter((b) => b.kind === "no-flow")).toEqual([]);
  expect(typed.notes).toContainEqual({
    kind: "sibling",
    text: expect.stringMatching(/^sibling F-200 draws 50 cfm from shared terminal .+: model:fanFlow$/),
    value: 50,
  });
  expect(typed.notes).toContainEqual({
    kind: "sibling",
    text: expect.stringMatching(/^shared terminal .+: consumers sum 200 cfm \(this fan 150, siblings 50\); the terminal states 1120 \(Work\)$/),
    value: 200,
  });

  // An ordinary fan (no unit flow) balances its intake from its discharge: the same flows.
  const ordinary = buildCalc({
    snapshot: snap,
    fan: { unitId: 100, portIndex: 1 },
    roster,
    grids,
    inputs: inputsFor(snap, { endCfm: { 20: 150, 30: 1120 } }),
  });
  expect(flowsOn(ordinary)).toEqual([
    [11, 150],
    [12, 200],
    [13, 200],
    [30, 200],
  ]);

  // A sibling with no design flow withholds the shared section with a no-flow of its own.
  const unknownSnap = snapshot(
    [muas, { ...erv, facts: [] }, tee, louver, grille20, grille40],
    [d11, d13, d14],
  );
  const unknown = buildCalc({
    snapshot: unknownSnap,
    fan: { unitId: 100, portIndex: 1 },
    roster,
    grids,
    inputs: inputsFor(unknownSnap, { endCfm: { 100: 150, 20: 150, 30: 1120 } }),
  });
  expect(flowsOn(unknown)).toEqual([
    [11, 150],
    [12, null],
    [13, null],
    [30, null],
  ]);
  expect(unknown.blockers.filter((b) => b.kind === "no-flow").map((b) => b.elementId)).toEqual([
    200,
  ]);
});

it("R-SHARE + C3: a proposed transition in front of a shared plenum carries this fan's own flow, not the plenum's sum; the louver's Revit flow is the cross-check", () => {
  // fix6 defects 3 and 5 (MUAS-1, 2026-10-29): MUAS-1's intake 14122436:1 ends 2.63 in short of
  // plenum 14106988's capped mouth; the plenum also feeds four ERVs (350 cfm in all). The proposed
  // transition was charged the plenum's 350 through MUAS-1's 10 in collar (642 fpm), not its 150.
  // Here: unit 100's intake duct 11 ends open 2.6 in from tee 12's mouth 0, capped by 900; the tee
  // feeds louver 30 and sibling ERV 200 (50 cfm). The louver states 1120 on its connector only.
  // The ERV discharges into unit 100's supply run through tap 42 (a co-supplier there, carrying
  // nothing of 100's), so the plenum is on unit 100's network, as Chadds' plenum is on MUAS-1's.
  const gap = 2.6 / 12;
  const muas = node(100, "equipment", {
    family: "MUAS",
    connectors: [conn(0, [11, 0], round(10)), conn(1, [21, 0], round(10))],
  });
  const erv = node(200, "equipment", {
    family: "ERV",
    connectors: [conn(0, [14, 1], round(6)), conn(1, [42, 1], round(6))],
    facts: [{ key: "fanFlow", value: 50, unit: "cfm", provenance: "designer-stated" }],
  });
  const tap42 = node(42, "fitting", {
    partType: "TapAdjustable",
    connectors: [
      conn(0, [21, 2], round(6), "curve", [-5, 0, 0]),
      conn(1, [200, 1], round(6), "end", [-5, 0, 0]),
    ],
  });
  const tee = node(12, "fitting", {
    partType: "Tee",
    connectors: [
      conn(0, [900, 0], round(12), "end", [10 + gap, 0, 0]),
      conn(1, [13, 0], round(12), "end", [10 + gap, 0, 0]),
      conn(2, [14, 0], round(6), "end", [10 + gap, 0, 0]),
    ],
  });
  const cap = node(900, "cap", {
    connectors: [conn(0, [12, 0], round(12), "end", [10 + gap, 0, 0])],
  });
  const louver = node(30, "terminal", {
    family: "Outdoor Louver",
    connectors: [
      { ...conn(0, [13, 1], round(12), "end", [15, 0, 0], "OutdoorAir"), flowCfm: 1120 },
    ],
  });
  const grille20 = node(20, "terminal", {
    family: "Supply Grille",
    connectors: [conn(0, [21, 1], round(10), "end", [-10, 0, 0], "SupplyAir")],
  });
  const line = (a: number[], b: number[]) => [a, b];
  const d21 = duct(21, 10, round(10), line([0, 0, 0], [-10, 0, 0]), [
    conn(0, [100, 1], round(10), "end", [0, 0, 0]),
    conn(1, [20, 0], round(10), "end", [-10, 0, 0]),
    conn(2, [42, 0], round(6), "curve", [-5, 0, 0]),
  ]);
  const d11 = duct(11, 10, round(10), line([0, 0, 0], [10, 0, 0]), [
    conn(0, [100, 0], round(10), "end", [0, 0, 0]),
    { ...conn(1, null, round(10), "end", [10, 0, 0]), facing: [1, 0, 0] },
  ]);
  const d13 = duct(13, 5, round(12), line([10 + gap, 0, 0], [15, 0, 0]), [
    conn(0, [12, 1], round(12), "end", [10 + gap, 0, 0]),
    conn(1, [30, 0], round(12), "end", [15, 0, 0]),
  ]);
  const d14 = duct(14, 4, round(6), line([10 + gap, 0, 0], [10 + gap, 4, 0]), [
    conn(0, [12, 2], round(6), "end", [10 + gap, 0, 0]),
    conn(1, [200, 0], round(6), "end", [10 + gap, 4, 0]),
  ]);
  // C#'s health for the open end, stated here (recording it needs a Revit run, health.fixture.ts):
  // the tee's capped mouth 2.6 in away, opposed and aligned, as DuctHealth reports 14106988:1.
  const snap: CalcSnapshot = {
    ...snapshot([muas, erv, tap42, tee, cap, louver, grille20], [d11, d13, d14, d21]),
    tolerances: { candidateBoxIn: 36, autoJoinGapIn: 1 },
    issues: [
      {
        id: "open-end:11:1",
        kind: "open-end",
        elementId: 11,
        connector: 1,
        point: [10, 0, 0],
        note: "nothing attached",
        near: {
          ports: [
            {
              elementId: 12,
              connector: 0,
              gapIn: 2.6,
              facingDot: -1,
              opposed: true,
              aligned: true,
              autoJoin: false,
              cappedBy: 900,
            },
          ],
          faces: [],
          bodies: [],
        },
      },
    ],
  };
  const sheet = buildCalc({
    snapshot: snap,
    fan: { unitId: 100, portIndex: 1 },
    roster: [fanPort(100, 1, 0), fanPort(200, 1, 0)],
    grids,
    inputs: inputsFor(snap, {
      // FANS-W2-COSUPPLY: grille 20 was 150, when a co-supplier's air was not counted at the terminal.
      // It is fed by unit 100 (150) and the ERV through tap 42 (50), so it states their sum; unit 100's
      // share, and every flow asserted below, is unchanged.
      endCfm: { 100: 150, 20: 200 },
      rulings: [{ pair: ["11:1", "12:0"], verdict: "accept" }],
    }),
  });
  const intake = sheet.paths.find((p) => p.side === "return" && p.end.elementId === 30)!;
  const fitting = intake.legIds.find((id) => id.startsWith("heal:") && id.includes(":fitting>"))!;
  expect(fitting).toBe("heal:11:1|12:0:fitting>12");
  // Defect 3: the transition carries unit 100's 150; from the tee out, 150 + the ERV's 50.
  expect(sheet.legs[fitting]!.flowCfm).toBe(150);
  expect(sheet.legs["heal:11:1|12:0:extension"]!.flowCfm).toBe(150);
  expect(sheet.legs["12:0>1"]!.flowCfm).toBe(200);
  if (sheet.legs[fitting]!.velocityFpm != null)
    expect(sheet.legs[fitting]!.velocityFpm).toBeCloseTo(150 / roundSection(10).areaFt2, 6);
  // Defect 5: the louver's airflow slot is empty, so its Revit connector flow is the cross-check.
  expect(sheet.notes).toContainEqual({
    kind: "sibling",
    text: expect.stringMatching(/^shared terminal .+: consumers sum 200 cfm \(this fan 150, siblings 50\); the terminal states 1120 \(model:connector Flow\)$/),
    value: 200,
  });
});

// UI5 defect 5 (2026-10-29): the fittings census listed FC-23's assumed tee 13771256|13771267 on
// MUAS-1's sheet at loss 0 with no rule: the walk priced a heal whose landing it had already
// walked, so no end of MUAS-1 crosses it. The census is the fittings this fan's paths cross.
const GROUNDING = "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/muas-grounding/";
it.skipIf(
  !existsSync(`${GROUNDING}from-muas-t.json`) || !existsSync(`${GROUNDING}from-louver.json`),
)(
  "MUAS-1's fittings census lists only fittings its paths cross",
  () => {
    // Kept: an untyped file boundary (a retained host capture outside git), not a constructed shape.
    const load = (n: string) =>
      JSON.parse(readFileSync(`${GROUNDING}${n}.json`, "utf8")) as DuctSnapshot;
    const a = load("from-muas-t"),
      b = load("from-louver");
    const union = <T extends { id: number; reason?: string | null }>(x: T[], y: T[]) => {
      const m = new Map(x.map((e) => [e.id, e]));
      for (const e of y)
        if (!m.has(e.id) || (m.get(e.id)!.reason ?? "walked") !== "walked") m.set(e.id, e);
      return [...m.values()];
    };
    const snap: DuctSnapshot = {
      ...a,
      nodes: union(a.nodes, b.nodes),
      segments: union(a.segments, b.segments),
    };
    const r = suggestRoster(snap);
    const sheet = buildCalc({
      snapshot: snap,
      grids: {},
      roster: [...r.fans, ...r.suggestions],
      fan: { unitId: 14577391, portIndex: 2 },
      inputs: inputsFor(snap, {
        rulings: [{ pair: ["14122436:1", "14106988:1"], verdict: "accept" }],
        endCfm: { 14577391: 150, 6105264: 35, 6953852: 50 },
      }),
    });
    // The walk did price the cut heal: its legs exist, on no path.
    expect(
      Object.keys(sheet.assumed.legs).some((id) => id.startsWith("heal:13771256:0|13771267:1")),
    ).toBe(true);
    const keys = sheet.fittings.map((f) => f.key);
    expect(keys.filter((k) => k.includes("13771256"))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
    // Every element row is a fitting some path leg (known or assumed) is charged to or passes.
    const crossed = new Set(
      [...sheet.paths, ...sheet.assumed.paths].flatMap((p) =>
        p.legIds.map((id) => (sheet.legs[id] ?? sheet.assumed.legs[id])!.elementId),
      ),
    );
    const walked = new Set(sheet.walkedElementIds);
    for (const f of sheet.fittings.filter((x) => x.elementId != null))
      expect(walked.has(f.elementId!) || crossed.has(f.elementId!)).toBe(true);
    expect(keys).toContain("proposed:14106988:1|14122436:1>14106988");
  },
  120_000,
);

it("a missing terminal flow withholds path completeness and required ESP", () => {
  const inputs = inputsFor(network);
  inputs.terminals["6"]!.cfm = {
    value: null,
    source: "none",
    author: null,
    ref: null,
    units: "cfm",
    version: null,
    status: "missing",
  };
  const sheet = buildCalc({
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs,
  });
  expect(sheet.claim.kind).toBe("incomplete");
  expect(sheet.totals.supply.worstPath).toBeNull();
  expect(sheet.totals.requiredEspInWg).toBeNull();
  expect(sheet.blockers.some((b) => b.kind === "no-flow")).toBe(true);
});

it("resolved unit flow and walked terminal sum remain visible when they disagree", () => {
  const input = inputsFor(network, {
    roles: { 100: "fan" },
    endCfm: { 100: 1200, 6: 200, 8: 100, 10: 300 },
  });
  const sheet = buildCalc({
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: input,
  });
  expect(sheet.notes.find((n) => n.kind === "flow-conflict")?.text).toContain("1200 cfm (Work");
  expect(sheet.notes.find((n) => n.kind === "flow-conflict")?.text).toContain("walked end sum");
});

it("model fan flow conflict names its slot and the terminal sum", () => {
  const snap = structuredClone(network);
  snap.nodes
    .find((n) => n.id === 100)!
    .facts.push({ key: "fanFlow", value: 1200, unit: "cfm", provenance: "designer-stated" });
  snap.slots = {
    ...TEST_SLOTS,
    fanFlow: "PE_M_Fan_AirFlow",
  };
  const sheet = buildCalc({
    snapshot: snap,
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(snap, { roles: { 100: "fan" }, endCfm: { 6: 642, 8: 300, 10: 942 } }),
  });
  expect(sheet.notes.find((n) => n.kind === "flow-conflict")).toMatchObject({
    value: 258,
    text: expect.stringContaining(
      "1200 cfm (model:PE_M_Fan_AirFlow) conflicts with 942 cfm (walked end sum)",
    ),
  });
});

it("lost native coverage never reads complete, and typed evidence reproduces each leg's loss without its text", () => {
  const input = {
    fan: { unitId: 100, portIndex: 0 },
    roster: [fanPort(100, 0, 1)],
    grids,
    inputs: inputsFor(network, {
      endCfm: { 6: 200, 8: 100, 10: 300 },
      drops: { 6: 0.05, 8: 0.08, 10: 0.03 },
    }),
  };
  const walk = { startId: 100, hops: 1, elementsReached: 1, openEnds: 0, candidates: [], truncated: false, elapsedMs: 0, unreadPeers: [] };
  const whole = buildCalc({ ...input, snapshot: { ...network, walk } });
  expect(whole.claim.kind).toBe("complete");
  const unread = buildCalc({
    ...input,
    snapshot: { ...network, walk: { ...walk, unreadPeers: [{ elementId: 3, connector: 1 }] } },
  });
  expect(unread.claim).toMatchObject({
    kind: "incomplete",
    coverage: [{ kind: "native-peer", elementId: 3, ref: "3:1" }],
  });
  expect(unread.totals.requiredEspInWg).toBeNull();
  expect(
    buildCalc({ ...input, snapshot: { ...network, walk: { ...walk, truncated: true } } }).claim,
  ).toMatchObject({ kind: "incomplete", coverage: [{ kind: "budget" }] });
  expect(
    buildCalc({ ...input, snapshot: { ...network, reach: { unreadPeers: [], complete: false } } }).claim,
  ).toMatchObject({ kind: "incomplete", coverage: [{ kind: "native-peer", elementId: null }] });
  // P-035: this fan's own system seed read failed (`DuctRef(systemId, -1)`): never complete.
  expect(
    buildCalc({ ...input, snapshot: { ...network, walk, reach: { unreadPeers: [{ elementId: 555, connector: -1 }], complete: false } } }).claim,
  ).toMatchObject({ kind: "incomplete", coverage: [{ kind: "native-peer", elementId: null, ref: "system 555 seed read failed" }] });
  const kinds = new Set<string>();
  for (const leg of Object.values(whole.legs)) {
    const e = leg.evidence;
    kinds.add(e.kind);
    if (e.kind === "coefficient")
      expect(e.coefficient * e.velocityPressureInWg).toBeCloseTo(leg.lossInWg!, 4);
    if (e.kind === "drop") expect(e.value).toMatchObject({ status: "valid", value: leg.lossInWg });
  }
  expect([...kinds].sort()).toEqual(["coefficient", "drop", "friction"]);
  expect(whole.legs["9:0>1"]!.evidence).toMatchObject({
    kind: "friction",
    lengthFt: 20,
    roughnessFt: 0.0003,
    hydraulicDiameterFt: expect.closeTo(8 / 12, 6),
  });
});

it("H5 through two real calcs: a guest discharging into a host's supply trunk is backflow, never complete unruled, and mutual acceptance is a cycle", () => {
  // Host 200:0 -> duct 20 -> tee 40 -> duct 41 -> grille 42; guest 300:0 -> duct 30 -> the same tee.
  // Each unit returns through its own duct and grille (22 -> 23, 32 -> 33).
  const two = (id: number, out: number, back: number) =>
    node(id, "equipment", {
      connectors: [conn(0, [out, 0], round(8)), { ...conn(1, [back, 0], round(8)), direction: "in" }],
    });
  const run = (id: number, from: [number, number], to: [number, number]) =>
    duct(id, 10, round(8), [[0, 0, 0], [10, 0, 0]], [conn(0, from, round(8)), conn(1, to, round(8))]);
  const tee40 = node(40, "fitting", {
    partType: "Tee",
    connectors: [conn(0, [20, 1], round(8)), conn(1, [41, 0], round(8)), conn(2, [30, 1], round(8))],
  });
  const grille = (id: number, from: number, cls?: string) =>
    node(id, "terminal", { connectors: [conn(0, [from, 1], round(8), "end", [0, 0, 0], cls)] });
  const network = (supply?: string, back?: string) => snapshot(
    [two(200, 20, 22), two(300, 30, 32), tee40, grille(42, 41, supply), grille(23, 22, back), grille(33, 32, back)],
    [run(20, [200, 0], [40, 0]), run(30, [300, 0], [40, 2]), run(41, [40, 1], [42, 0]), run(22, [200, 1], [23, 0]), run(32, [300, 1], [33, 0])],
  );
  const snap = network("SupplyAir", "ReturnAir");
  const roster = [fanPort(200, 0, 1), fanPort(300, 0, 1)];
  const inputs = inputsFor(snap, {
    roles: { 200: "fan", 300: "fan" },
    endCfm: { 42: 300, 23: 200, 33: 100, 200: 200, 300: 100 },
    drops: { 40: 0.04, 42: 0.03, 23: 0.03, 33: 0.03 },
  });
  const calc = (unitId: number, rulings: { elementId: number; connector: number }[] = []) =>
    buildCalc({
      snapshot: snap,
      fan: { unitId, portIndex: 0 },
      roster,
      grids,
      inputs,
      encounterRulings: rulings.map((at) => ({ at, verdict: "accepted" as const, by: "human" as const, ref: "work:test" })),
    });
  const guest = calc(300);
  // Unruled: an error at the tee, a boundary, never complete. Duct 41 is the shared trunk.
  expect(guest.claim).toMatchObject({ kind: "to-boundary", blockingIds: ["backflow:40:0"] });
  expect(guest.encounters).toEqual([
    {
      fan: { unitId: 300, portIndex: 0 },
      host: { unitId: 200, portIndex: 0 },
      elementId: 40,
      connector: 0,
      side: "supply",
      verdict: "unruled",
      static: { kind: "none" },
    },
  ]);
  expect(guest.issues.find((i) => i.id === "backflow:40:0")).toMatchObject({
    kind: "backflow",
    severity: "blocking",
    closer: { kind: "encounter" },
  });
  // FANS-W2-COSUPPLY: grille 42's stated 300 is both suppliers' air. The guest's own run carries its
  // 100 (300 less the host's 200); from the tee out, the shared trunk carries the physical 300.
  expect(guest.legs["30:0>1"]!.flowCfm).toBe(100);
  expect(guest.legs["41:0>1"]!.flowCfm).toBe(300);
  // Map rule 6: each fan prices shared duct 41 on its own sheet, after its own run and never the other's.
  const host = calc(200);
  // Both sheets charge duct 41 its loss at the physical 300 cfm, and each charges its own run to the tee:
  // the host's duct 20 at 200 cfm, the guest's duct 30 at 100, neither on the other's sheet.
  expect(host.legs["41:0>1"]!.lossInWg).toBeGreaterThan(0);
  expect(host.legs["41:0>1"]!.lossInWg).toBe(guest.legs["41:0>1"]!.lossInWg);
  expect(host.legs["20:0>1"]!.lossInWg).toBeGreaterThan(guest.legs["30:0>1"]!.lossInWg!);
  expect(Object.keys(host.legs)).not.toContain("30:0>1");
  expect(Object.keys(guest.legs)).not.toContain("20:0>1");
  // P-028: the same calc over a snapshot that read no coverage is incomplete and says so.
  expect(
    buildCalc({ snapshot: { ...snap, walk: undefined }, fan: { unitId: 300, portIndex: 0 }, roster, grids, inputs }).claim,
  ).toMatchObject({
    kind: "incomplete",
    coverage: [{ kind: "native-peer", elementId: null, ref: "coverage unread: the snapshot carries no walk and no reach" }],
  });
  // Unclassified grilles: the only thing the supply side meets is the host's discharge, which is the
  // encounter and no vote on direction. The guest gets the backflow and no direction mismatch.
  const bare = network();
  const plain = buildCalc({
    snapshot: bare,
    fan: { unitId: 300, portIndex: 0 },
    roster,
    grids,
    inputs: inputsFor(bare, {
      roles: { 200: "fan", 300: "fan" },
      endCfm: { 42: 300, 23: 200, 33: 100, 200: 200, 300: 100 },
      drops: { 40: 0.04, 42: 0.03, 23: 0.03, 33: 0.03 },
    }),
  });
  expect(plain.fan.directionMismatch).toBeNull();
  expect(plain.encounters).toHaveLength(1);
  expect(plain.claim).toMatchObject({ kind: "to-boundary", blockingIds: ["backflow:40:0"] });
  const mine = { elementId: 40, connector: 0 };
  const theirs = { elementId: 40, connector: 2 };
  // Accepted here, but the host's own calc is unruled at the same tee: no number, never complete.
  expect(calc(300, [mine]).claim).toMatchObject({
    kind: "incomplete",
    coverage: [{ kind: "host-calc", elementId: 40, ref: "host 200:0 calc is to-boundary" }],
  });
  // Both accepted: each waits on the other. A cycle, never complete, from either side.
  for (const id of [300, 200])
    expect(calc(id, [mine, theirs]).claim).toMatchObject({
      kind: "incomplete",
      coverage: [{ kind: "cycle" }],
    });
  // A complete host answers, but this walk already prices beyond N, so H5 adds zero.
  const complete = {
    kind: "complete",
    basis: host.basis,
    requiredEspInWg: 1,
    coverage: [],
    blockingIds: [],
  } as const;
  const withHost = (network: string) =>
    buildCalc({
      snapshot: snap,
      fan: { unitId: 300, portIndex: 0 },
      roster,
      grids,
      inputs,
      encounterRulings: [{ at: mine, verdict: "accepted", by: "human", ref: "work:test" }],
      hosts: new Map([["200:0", { ...host, claim: complete, network }]]),
    });
  const answered = withHost(host.network);
  const tieIn = 0; // Old add-on: host.legs["20:0>1"].lossInWg (spent upstream loss).
  expect(answered.encounters[0]!.static).toMatchObject({
    kind: "host-calc",
    basis: host.basis,
    inWg: expect.closeTo(tieIn, 6),
  });
  const supply = answered.paths.filter((p) => p.side === "supply");
  expect(answered.claim).toMatchObject({
    kind: "complete",
    requiredEspInWg: expect.closeTo(
      Math.max(supply[0]!.knownInWg, supply.find((p) => p.end.fan)!.knownInWg + tieIn) +
        answered.totals.return.knownInWg,
      5,
    ),
  });
  // Backflow stays on the calc as an error after the ruling, no longer blocking.
  expect(answered.issues.find((i) => i.kind === "backflow")).toMatchObject({ severity: "warning" });
  expect(answered.blockers.find((b) => b.kind === "backflow")!.detail).toContain("assumes the host is balanced");
  // Clause 5: rated 0.8 < required 1.0: acceptance cannot complete or mint a write.
  const deadhead = buildCalc({
    snapshot: snap, fan: { unitId: 300, portIndex: 0 }, roster, grids, inputs,
    encounterRulings: [{ at: mine, verdict: "accepted", by: "human", ref: "work:test" }],
    hosts: new Map([["200:0", { ...host, claim: complete, esp: {
      rated: resolveValue({ model: { value: 0.8, author: null, ref: "rated" } }),
    } }]]),
  });
  expect(deadhead.claim).toMatchObject({ kind: "incomplete", blockingIds: ["backflow:40:0"] });
  expect(deadhead.issues.find((i) => i.kind === "backflow")).toMatchObject({ severity: "blocking" });
  expect(deadhead.blockers.find((b) => b.kind === "backflow")!.detail).toContain("backflow/deadhead");
  expect(deadhead.totals.requiredEspInWg).toBeNull();
  expect(deadhead.issues.find(i => i.kind === "backflow")!.closer.kind).toBe("none");
  const unruledDeadhead = buildCalc({ snapshot: snap, fan: { unitId: 300, portIndex: 0 }, roster, grids, inputs,
    hosts: new Map([["200:0", { ...host, claim: complete, esp: { rated: resolveValue({ model: { value: 0.8, author: null, ref: "rated" } }) } }]]) });
  expect(unruledDeadhead.claim.kind).toBe("incomplete");
  expect(unruledDeadhead.issues.find(i => i.kind === "backflow")!.closer.kind).toBe("none");
  // The capability check runs before the input/context; no mint can reach native preview.
  expect(() => mintWriteRequest(deadhead.claim as never, deadhead, {} as never, {} as never)).toThrow("complete claim");
  expect(withHost("stale").claim).toMatchObject({
    kind: "incomplete",
    coverage: [{ kind: "host-calc", ref: "host 200:0 calc is at a stale basis" }],
  });
});
