import { describe, expect, it } from "vite-plus/test";

import { ductsDocumentSchema } from "@pe/agent-contracts";

import { fanSections } from "./fan-sections.ts";
import { computeLosses } from "./losses.ts";
import { survey } from "./survey.ts";
import { equipmentFlows } from "./terminal-flows.ts";
import { groupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";
import { unitRoles } from "./unit-roles.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Node["connectors"][number];
type Fact = Node["facts"][number];

const port = (index: number, to: number | null, connector = 1): Connector =>
  ({
    index,
    kind: "end",
    point: [0, 0, 9],
    shape: "round",
    size: '12"ø',
    diameterIn: 12,
    direction: "bidirectional",
    classification: "SupplyAir",
    connectedTo: to == null ? null : { elementId: to, connector },
    areaFt2: 0.7854,
  }) as Connector;
const fact = (key: string, value: number | null, text?: string) =>
  ({ key, value, text, unit: "", provenance: "revit" }) as unknown as Fact;
const node = (id: number, kind: string, groupId: string | null, connectors: Connector[], facts: Fact[] = []) =>
  ({
    id,
    kind,
    category: kind,
    family: kind,
    type: "Standard",
    partType: kind === "fitting" ? "Tee" : null,
    levelId: 100,
    point: [0, 0, 9],
    groupId,
    systemName: "SA",
    classification: "Supply Air",
    connectors,
    facts,
  }) as unknown as Node;
const duct = (id: number, ends: [number, number]): Segment =>
  ({
    id,
    kind: "duct",
    curveKind: "line",
    type: "Round Duct",
    shape: "round",
    size: '12"ø',
    diameterIn: 12,
    lengthFt: 10,
    polyline: [
      [0, 0, 9],
      [10, 0, 9],
    ],
    levelId: 100,
    groupId: "g10",
    systemName: "SA",
    classification: "Supply Air",
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: [port(1, ends[0]), port(2, ends[1])],
  }) as unknown as Segment;

/**
 * Air handler 1 (800 cfm) feeds duct 10 into tee 50: duct 11 to grille 30, duct 13 to tee 51.
 * Tee 51 sends duct 14 to grille 31 and takes duct 15 from dehumidifier 2 (100 cfm): the
 * dehumidifier's air meets the air handler's at tee 51. Filter 3 roots the same group through
 * duct 16 off tee 50 and states no flow.
 */
const snapshot = (flows: { ahu?: number; dh?: number } = { ahu: 800, dh: 100 }) =>
  ({
    document: { title: "t", readAt: "", elapsedMs: 0, networkBasedCalculations: true },
    coordinateEncoding: "native-double",
    levels: [],
    groups: [
      {
        id: "g10",
        rootIds: [1, 2, 3],
        classifications: ["Supply Air"],
        systemNames: ["SA"],
        terminalCount: 2,
        elementCount: 10,
        loops: 0,
        issueIds: ["multi-root:g10"],
      },
    ],
    nodes: [
      node(1, "equipment", null, [port(1, 10)], [fact("mark", null, "FC-30"), fact("fanFlow", flows.ahu ?? null)]),
      node(2, "equipment", null, [port(1, 15, 2)], [fact("mark", null, "DH-16"), fact("fanFlow", flows.dh ?? null)]),
      node(3, "equipment", null, [port(1, 16, 2)], [fact("mark", null, "FR-1")]),
      node(50, "fitting", "g10", [port(1, 10, 2), port(2, 11), port(3, 13), port(4, 16)]),
      node(51, "fitting", "g10", [port(1, 13, 2), port(2, 14), port(3, 15)]),
      node(30, "terminal", "g10", [port(1, 11, 2)], [fact("flow", 300)]),
      node(31, "terminal", "g10", [port(1, 14, 2)], [fact("flow", 200)]),
    ],
    segments: [
      duct(10, [1, 50]),
      duct(11, [50, 30]),
      duct(13, [50, 51]),
      duct(14, [51, 31]),
      duct(15, [51, 2]),
      duct(16, [50, 3]),
    ],
    flows: [],
    issues: [{ id: "multi-root:g10", kind: "multi-root", groupId: "g10", note: "3 roots" }],
    layers: [],
    systems: [],
    slots: {},
  }) as unknown as DuctSnapshot;

const doc = (roles: Record<string, "fan" | "passive">) =>
  ductsDocumentSchema.parse({
    roles: Object.fromEntries(
      Object.entries(roles).map(([id, role]) => [id, { staged: { value: { role } } }]),
    ),
  });

describe("unitRoles", () => {
  it("proposes fan from a stated flow and passive beside one, and leaves a flowless group alone", () => {
    const s = snapshot();
    const roles = unitRoles(s, equipmentFlows(s, {}), {});
    expect(Object.fromEntries(roles)).toEqual({
      1: { role: "fan", why: "proposed", reason: "states a design flow of 800 cfm" },
      2: { role: "fan", why: "proposed", reason: "states a design flow of 100 cfm" },
      3: {
        role: "passive",
        why: "proposed",
        reason: "states no design flow; FC-30 beside it states 800 cfm",
      },
    });
    const none = snapshot({});
    expect(unitRoles(none, equipmentFlows(none, {}), {}).get(3)).toEqual({
      role: "fan",
      why: "default",
      reason: "no unit in its groups states a design flow",
    });
  });

  it("lets a ruling beat the proposal and tells a stored one from a staged one", () => {
    const s = { ...snapshot(), store: { roles: { "1": { role: "passive", ruledAt: "t" } } } };
    const roles = unitRoles(s as DuctSnapshot, equipmentFlows(s as DuctSnapshot, {}), {
      "1": { role: "passive" },
      "3": { role: "fan" },
    });
    expect(roles.get(1)).toMatchObject({ role: "passive", why: "ruled" });
    expect(roles.get(3)).toMatchObject({ role: "fan", why: "staged" });
  });
});

describe("multi-root under the proposal", () => {
  it("stands while two fans are only proposed, and clears once a person rules them", () => {
    const s = snapshot();
    expect(survey(s, null).findings.map((f) => f.id)).toContain("multi-root:g10");
    expect(survey(s, doc({ "1": "fan", "2": "fan" })).findings.map((f) => f.id)).not.toContain(
      "multi-root:g10",
    );
    const one = snapshot({ ahu: 800 });
    expect(survey(one, null).findings.map((f) => f.id)).not.toContain("multi-root:g10");
  });
});

describe("fanSections", () => {
  it("gives the smaller fan its port to the first junction and the larger fan the trunk", () => {
    const s = snapshot();
    const tree = groupTree(s, "g10", 1);
    const [big, small] = fanSections(tree, [
      { unit: 2, cfm: 100 },
      { unit: 1, cfm: 800 },
    ]);
    expect(small).toMatchObject({ unit: 2, port: 15, junction: 51, owned: [15] });
    expect(big).toMatchObject({ unit: 1, port: 10, junction: null });
    expect(big!.owned).toContain(51);
    expect(big!.owned).not.toContain(15);
  });

  it("prices each fan: the smaller one's stretch at its own flow, then the trunk from the junction", () => {
    const s = snapshot();
    const result = computeLosses(s, {}, {}, {
      unitRole: { 1: "fan", 2: "fan", 3: "passive" },
      unitCfm: { 1: 800, 2: 100 },
    });
    const { fans, fan, critical } = result.byGroup.g10!;
    expect(fans.map((f) => f.unit)).toEqual([1, 2]);
    const [big, small] = fans;
    expect(big).toMatchObject({ esp: fan, critical, viaJunction: false });
    expect(small).toMatchObject({ junction: 51, critical: 31, viaJunction: true });
    expect(small!.stretch.map((r) => r.desc)).toEqual([
      expect.stringContaining("at 100 cfm"),
    ]);
    // Its air joins the trunk's demand past the junction; it is not added on top.
    const tail = result.paths[31]!.rows.filter((r) => r.id === 14 || r.id === 31 || r.id === 51);
    const tailDp = tail.reduce((a, r) => a + (r.dp ?? 0), 0);
    const stretchDp = small!.stretch.reduce((a, r) => a + (r.dp ?? 0), 0);
    expect(small!.esp).toBeCloseTo(stretchDp + tailDp, 9);
    expect(result.paths[31]!.rows.find((r) => r.id === 13)!.desc).toContain("at 200 cfm");
  });

  it("walks a group from its one fan when the other units are passive", () => {
    const s = snapshot();
    const result = computeLosses(s, {}, {}, {
      unitRole: { 1: "fan", 2: "passive", 3: "passive" },
      unitCfm: { 1: 800 },
    });
    expect(result.byGroup.g10!.fans).toEqual([]);
    expect(result.paths[31]!.rows[0]!.id).toBe(10);
  });
});
