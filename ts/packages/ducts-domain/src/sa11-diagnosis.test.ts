/**
 * SA 11 on Chadds (gate 39b24c0f, 2026-11-11): `ducts.pricing` failed its own output contract
 * (`componentFlows[0..2].componentWitness[0].element.id` must be > 0), every Design cell locked,
 * and the roster row kept reading "Supply · 13 terminals · no fan" though the walk holds FC-11.
 *
 * One cut fixture shows both: a branch end 0.3 in off a main's side is an inferred tap
 * (`tolerate`, proximity.ts: virtual `Tap` fitting with a NEGATIVE id). `price` hands that
 * tolerated snapshot to `designCircuits`, whose component witness copies the element id into a
 * contract that demands a positive one. The host's `ducts.pricing` parse then throws, no `analysis`
 * exists, and the web falls back to the roster's rows (screen.tsx `analysis?.systems ?? roster.rows`),
 * which carry no groups and no baseEquipmentId, so no unit.
 *
 * Both are `test.fails`: they pass while the cause stands. Flip to `test` when the owner's fix lands.
 * The fixture is a minimal stand-in (equipment, 2 ducts, 2 grilles, one inferred tap); the Chadds
 * snapshot itself was not captured whole, so that SA 11 holds an inferred tap or inline part is UNPROVEN.
 */
import { ductsPricingData, ductComponentWitnessSchema, neutralFansWork } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";

import { price } from "./pricing.ts";
import { pricingResult } from "./pricing-result.ts";
import { TEST_SLOTS } from "./sheet/test-inputs.ts";
import { systemList } from "./system-list.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];

const IN = 1 / 12;
const uid = (id: number) =>
  `6d52156a-3876-4d76-b641-341454252f26-${id.toString(16).padStart(8, "0")}`;
const port = (
  index: number,
  point: number[],
  to: { elementId: number; connector: number } | null,
) => ({
  index,
  kind: "end",
  point,
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  direction: "bidirectional",
  classification: "SupplyAir",
  connectedTo: to,
  areaFt2: 0.196,
});
const node = (
  id: number,
  kind: string,
  point: number[],
  connectors: unknown[],
  facts: unknown[] = [],
) =>
  ({
    id,
    kind,
    category: kind,
    family: kind === "equipment" ? "Air Handler" : kind,
    type: "Standard",
    partType: null,
    levelId: 1,
    point,
    groupId: "g1",
    systemName: "SA 11",
    classification: "Supply Air",
    connectors,
    facts,
    uniqueId: uid(id),
  }) as unknown as Node;
const duct = (id: number, a: number[], b: number[], ca: unknown, cb: unknown) =>
  ({
    id,
    kind: "duct",
    curveKind: "line",
    type: "Round Duct",
    shape: "round",
    size: '6"ø',
    diameterIn: 6,
    lengthFt: Math.hypot(...a.map((v, i) => v - b[i]!)),
    polyline: [a, b],
    levelId: 1,
    groupId: "g1",
    systemName: "SA 11",
    classification: "Supply Air",
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: [port(1, a, ca as never), port(2, b, cb as never)],
    uniqueId: uid(id),
  }) as unknown as Segment;

/** FC-11 (equipment 1, rootId) -> main duct 10 -> grille 30; branch duct 11 ends 0.3 in off the main's side -> grille 31. */
const snapshot = (branchGapFt = 3.3 * IN): DuctSnapshot =>
  ({
    coordinateEncoding: "native-double",
    document: {
      title: "t",
      readAt: "2026-11-11T00:00:00Z",
      elapsedMs: 1,
      networkBasedCalculations: true,
    },
    levels: [],
    groups: [
      {
        id: "g1",
        rootIds: [1],
        classifications: ["Supply Air"],
        systemNames: ["SA 11"],
        terminalCount: 2,
        elementCount: 5,
        loops: 0,
        issueIds: ["open-end:11:1"],
      },
    ],
    nodes: [
      node(
        1,
        "equipment",
        [0, 0, 0],
        [port(1, [0, 0, 0], { elementId: 10, connector: 1 })],
        [
          { key: "mark", text: "FC-11", unit: "", provenance: "designer-stated" },
          { key: "fanFlow", value: 200, unit: "cfm", provenance: "revit-reported" },
        ],
      ),
      node(
        30,
        "terminal",
        [20, 0, 0],
        [port(1, [20, 0, 0], { elementId: 10, connector: 2 })],
        [{ key: "flow", value: 100, unit: "cfm", provenance: "revit-reported" }],
      ),
      node(
        31,
        "terminal",
        [10, 10, 0],
        [port(1, [10, 10, 0], { elementId: 11, connector: 2 })],
        [{ key: "flow", value: 100, unit: "cfm", provenance: "revit-reported" }],
      ),
    ],
    segments: [
      duct(
        10,
        [0, 0, 0],
        [20, 0, 0],
        { elementId: 1, connector: 1 },
        { elementId: 30, connector: 1 },
      ),
      duct(11, [10, branchGapFt, 0], [10, 10, 0], null, { elementId: 31, connector: 1 }),
    ],
    flows: [],
    issues: [
      {
        id: "open-end:11:1",
        kind: "open-end",
        elementId: 11,
        connector: 1,
        point: [10, branchGapFt, 0],
        note: "nothing attached",
      },
    ],
    layers: [],
    systems: [
      {
        id: 99,
        name: "SA 11",
        classification: "SupplyAir",
        baseEquipmentId: null,
        criticalPath: [],
        sections: [],
      },
    ],
    slots: { ...TEST_SLOTS },
  }) as unknown as DuctSnapshot;

