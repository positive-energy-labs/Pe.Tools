import { describe, expect, it } from "vite-plus/test";

import { bin } from "./bins.ts";
import { fanSections } from "./fan-sections.ts";
import { passThrough } from "./pass-through.ts";
import { computeLosses } from "./losses.ts";
import { price } from "./pricing.ts";
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

describe("unitRoles", () => {
  it("proposes fan from base equipment, then a stated flow; passive only for a through-flow device", () => {
    const base = snapshot({});
    const s = {
      ...base,
      slots: { fanFlow: "PE_M_Fan_AirFlow" },
      nodes: base.nodes.map((n) =>
        n.id === 2
          ? { ...n, facts: [...n.facts.filter((f) => f.key !== "fanFlow"), fact("fanFlow", 100)] }
          : n.id === 3
            ? { ...n, connectors: [port(1, 16, 2), port(2, null)] }
            : n,
      ),
      systems: [
        { name: "SA", baseEquipmentId: 1 },
        // A system the unit's own groups do not carry names it base equipment for nothing here.
        { name: "RA 9", baseEquipmentId: 3 },
      ],
    } as unknown as DuctSnapshot;
    expect(Object.fromEntries(unitRoles(s, equipmentFlows(s, {}), {}))).toEqual({
      1: { role: "fan", why: "proposed", reason: "base equipment of SA" },
      2: { role: "fan", why: "proposed", reason: "airflow in PE_M_Fan_AirFlow (100 cfm)" },
      3: { role: "passive", why: "proposed", reason: "air passes straight through (all ports Supply Air)" },
    });
    // No flow, no base equipment: mixed port classes move air; one port moves air.
    const mixed = {
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === 3 ? { ...n, connectors: [port(1, 16, 2), { ...port(2, null), classification: "ReturnAir" }] } : n,
      ),
    } as unknown as DuctSnapshot;
    const roles = unitRoles(mixed, equipmentFlows(mixed, {}), {});
    expect(roles.get(3)).toEqual({ role: "fan", why: "proposed", reason: "mixed port classes: moves air" });
    expect(roles.get(1)).toEqual({ role: "fan", why: "proposed", reason: "one port: moves air" });
  });

  it("lets a ruling beat the proposal and tells a stored one from a staged one", () => {
    const s = { ...snapshot(), store: { roles: { "1": { role: "passive", ruledAt: "t" } } } };
    const roles = unitRoles(s as unknown as DuctSnapshot, equipmentFlows(s as unknown as DuctSnapshot, {}), {
      "1": { role: "passive" },
      "3": { role: "fan" },
    });
    expect(roles.get(1)).toMatchObject({ role: "passive", why: "ruled" });
    expect(roles.get(3)).toMatchObject({ role: "fan", why: "staged" });
  });
});

