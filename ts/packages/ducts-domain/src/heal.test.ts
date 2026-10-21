/**
 * Heal candidates, deterministic: a dangling duct or fitting end is a cap, coincident same-size
 * ends connect, a small collinear gap between two ducts is a union and from a duct to a part an
 * extend; a size change, two systems, a gap past the limit, a terminal off its duct, an ignored
 * end and a takeoff are a person's, with the reason the inbox shows. Points are model feet.
 */
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
const duct = (id: number, a: number[], b: number[], over: Partial<Segment> = {}, d = 6): Segment => ({
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
        id: `open-end:${e.groupId}:${e.id}:${c.index}`,
        kind: "open-end" as const,
        elementId: e.id,
        point: c.point,
        groupId: e.groupId!,
        note: "nothing attached",
      })),
  );
  return {
    coordinateEncoding: "native-double",
    document: { title: "t", readAt: "2026-10-20T00:00:00Z", elapsedMs: 1, networkBasedCalculations: true },
    levels: [],
    groups: elements.map((e) => ({
      id: e.groupId!,
      rootIds: [],
      classifications: ["Supply Air"],
      systemNames: [e.systemName ?? "SA 1"],
      terminalCount: e.kind === "terminal" ? 1 : 0,
      elementCount: 1,
      loops: 0,
      issueIds: issues.filter((i) => i.groupId === e.groupId).map((i) => i.id),
    })),
    nodes,
    segments,
    flows: [],
    issues,
    layers: [],
    systems: [],
    slots: { fanStatic: "", fanFlow: "", componentDrop: "", fittingCoefficient: "", terminalFlow: "" },
  } as DuctSnapshot;
};
const items = (s: DuctSnapshot) => healPlan(s).groups.flatMap((g) => g.items);

it("caps a dangling duct end, and only that end", () => {
  // 10 and 11 meet at x=10 ft (coincident); 10's far end dangles; 11's far end dangles too.
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0])]);
  const plan = healPlan(s);
  const caps = items(s).filter((i) => i.kind === "cap");
  expect(caps.map((i) => i.end).sort()).toEqual(["10:0", "11:1"]);
  expect(plan.covered.has("open-end:g10:10:0")).toBe(true);
});

it("connects coincident same-size ends, covering the inferred join and both open ends", () => {
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0])]);
  const join = items(s).find((i) => i.kind === "join")!;
  expect(join).toMatchObject({ how: "connect", end: "10:1", other: "11:0", gapIn: 0 });
  expect(join.covers).toEqual([proximityId("11:0", "10:1"), "open-end:g10:10:1", "open-end:g11:11:0"]);
  // Groups are the page's: the inferred join already bridged g11 into g10.
  expect(healPlan(s).groups.map((g) => g.group)).toEqual(["g10"]);
  // Ends past the route's bridging tolerance stay in their own groups; a join between them is listed under both.
  const apart = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10 + 2.5 * IN, 0, 0], [20, 0, 0])]);
  const union = items(apart).find((i) => i.kind === "join")!;
  expect(healPlan(apart).groups.filter((g) => g.items.includes(union)).map((g) => g.group)).toEqual(["g10", "g11"]);
});

it("bridges a 2 in collinear gap between two ducts with a union, and from a duct to a fitting by extending the duct", () => {
  const s = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10 + 2 * IN, 0, 0], [20, 0, 0])]);
  expect(items(s).find((i) => i.kind === "join")).toMatchObject({ how: "union" });
  const elbow = node(30, "fitting", [conn(0, [10 + 2 * IN, 0, 0], [-1, 0, 0]), { ...conn(1, [11, 1, 0], [0, 1, 0]), connectedTo: { elementId: 99, connector: 0 } }]);
  const t = snap([duct(10, [0, 0, 0], [10, 0, 0])], [elbow]);
  expect(items(t).find((i) => i.kind === "join")).toMatchObject({ how: "extend", end: "10:1", other: "30:0" });
});

it("leaves size changes, two systems, long or skewed gaps and terminals to a person, with the reason", () => {
  const sized = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0], {}, 8)]);
  expect(items(sized).some((i) => i.kind === "join")).toBe(false);
  expect(healPlan(sized).hard.get("open-end:g10:10:1")).toMatch(/differ in size: a transition\. Fix it in Revit/);

  const systems = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10, 0, 0], [20, 0, 0], { systemName: "SA 2" })]);
  expect(healPlan(systems).hard.get(proximityId("10:1", "11:0"))).toMatch(/merges systems/);

  const far = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10 + 6 * IN, 0, 0], [20, 0, 0])]);
  expect(healPlan(far).hard.get("open-end:g11:11:0")).toMatch(new RegExp(`past the ${HEAL_JOIN_GAP_IN} in heal limit`));

  const skew = snap([duct(10, [0, 0, 0], [10, 0, 0]), duct(11, [10 + 2 * IN, 1 * IN, 0], [20, 1 * IN, 0])]);
  expect(healPlan(skew).hard.get("open-end:g10:10:1")).toMatch(/not on one axis/);

  const grille = node(40, "terminal", [conn(0, [30, 0, 0], [0, 0, -1])]);
  const lone = snap([], [grille]);
  expect(items(lone)).toEqual([]);
  expect(healPlan(lone).hard.get("open-end:g40:40:0")).toMatch(/terminal 40 is not connected/);
});

it("caps a dangling fitting end, never one a person ignored", () => {
  const tee = node(50, "fitting", [conn(0, [0, 0, 0], [-1, 0, 0])]);
  expect(items(snap([], [tee]))).toMatchObject([{ kind: "cap", end: "50:0" }]);
  const work = ductsDocumentSchema.parse({
    assumptions: { "open-end:g50:50:0": { staged: { value: { kind: "verdict", verdict: "ignore" } } } },
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