/** The host's wire(): Maps and Sets become objects and arrays before the contract parses them (apps/web ducts/host.ts). */
function wire(value: unknown): unknown {
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([k, v]) => [String(k), wire(v)]));
  if (value instanceof Set) return [...value].map(wire);
  if (Array.isArray(value)) return value.map(wire);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, wire(v)]),
    );
  return value;
}

// DEFECT 2. Producer: proximity.ts `tolerate` mints `id = -(i + 1)` for the tap; losses.ts:666
// `designCircuits(snapshot...)` runs on that tolerated snapshot; component-flows.ts:369-385 copies
// `element: { id }`; agent-contracts/src/ducts.ts:79-82 `elementIdentity.id` is `.positive()`.
test.fails("every component witness element id the pricing emits is a positive Revit id", () => {
  const priced = price(snapshot(), {}, null, neutralFansWork);
  const ids = priced.next.design.componentFlows.flatMap((c) =>
    c.componentWitness.map((w) => w.element.id),
  );
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.filter((id) => !(id > 0))).toEqual([]);
  for (const c of priced.next.design.componentFlows)
    expect(ductComponentWitnessSchema.safeParse(c.componentWitness).success).toBe(true);
});

// DEFECT 1. The walk holds FC-11 as a root, so a priced row would read "FC-11" (system-scope.ts:61-64).
// But the host parses the pricing result through `ductsPricingData` (apps/web/src/ducts/host.ts:166-178);
// the parse throws on the negative id, no analysis row exists, and screen.tsx:331 shows the roster row,
// whose `units` come only from `baseEquipmentId` (system-list.ts:19-30), null on every Chadds system.
const hostParse = (raw: DuctSnapshot) =>
  ductsPricingData
    .omit({
      espOptions: true,
      espOptionsError: true,
      fanRows: true,
      design: true,
      effectiveDesign: true,
      network: true,
      ductsWork: true,
      fansWork: true,
      catalogFindings: true,
      criteria: true,
      firm: true,
    })
    .parse(wire(pricingResult(raw, {}, {}, null)));
const rowOf = (raw: DuctSnapshot) =>
  hostParse(raw).analysis.systems.find((row) => row.key === "SA 11")?.sub;

test.fails("a walked system with a root unit prices and its row names the unit, not 'no fan'", () => {
  expect(rowOf(snapshot())).toContain("FC-11");
});

// CONTROL (green): the same network with the branch end 3 ft clear of the main (no inferred tap, no
// negative id) passes the host's contract and its row names FC-11. The tap is the only difference.
test("control: with no inferred tap the same network passes the contract and names FC-11", () => {
  expect(rowOf(snapshot(3))).toContain("FC-11");
});

// The roster half of defect 1, green: the roster fallback row has no way to name a unit.
test("the roster-only row (no groups, no baseEquipmentId) says no fan, the walked row says FC-11", () => {
  const raw = snapshot();
  const roster = { ...raw, groups: [], segments: [], issues: [] } as DuctSnapshot;
  expect(systemList(roster, null).find((r) => r.key === "SA 11")?.sub).toContain("no fan");
  expect(systemList(raw, null).find((r) => r.key === "SA 11")?.sub).toContain("FC-11");
});
