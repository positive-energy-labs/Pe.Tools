/** Deterministic heal proposals. Points are model feet. */
import { expect, it } from "vite-plus/test";
import { ductsDocumentSchema } from "@pe/agent-contracts";

import { HEAL_JOIN_GAP_IN, healPlan, healRequestGroup, proximityId } from "./heal.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Segment["connectors"][number];

const IN = 1 / 12;
const conn = (index: number, point: number[], facing?: number[], d = 6): Connector => ({
  index,
  kind: "end",
  point,
  shape: "round",
  size: `${d}"ø`,
  diameterIn: d,
  direction: "bidirectional",
  classification: "SupplyAir",
  connectedTo: null,
  ...(facing ? { facing } : {}),
});
const duct = (
  id: number,
  a: number[],
  b: number[],
  over: Partial<Segment> = {},
  d = 6,
): Segment => ({
  id,
  kind: "duct",
  curveKind: "line",
  type: "Round Duct",
  shape: "round",
  size: `${d}"ø`,
  diameterIn: d,
  lengthFt: Math.hypot(...a.map((v, k) => v - b[k]!)),
  polyline: [a, b],
  levelId: 1,
  groupId: `g${id}`,
  systemName: "SA 1",
  classification: "Supply Air",
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: [conn(0, a, undefined, d), conn(1, b, undefined, d)],
  uniqueId: null,
  ...over,
});
const node = (id: number, kind: Node["kind"], connectors: Connector[]): Node => ({
  id,
  kind,
  category: kind === "terminal" ? "Air Terminals" : "Duct Fittings",
  family: kind,
  type: null,
  partType: kind === "fitting" ? "Elbow" : null,
  levelId: 1,
  point: connectors[0]!.point,
  groupId: `g${id}`,
  systemName: "SA 1",
  classification: "Supply Air",
  connectors,
  facts: [],
  uniqueId: null,
});
const snap = (segments: Segment[], nodes: Node[] = []): DuctSnapshot => {
  const elements = [...segments, ...nodes];
  const issues = elements.flatMap((e) =>
    e.connectors
      .filter((c) => !c.connectedTo)
      .map((c) => ({
        id: `open-end:${e.id}:${c.index}`,
        kind: "open-end" as const,
        elementId: e.id,
        connector: c.index,
        point: c.point,
        note: "nothing attached",
      })),
  );
  return {
    coordinateEncoding: "native-double",
    document: {
      title: "t",
      readAt: "2026-10-20T00:00:00Z",
      elapsedMs: 1,
      networkBasedCalculations: true,
    },
    levels: [],
    groups: elements.map((e) => ({
      id: e.groupId!,
      rootIds: [],
      classifications: ["Supply Air"],
      systemNames: [e.systemName ?? "SA 1"],
      terminalCount: e.kind === "terminal" ? 1 : 0,
      elementCount: 1,
      loops: 0,
      issueIds: issues.filter((i) => i.elementId === e.id).map((i) => i.id),
    })),
    nodes,
    segments,
    flows: [],
    issues,
    layers: [],
    systems: [],
    slots: {
      fanStatic: "",
      fanFlow: "",
      componentDrop: "",
      fittingCoefficient: "",
      terminalFlow: "",
    },
  } as DuctSnapshot;
};
const items = (s: DuctSnapshot) => healPlan(s).groups.flatMap((g) => g.items);

it("caps a dangling duct end, and only that end", () => {
  // 10 and 11 meet at x=10 ft (coincident); 10's far end dangles; 11's far end dangles too.
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0])]);
  const plan = healPlan(s);
  const caps = items(s).filter((i) => i.kind === "cap");
  expect(caps.map((i) => i.end).sort()).toEqual(["10:0", "11:1"]);
  expect(plan.covered.has("open-end:10:0")).toBe(true);
});

it("never pairs two ends Revit already connects through a bend; each is a cap", () => {
  // A 1 in stub (20) and a riser (21) joined by an elbow, all one Revit group: their loose ends
  // are 28 in apart, which once read as a gap to close.
  const g = { groupId: "g20" };
  const s = snap([
    duct(20, [0, 0, 0], [0, 0, IN], g),
    duct(21, [0, 0, 0.5], [0, 0, 0.5 + 29 * IN], g),
  ]);
  s.segments[0]!.connectors[1]!.connectedTo = { elementId: 30, connectorIndex: 1 } as never;
  s.segments[1]!.connectors[0]!.connectedTo = { elementId: 30, connectorIndex: 2 } as never;
  const plan = items(s);
  expect(plan.filter((i) => i.kind === "join")).toEqual([]);
  expect(
    plan
      .filter((i) => i.kind === "cap")
      .map((i) => i.end)
      .sort(),
  ).toEqual(["20:0", "21:1"]);
});

it("connects coincident same-size ends, covering the inferred join and both open ends", () => {
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0])]);
  const join = items(s).find((i) => i.kind === "join")!;
  expect(join).toMatchObject({ how: "connect", end: "10:1", other: "11:0", gapIn: 0 });
  expect(join.covers).toEqual([proximityId("11:0", "10:1"), "open-end:10:1", "open-end:11:0"]);
  // Groups are the page's: the inferred join already bridged g11 into g10.
  expect(healPlan(s).groups.map((g) => g.group)).toEqual(["g10"]);
  // Ends past the route's bridging tolerance stay in their own groups; a join between them is listed under both.
  const apart = snap([
    duct(10, [0, 0, 0], [10, 0, 0]),
    duct(11, [10 + 2.5 * IN, 0, 0], [20, 0, 0]),
  ]);
  const union = items(apart).find((i) => i.kind === "join")!;
  expect(
    healPlan(apart)
      .groups.filter((g) => g.items.includes(union))
      .map((g) => g.group),
  ).toEqual(["g10", "g11"]);
});