describe("several fans", () => {
  it("never block: a Diagnostics line names the split, and a flowless fan takes the flow it serves", () => {
    const s = snapshot({ dh: 100 });
    const sv = survey(s, null);
    const ids = sv.findings.map((f) => f.id);
    expect(ids).not.toContain("multi-root:g10");
    const split = sv.findings.find((f) => f.id === "multi-fan:g10")!;
    expect(bin(split)).toBe("diagnostic");
    // FC-30 states nothing: it serves grille 30 (300 cfm), nearer its port than DH-16's (31 is DH-16's).
    expect(sv.equipmentFlows.get(1)).toEqual({ cfm: 300, source: "derived", grilles: 1 });
    expect(split.note).toBe(
      "priced per fan: FC-30 300 cfm (sum of 1 grille) owns the trunk; DH-16 100 cfm owns its port to the first junction; FR-1 flow unknown owns its port to the first junction",
    );
  });

  it("derives a flowless fan's flow from this group's grilles, never another group's (SA 19, DH-21)", () => {
    // DH-16 also roots return group g20 through its second port: grille 33 (900 cfm) is its there.
    const base = snapshot({});
    const s = {
      ...base,
      groups: [
        ...base.groups,
        { ...base.groups[0]!, id: "g20", rootIds: [2], terminalCount: 1, issueIds: [] },
      ],
      nodes: [
        ...base.nodes.map((n) => (n.id === 2 ? { ...n, connectors: [port(1, 15, 2), { ...port(2, 20), classification: "ReturnAir" }] } : n)),
        node(33, "terminal", "g20", [port(1, 20, 2)], [fact("flow", 900)]),
      ],
      segments: [...base.segments, { ...duct(20, [2, 33]), groupId: "g20" }],
    } as unknown as DuctSnapshot;
    const priced = price(s, {}, null);
    // The per-unit reading is the largest over its groups; g10 is priced from g10's own grilles.
    expect(priced.equipmentFlows.get(2)).toEqual({ cfm: 900, source: "derived", grilles: 1 });
    for (const solve of [priced.now, priced.next]) {
      const { fans, fan } = solve.byGroup.g10!;
      expect(fans.map((f) => [f.unit, f.cfm])).toEqual([
        [1, 300],
        [2, 200],
        [3, null],
      ]);
      // The header's fan is the trunk fan's own number, the one its row shows.
      expect(fans[0]).toMatchObject({ esp: fan, junction: null });
    }
    expect(priced.findings.find((f) => f.id === "multi-fan:g10")!.note).toBe(
      "priced per fan: FC-30 300 cfm (sum of 1 grille) owns the trunk; DH-16 200 cfm (sum of 1 grille) owns its port to the first junction; FR-1 flow unknown owns its port to the first junction",
    );
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

describe("passThrough", () => {
  /** Filter 3 also feeds duct 17 (its own group g17) to grille 32; its third port is open. */
  const split = () => {
    const s = snapshot();
    const filter = s.nodes.find((n) => n.id === 3)!;
    filter.connectors = [port(1, 16, 2), port(2, 17), port(3, null)];
    const g17 = { ...s.groups[0]!, id: "g17", rootIds: [3], terminalCount: 1, elementCount: 2, issueIds: [] };
    const d17 = { ...duct(17, [3, 32]), groupId: "g17" } as Segment;
    return {
      ...s,
      groups: [...s.groups, g17],
      nodes: [...s.nodes, node(32, "terminal", "g17", [port(1, 17, 2)], [fact("flow", 150)])],
      segments: [...s.segments, d17],
    } as DuctSnapshot;
  };

  it("merges the groups a passive unit's ports reach and prices through it under the fan", () => {
    const p = passThrough(split(), new Set([3]));
    expect([...p.merged]).toEqual([["g10", ["g10", "g17"]]]);
    expect(p.snapshot.groups.map((g) => [g.id, g.rootIds])).toEqual([["g10", [1, 2]]]);
    expect(p.snapshot.nodes.find((n) => n.id === 3)!.groupId).toBe("g10");
    expect(p.findings).toMatchObject([{ id: "open-end:passive:3:3", kind: "open-end", groupId: "g10" }]);
    const result = computeLosses(p.snapshot, {}, {}, {
      unitRole: { 1: "fan", 2: "fan", 3: "passive" },
      unitCfm: { 1: 800, 2: 100 },
    });
    // Grille 32 sits past the filter: its run starts at the air handler's duct and crosses duct 16.
    const ids = [...new Set(result.paths[32]!.rows.map((r) => r.id))];
    expect(ids[0]).toBe(10);
    expect(ids).toEqual(expect.arrayContaining([16, 17, 32]));
  });

  it("surveys the merged network: the fan's grilles past the filter, the open port a person's fix", () => {
    const sv = survey(split(), null);
    expect(sv.roles.get(3)).toMatchObject({ role: "passive", why: "proposed" });
    expect(sv.snapshot.groups.map((g) => g.id)).toEqual(["g10"]);
    expect(sv.findings.map((f) => f.id)).toContain("open-end:passive:3:3");
  });
});