it("bridges a 2 in collinear gap between two ducts with a union, and from a duct to a fitting by extending the duct", () => {
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10 + 2 * IN, 0, 0], [20, 0, 0])]);
  expect(items(s).find((i) => i.kind === "join")).toMatchObject({ how: "union" });
  const elbow = node(30, "fitting", [
    conn(0, [10 + 2 * IN, 0, 0], [-1, 0, 0]),
    { ...conn(1, [11, 1, 0], [0, 1, 0]), connectedTo: { elementId: 99, connector: 0 } },
  ]);
  const t = snap([duct(10, [0, 0, 0], [10, 0, 0])], [elbow]);
  expect(items(t).find((i) => i.kind === "join")).toMatchObject({
    how: "extend",
    end: "10:1",
    other: "30:0",
  });
});

it("leaves size changes, two systems, long or skewed gaps and terminals to a person, with the reason", () => {
  const sized = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0], {}, 8)]);
  expect(items(sized).some((i) => i.kind === "join")).toBe(false);
  expect(healPlan(sized).hard.get(proximityId("10:1", "11:0"))?.note).toMatch(
    /differ in size: a transition\. Fix it in Revit/,
  );

  const systems = snap([
    duct(10, [0, 0, 0], [10, 0, 0]),
    duct(11, [10, 0, 0], [20, 0, 0], { systemName: "SA 2" }),
  ]);
  expect(healPlan(systems).hard.get(proximityId("10:1", "11:0"))?.note).toMatch(/merges systems/);

  const far = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10 + 6 * IN, 0, 0], [20, 0, 0])]);
  expect(healPlan(far).hard.get(proximityId("10:1", "11:0"))?.note).toMatch(
    new RegExp(`past the ${HEAL_JOIN_GAP_IN} in heal limit`),
  );

  const skew = snap([
    duct(10, [0, 0, 0], [10, 0, 0]),
    duct(11, [10 + 2 * IN, 1 * IN, 0], [20, 1 * IN, 0]),
  ]);
  expect(healPlan(skew).hard.get(proximityId("10:1", "11:0"))?.note).toMatch(/not on one axis/);

  const grille = node(40, "terminal", [conn(0, [30, 0, 0], [0, 0, -1])]);
  const lone = snap([], [grille]);
  expect(items(lone)).toEqual([]);
  expect(healPlan(lone).hard.get("open-end:40:0")?.note).toMatch(/terminal is not connected/);
});

it("caps a dangling fitting end, never one a person ignored", () => {
  const tee = node(50, "fitting", [conn(0, [0, 0, 0], [-1, 0, 0])]);
  expect(items(snap([], [tee]))).toMatchObject([{ kind: "cap", end: "50:0" }]);
  const work = ductsDocumentSchema.parse({
    assumptions: {
      "open-end:50:0": { edit: { value: { kind: "verdict", verdict: "ignore" } } },
    },
  });
  expect(healPlan(snap([], [tee]), work).groups).toEqual([]);
});

it("sends the native op keys, kinds and connector keys only, filtered to the approved items", () => {
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0])]);
  const group = healPlan(s).groups.find((g) => g.group === "g10")!;
  expect(healRequestGroup(group)).toEqual({
    group: "g10",
    items: [
      { key: "cap:10:0", kind: "cap", end: "10:0" },
      { key: "join:10:1|11:0", kind: "join", end: "10:1", other: "11:0" },
      { key: "cap:11:1", kind: "cap", end: "11:1" },
    ],
  });
  expect(healRequestGroup(group, new Set(["cap:10:0"])).items).toHaveLength(1);
});

it("never caps an end Revit gives a flow: the air leaves there (Chadds EX 1 11620957:1)", () => {
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0])]);
  s.segments[0]!.connectors[1]!.flowCfm = 444;
  expect(items(s).map((i) => i.end)).toEqual(["10:0"]);
  expect(healPlan(s).hard.get("open-end:10:1")?.note).toMatch(/carries 444 cfm in Revit; a cap would block its air/);
});

it("never caps an end C# marks auto-join toward a port outside the read (Chadds RA 37, live 2026-10-30)", () => {
  // 14517389:0 faced 14548688:1 at 0.012 in; 14663504:0 and 14663546:0 faced 14663834:1 and
  // 14663850:1 at 2.25 in. The partners sat outside the per-system read, so only C#'s `near` knew.
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [20, 0, 0], [30, 0, 0])]);
  const near = (gapIn: number, elementId: number) => ({
    ports: [{ elementId, connector: 1, gapIn, facingDot: -1, opposed: true, aligned: gapIn < 1, autoJoin: true }],
  });
  Object.assign(s.issues.find((i) => i.id === "open-end:10:0")!, { near: near(0.012, 14548688) });
  Object.assign(s.issues.find((i) => i.id === "open-end:11:0")!, { near: near(2.25, 14663834) });
  expect(items(s).map((i) => i.end).sort()).toEqual(["10:1", "11:1"]);
  expect(healPlan(s).hard.get("open-end:10:0")?.note).toMatch(/faces 14548688:1 0\.01 in away: a join, not a cap/);
  expect(healPlan(s).hard.get("open-end:11:0")?.note).toMatch(/faces 14663834:1 2\.25 in away/);
});
