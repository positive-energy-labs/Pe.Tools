import { expect, it } from "vite-plus/test";
import {
  applyPatches,
  transitionPatches,
  ductsRouteState,
  type DuctCalculation,
  type DuctHydraulics,
  ductHydraulicsSchema,
  ductPortPinSchema,
  type DuctPortPin,
} from "@pe/agent-contracts";
import { applyRequest, price, proposedStatic } from "@pe/ducts-domain/pricing";
import { friction, roundSection } from "@pe/ducts-domain/loss-physics";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

const port = (index: number, owner: number, connector: number, direction = "bidirectional") => ({
  index,
  kind: "end",
  point: [0, 0, 0],
  shape: "round" as const,
  size: "8",
  diameterIn: 8,
  widthIn: null,
  heightIn: null,
  flowCfm: null,
  direction,
  classification: null,
  connectedTo: { elementId: owner, connector },
});
const eq = (id: number, connectors: ReturnType<typeof port>[]) => ({
  id,
  uniqueId: `purpose-${id}`,
  kind: "equipment",
  category: "Equipment",
  family: "Purpose fixture",
  type: "fixture",
  point: [0, 0, 0],
  groupId: null,
  connectors,
  facts: [],
});
const terminal = (id: number, owner: number, connector: number, groupId: string, drop = 0.03) => ({
  id,
  uniqueId: `purpose-${id}`,
  kind: "terminal",
  point: [0, 0, 0],
  groupId,
  connectors: [port(0, owner, connector)],
  facts: [{ key: "flow", value: 100, unit: "cfm", provenance: "designer-stated" }],
  terminalDrop: { catalogDropInWg: drop, writable: false },
});
const segment = (id: number, groupId: string, connectors: ReturnType<typeof port>[]) => ({
  id,
  uniqueId: `purpose-${id}`,
  kind: "duct",
  curveKind: "line",
  shape: "round",
  size: "8",
  diameterIn: 8,
  lengthFt: 5,
  polyline: [
    [0, 0, 0],
    [5, 0, 0],
  ],
  groupId,
  roughness: { valueFt: 0.0003, provenance: "designer-stated" },
  revit: {},
  connectors,
});
const group = (id: string, rootIds: number[], terminalCount: number) => ({
  id,
  rootIds,
  classifications: ["Supply Air"],
  systemNames: [],
  terminalCount,
  elementCount: 2,
  loops: 0,
  issueIds: [],
});
function fixture() {
  return {
    coordinateEncoding: "native-double",
    document: {
      title: "Purpose fixture, NOT Project A",
      readAt: "2026-10-15T00:00:00Z",
      elapsedMs: 0,
    },
    levels: [],
    // Both units are base equipment of a system they serve: proposed fans, never passed through.
    groups: [
      { ...group("upstream", [100, 200], 0), systemNames: ["SA up"] },
      { ...group("downstream", [200], 1), systemNames: ["SA down"] },
    ],
    nodes: [
      eq(100, [port(0, 10, 0)]),
      eq(200, [port(1, 10, 1), port(2, 20, 0)]),
      terminal(300, 20, 1, "downstream"),
    ],
    segments: [
      segment(10, "upstream", [port(0, 100, 0), port(1, 200, 1)]),
      segment(20, "downstream", [port(0, 200, 2), port(1, 300, 0)]),
    ],
    flows: [],
    issues: [],
    systems: [
      { name: "SA up", baseEquipmentId: 100, sections: [] },
      { name: "SA down", baseEquipmentId: 200, sections: [] },
    ],
  } as unknown as DuctSnapshot;
}
function pin(
  s: DuctSnapshot,
  id: number,
  index: number,
): DuctPortPin & { connectedTo: NonNullable<DuctPortPin["connectedTo"]> } {
  const elements = [...s.nodes, ...s.segments];
  const c = elements.find((e) => e.id === id)!.connectors.find((c) => c.index === index)!;
  const to = c.connectedTo;
  if (!to) throw Error("Purpose connected-pin helper requires a real peer");
  return {
    index,
    point: c.point as [number, number, number],
    shape: c.shape,
    diameterIn: c.diameterIn ?? null,
    widthIn: c.widthIn ?? null,
    heightIn: c.heightIn ?? null,
    direction: c.direction,
    connectedTo: {
      id: to.elementId,
      connector: to.connector,
      uniqueId: elements.find((e) => e.id === to.elementId)!.uniqueId!,
    },
  };
}
const identity = (id: number) => ({ id, uniqueId: `purpose-${id}` });
function evidence(s: DuctSnapshot): Record<string, DuctCalculation> {
  return {
    scenario: { kind: "balanced-design", source: "Purpose balanced-demand scenario" },
    fan: {
      kind: "fan",
      element: identity(100),
      inlet: null,
      outlet: pin(s, 100, 0),
      referenceTotalPressureInWg: 0,
      designFlowCfm: null,
      source: "Purpose fan external-plane role",
    },
    filter: {
      kind: "passive",
      element: identity(200),
      ports: [pin(s, 200, 1), pin(s, 200, 2)],
      loss: { flowCfm: 100, totalLossInWg: 0.1, source: "Purpose catalog point at100CFM" },
      source: "Purpose inline filter role",
    },
    grille: {
      kind: "terminal",
      element: identity(300),
      port: pin(s, 300, 0),
      role: "demand",
      flowCfm: null,
      boundaryTotalPressureInWg: 0,
      loss: {
        totalLossInWg: 0.03,
        flowCfm: 100,
        source: "Purpose explicitly stated TOTAL-loss point",
      },
      source: "Purpose room pressure/design demand",
    },
  };
}
const work = (values: Record<string, DuctCalculation>, edit = true) =>
  ductsRouteState.schema.parse({
    calculation: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        edit ? { edit: { value } } : { suggestion: { value } },
      ]),
    ),
  });

it("charges a edit passive once on the actual fan circuit while retaining legacy arithmetic", () => {
  const s = fixture(),
    baseline = price(s, {}, null);
  expect(proposedStatic(s, baseline.now, 100)).toBeNull();
  expect(proposedStatic(s, baseline.now, 200)).not.toBeNull();
  const priced = price(s, {}, work(evidence(s)));
  expect(priced.now.paths).toEqual(baseline.now.paths);
  const circuit = priced.next.design.circuits[0]!;
  expect(circuit.status).toBe("complete-for-declared-design");
  expect(circuit.flowCfm).toBe(100);
  expect(circuit.outlet.continuityResidualCfm).toBe(0);
  expect(circuit.outlet.jointFlows).toEqual(
    expect.arrayContaining([
      { from: "100:0", to: "10:0", cfm: 100 },
      { from: "200:2", to: "20:0", cfm: 100 },
    ]),
  );
  expect(circuit.requiredExternalTotalPressureInWg).toBeCloseTo(
    2 * friction(roundSection(8), 100, 5, 0.0003).dp + 0.1 + 0.03,
    12,
  );
  expect(circuit.outlet.paths[0]!.rows.filter((r) => r.id === 200)).toEqual([
    expect.objectContaining({ dp: 0.1 }),
  ]);
  expect(priced.next.design.graph.parts.find((p) => p.elementId === 200)?.continuity).toBe(
    "passive",
  );
  expect(priced.next.design.circuits.map((c) => c.equipmentId)).toEqual([100]);
  expect(proposedStatic(s, priced.next, 200)).toBeNull();
  expect(price(s, {}, work(evidence(s), false)).next.design.circuits).toEqual([]);
});

it("keeps sourced zero losses valid at zero flow, and refuses assigned default-zero catalog authority", () => {
  const s = fixture(),
    e = evidence(s);
  s.nodes.find((n) => n.id === 300)!.facts[0]!.value = 0;
  if (e.filter?.kind !== "passive" || e.grille?.kind !== "terminal")
    throw Error("Purpose fixture kind");
  e.filter.loss = { flowCfm: 0, totalLossInWg: 0, source: "Purpose explicit zero-flow loss" };
  e.grille.loss = { flowCfm: 0, totalLossInWg: 0, source: "Purpose explicit zero-flow loss" };
  const c = price(s, {}, work(e)).next.design.circuits[0]!;
  expect(c.status).toBe("complete-for-declared-design");
  expect(c.requiredExternalTotalPressureInWg).toBe(0);
  e.filter.loss.totalLossInWg = 0.1;
  expect(
    price(s, {}, work(e)).next.design.circuits[0]!.reasons.some(
      (r) => r.code === "nonzero-loss-at-zero-flow",
    ),
  ).toBe(true);
  const unknown = fixture(),
    u = evidence(unknown);
  if (u.grille?.kind !== "terminal") throw Error("Purpose fixture kind");
  u.grille.loss = null;
  unknown.nodes.find((n) => n.id === 300)!.terminalDrop = {
    catalogDropInWg: null,
    assignedPressureDropInWg: 0,
    connectorLossMethod: "ConnectorLossMethodNotDefined",
    writable: false,
  };
  const partial = price(unknown, {}, work(u)).next.design.circuits[0]!;
  expect(partial.requiredExternalTotalPressureInWg).toBeNull();
  expect(partial.reasons.some((r) => r.code === "terminal-total-loss-unknown")).toBe(true);
});

it("keeps contradictory native fan direction and repeated passive ports unadmitted", () => {
  for (const fan of [true, false]) {
    const s = fixture(),
      e = evidence(s);
    if (fan && e.fan?.kind === "fan") {
      s.nodes.find((n) => n.id === 100)!.connectors[0]!.direction = "in";
      e.fan.outlet = pin(s, 100, 0);
    } else if (e.filter?.kind === "passive") e.filter.ports[1] = e.filter.ports[0];
    const result = price(s, {}, work(e)).next.design;
    expect(result.circuits.every((c) => c.requiredExternalTotalPressureInWg === null)).toBe(true);
    expect(
      result.reasons.some(
        (r) => r.code === (fan ? "contradictory-fan-direction" : "contradictory-port-pair"),
      ),
    ).toBe(true);
  }
});

it("both authors share revision-fenced Work edits and refuses lossy scalar unit writes", () => {
  const s = fixture(),
    value = evidence(s).filter!;
  const env = { version: 1 as const, revision: 3, doc: ductsRouteState.schema.parse({}) };
  const propose = transitionPatches(
    ["calculation"],
    "filter",
    {},
    { kind: "suggest", rung: { value } },
  );
  expect(applyPatches(ductsRouteState, env, "pea", propose, 3)).toMatchObject({ ok: true });
  const stage = transitionPatches(["calculation"], "filter", {}, { kind: "set", rung: { value } });
  expect(applyPatches(ductsRouteState, env, "pea", stage, 3)).toMatchObject({ ok: true });
  expect(applyPatches(ductsRouteState, env, "human", stage, 3)).toMatchObject({ ok: true });
  expect(applyPatches(ductsRouteState, env, "human", stage, 2)).toMatchObject({ ok: false });
  const doc = work(evidence(s));
  doc.esp["100"] = { edit: { value: { inWg: 0.2 } } };
  expect(() => applyRequest(s, price(s, {}, doc), "purpose-time", [])).toThrow(
    "no admitted manufacturer scalar ESP mapping",
  );
  delete doc.esp["100"];
  doc.esp["200"] = { edit: { value: { inWg: 0.2 } } };
  expect(() => applyRequest(s, price(s, {}, structuredClone(doc)), "purpose-time", [])).toThrow(
    "no admitted manufacturer scalar ESP mapping",
  );
});

it("writes a edit unit flow for any unit rooted in the group, not only the baseline's pick", () => {
  const s = fixture();
  const doc = work(evidence(s));
  doc.equipmentFlows["200"] = { edit: { value: { cfm: 825 } } };
  doc.equipmentFlows["100"] = { edit: { value: { cfm: 400 } } };
  const ids = applyRequest(s, price(s, {}, doc), "purpose-time", ["upstream"]).equipmentFlows.map(
    (f) => f.id,
  );
  expect(ids).toEqual([100, 200]);
  expect(
    applyRequest(s, price(s, {}, doc), "purpose-time", ["downstream"]).equipmentFlows.map(
      (f) => f.id,
    ),
  ).toEqual([200]);
});

it("pairs two independent ERV fans by exact ports instead of classifications", () => {
  const s = fixture();
  s.nodes = [
    eq(100, [
      port(1, 301, 0, "in"),
      port(2, 302, 0, "out"),
      port(3, 303, 0, "in"),
      port(4, 304, 0, "out"),
    ]),
    terminal(301, 100, 1, "a", 0.04),
    terminal(302, 100, 2, "b", 0.16),
    terminal(303, 100, 3, "c", 0.12),
    terminal(304, 100, 4, "d", 0.06),
  ] as unknown as DuctSnapshot["nodes"];
  s.segments = [];
  s.groups = [];
  const e: Record<string, DuctCalculation> = {
    scenario: { kind: "balanced-design", source: "Purpose balanced scenario" },
  };
  for (const [id, i, o] of [
    ["supply", 1, 2],
    ["exhaust", 3, 4],
  ] as const)
    e[id] = {
      kind: "fan",
      element: identity(100),
      inlet: pin(s, 100, i),
      outlet: pin(s, 100, o),
      referenceTotalPressureInWg: 0,
      designFlowCfm: 100,
      source: "Purpose two-blower mapping",
    };
  for (const id of [301, 302, 303, 304])
    e[String(id)] = {
      kind: "terminal",
      element: identity(id),
      port: pin(s, id, 0),
      role: "demand",
      flowCfm: 100,
      boundaryTotalPressureInWg: 0,
      loss: {
        totalLossInWg: ({ 301: 0.04, 302: 0.16, 303: 0.12, 304: 0.06 } as Record<number, number>)[
          id
        ]!,
        flowCfm: 100,
        source: "Purpose exact catalog point",
      },
      source: "Purpose pressure boundary",
    };
  const circuits = price(s, {}, work(e)).next.design.circuits;
  expect(circuits.map((c) => c.status)).toEqual([
    "complete-for-declared-design",
    "complete-for-declared-design",
  ]);
  expect(circuits.find((c) => c.id === "supply")?.requiredExternalTotalPressureInWg).toBeCloseTo(
    0.2,
    12,
  );
  expect(circuits.find((c) => c.id === "exhaust")?.requiredExternalTotalPressureInWg).toBeCloseTo(
    0.18,
    12,
  );
});

it("refuses stale/contradictory pins, off-point losses, missing identity, scenario and flow", () => {
  for (const mode of [
    "stale",
    "conflict",
    "offpoint",
    "identity",
    "scenario",
    "unknown-flow",
  ] as const) {
    const s = fixture(),
      e = evidence(s);
    if (mode === "stale" && e.filter?.kind === "passive") e.filter.ports[0].point = [1, 0, 0];
    if (mode === "conflict") e.duplicate = e.filter!;
    if (mode === "offpoint" && e.filter?.kind === "passive") e.filter.loss.flowCfm = 120;
    if (mode === "identity") s.segments[0]!.uniqueId = null;
    if (mode === "scenario") delete e.scenario;
    if (mode === "unknown-flow") s.nodes.find((n) => n.id === 300)!.facts = [];
    const result = price(s, {}, work(e)).next.design;
    expect(
      result.circuits.every((c) => c.requiredExternalTotalPressureInWg === null),
      mode,
    ).toBe(true);
    expect(
      [...result.reasons, ...result.circuits.flatMap((c) => c.reasons)].length,
      mode,
    ).toBeGreaterThan(0);
  }
});

it("retains parallel joints and refuses mesh/multiple fan allocation without cutting routes", () => {
  for (const mesh of [false, true]) {
    const s = fixture(),
      e = evidence(s);
    if (mesh) {
      s.segments[0]!.connectors.push(port(2, 20, 2));
      s.segments[1]!.connectors.push(port(2, 10, 2));
    } else {
      s.nodes.push(eq(400, [port(0, 20, 2)]) as unknown as DuctSnapshot["nodes"][number]);
      s.segments[1]!.connectors.push(port(2, 400, 0));
      e.otherFan = {
        kind: "fan",
        element: identity(400),
        inlet: null,
        outlet: pin(s, 400, 0),
        referenceTotalPressureInWg: 0,
        designFlowCfm: 50,
        source: "Purpose second fan",
      };
    }
    const result = price(s, {}, work(e)).next.design;
    expect(result.circuits.every((c) => c.requiredExternalTotalPressureInWg === null)).toBe(true);
    expect(
      result.circuits
        .flatMap((c) => c.reasons)
        .some((r) => r.code === (mesh ? "mesh-not-solved" : "unresolved-fan-allocation")),
    ).toBe(true);
    if (mesh) expect(result.circuits[0]!.outlet.backEdges.length).toBeGreaterThan(0);
  }
});

it("refuses unqualified legacy static input and accepts only caller-converted explicit total pressure", () => {
  const s = fixture(),
    e = evidence(s);
  if (e.grille?.kind !== "terminal") throw Error("Purpose fixture kind");
  e.grille.loss = null;
  s.nodes.find((n) => n.id === 300)!.terminalDrop!.catalogDropInWg = 0.05;
  const unknown = price(s, {}, work(e)).next.design.circuits[0]!;
  expect(unknown.requiredExternalTotalPressureInWg).toBeNull();
  expect(unknown.reasons.some((r) => r.code === "terminal-total-loss-unknown")).toBe(true);
  const callerTotal = 0.05 + 0.02 - 0.01;
  expect(callerTotal).toBeCloseTo(0.06, 12);
  e.grille.loss = {
    totalLossInWg: callerTotal,
    flowCfm: 100,
    source:
      "Purpose caller conversion: static loss .05, upstream Pv .02, downstream Pv .01 at explicitly declared planes",
  };
  const solved = price(s, {}, work(e)).next.design.circuits[0]!;
  expect(solved.status).toBe("complete-for-declared-design");
  expect(solved.outlet.paths[0]!.rows.find((r) => r.id === 300)?.dp).toBeCloseTo(0.06, 12);
  expect(solved.requiredExternalTotalPressureInWg).toBeCloseTo(
    2 * friction(roundSection(8), 100, 5, 0.0003).dp + 0.1 + 0.06,
    12,
  );
  expect(() =>
    work({
      ...e,
      grille: { ...e.grille, loss: { inWg: 0.06, flowCfm: 100, source: "Ambiguous old field" } },
    } as unknown as Record<string, DuctCalculation>),
  ).toThrow();
});

function sharedFlowFixture() {
  const s = fixture();
  const owner = s.nodes[0]!;
  s.nodes = [
    { ...owner, id: 100, uniqueId: "purpose-100", connectors: [port(0, 500, 0)] },
    { ...owner, id: 400, uniqueId: "purpose-400", connectors: [port(0, 500, 1)] },
    {
      ...owner,
      id: 500,
      uniqueId: "purpose-500",
      kind: "fitting",
      connectors: [port(0, 100, 0), port(1, 400, 0), port(2, 300, 0)],
    },
    {
      ...owner,
      id: 300,
      uniqueId: "purpose-300",
      kind: "terminal",
      connectors: [port(0, 500, 2, "in")],
      facts: [],
    },
  ];
  s.segments = [];
  s.groups = [group("shared", [100, 400], 1)];
  const e: Record<string, DuctCalculation> = {
    scenario: { kind: "balanced-design", source: "Synthetic design" },
    a: {
      kind: "fan",
      element: identity(100),
      inlet: null,
      outlet: pin(s, 100, 0),
      referenceTotalPressureInWg: 0,
      designFlowCfm: 100,
      source: "Synthetic100",
    },
    b: {
      kind: "fan",
      element: identity(400),
      inlet: null,
      outlet: pin(s, 400, 0),
      referenceTotalPressureInWg: 0,
      designFlowCfm: 200,
      source: "Synthetic200",
    },
    t: {
      kind: "terminal",
      element: identity(300),
      port: pin(s, 300, 0),
      role: "demand",
      flowCfm: 300,
      boundaryTotalPressureInWg: 0,
      loss: null,
      source: "Synthetic300",
    },
  };
  return { s, e };
}
it("solves shared component flow once without claiming shared pressure completion", () => {
  const { s, e } = sharedFlowFixture();
  const d = price(s, {}, work(e)).next.design;
  const c = d.componentFlows.find((c) => c.elementIds.includes(100))!;
  expect(c.status).toBe("unique");
  expect(c.maxResidualCfm).toBe(0);
  expect(
    c.edges
      .filter((e) => e.kind === "joint")
      .map((e) => Math.abs(e.signedCfm!))
      .sort((a, b) => a - b),
  ).toEqual([100, 200, 300]);
  expect(d.circuits.map((c) => c.flowCfm)).toEqual([100, 200]);
  expect(
    d.circuits
      .flatMap((c) => c.reasons)
      .some((r) => r.code === "inconsistent-design-flow" || r.code === "inconsistent-mass-demand"),
  ).toBe(false);
  expect(
    d.circuits.every((c) => c.status === "partial" && c.requiredExternalTotalPressureInWg === null),
  ).toBe(true);
});
it("does not invent a shared fan split or silently repair imbalanced demand", () => {
  const { s, e } = sharedFlowFixture();
  if (e.a?.kind !== "fan" || e.b?.kind !== "fan" || e.t?.kind !== "terminal")
    throw Error("fixture roles");
  e.a.designFlowCfm = null;
  e.b.designFlowCfm = null;
  expect(
    price(s, {}, work(e)).next.design.componentFlows.find((c) => c.elementIds.includes(100))!
      .status,
  ).toBe("underdetermined");
  e.a.designFlowCfm = 100;
  e.b.designFlowCfm = 200;
  e.t.flowCfm = 290;
  expect(
    price(s, {}, work(e)).next.design.componentFlows.find((c) => c.elementIds.includes(100))!
      .status,
  ).toBe("inconsistent");
});

function parallelFlowFixture() {
  const { s, e } = sharedFlowFixture();
  const owner = s.nodes[0]!;
  s.nodes = [
    { ...owner, id: 100, uniqueId: "purpose-100", connectors: [port(0, 500, 0)] },
    {
      ...owner,
      id: 500,
      uniqueId: "purpose-500",
      kind: "fitting",
      connectors: [port(0, 100, 0), port(1, 10, 0), port(2, 20, 0)],
    },
    {
      ...owner,
      id: 600,
      uniqueId: "purpose-600",
      kind: "fitting",
      connectors: [port(0, 10, 1), port(1, 20, 1), port(2, 300, 0)],
    },
    {
      ...owner,
      id: 300,
      uniqueId: "purpose-300",
      kind: "terminal",
      connectors: [port(0, 600, 2, "in")],
      facts: [],
    },
  ];
  s.segments = [10, 20].map((id, i) => {
    const a = port(0, 500, i + 1),
      b = port(1, 600, i);
    b.point = [5, 0, 0];
    return { ...fixture().segments[0]!, id, uniqueId: `purpose-${id}`, connectors: [a, b] };
  });
  delete e.b;
  if (e.a?.kind !== "fan" || e.t?.kind !== "terminal") throw Error("fixture roles");
  e.a.designFlowCfm = 300;
  e.a.outlet = pin(s, 100, 0);
  e.t.port = pin(s, 300, 0);
  return { s, e };
}
it("admits sourced cycle allocation by conservation while pressure and KVL remain partial", () => {
  const { s, e } = parallelFlowFixture();
  const before = price(s, {}, work(e)).next.design.componentFlows[0]!;
  expect(before.cycleRank).toBe(1);
  expect(before.status).toBe("underdetermined");
  const constraint = {
    element: identity(10),
    port: pin(s, 10, 0),
    signedCfm: -200,
    source: "Synthetic stated200 design allocation, NOT operating point",
  };
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: structuredClone(before.componentWitness),
    constraints: [constraint],
    source: "Synthetic single component design",
  };
  const d = price(s, {}, work(e)).next.design,
    c = d.componentFlows[0]!;
  expect(c.status).toBe("unique");
  expect(c.edges.filter((e) => e.kind === "duct-subrun").map((e) => e.signedCfm)).toEqual([
    200, 100,
  ]);
  expect(c.edges).toHaveLength(before.edges.length);
  expect(d.circuits[0]!.requiredExternalTotalPressureInWg).toBeNull();
  expect(d.circuits[0]!.reasons.some((r) => r.code === "mesh-not-solved")).toBe(true);
  const edit = work(e);
  s.document.readAt = "2099-01-01";
  expect(price(s, {}, edit).next.design.componentFlows[0]!.status).toBe("unique");
  s.segments[0]!.lengthFt = 6;
  expect(
    price(s, {}, edit).next.design.componentFlows[0]!.reasons.some(
      (r) => r.code === "stale-component-flow",
    ),
  ).toBe(true);
  s.segments[0]!.lengthFt = 5;
  if (e.flow.kind !== "component-flow") throw Error("flow fixture");
  e.flow.constraints.push({ ...constraint, signedCfm: -150 });
  expect(
    price(s, {}, work(e)).next.design.componentFlows[0]!.reasons.some(
      (r) => r.code === "conflicting-flow-constraint",
    ),
  ).toBe(true);
});
it("duplicate constraints do not close a second independent cycle", () => {
  const { s, e } = parallelFlowFixture();
  s.nodes.find((n) => n.id === 500)!.connectors.push(port(3, 30, 0));
  s.nodes.find((n) => n.id === 600)!.connectors.push(port(3, 30, 1));
  const a = port(0, 500, 3),
    b = port(1, 600, 3);
  b.point = [5, 0, 0];
  s.segments.push({ ...s.segments[0]!, id: 30, uniqueId: "purpose-30", connectors: [a, b] });
  const baseline = price(s, {}, work(e)).next.design.componentFlows[0]!;
  expect(baseline.cycleRank).toBe(2);
  const constraint = {
    element: identity(10),
    port: pin(s, 10, 0),
    signedCfm: -200,
    source: "Synthetic200",
  };
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: baseline.componentWitness,
    constraints: [constraint, constraint],
    source: "Dependent constraints",
  };
  expect(price(s, {}, work(e)).next.design.componentFlows[0]!.status).toBe("underdetermined");
});
it("reports real mid-duct subruns4ft at300CFM and6ft at200CFM", () => {
  const { s, e } = sharedFlowFixture(),
    owner = s.nodes[0]!;
  s.nodes = [
    { ...owner, id: 100, uniqueId: "purpose-100", connectors: [port(0, 10, 0)] },
    {
      ...owner,
      id: 500,
      uniqueId: "purpose-500",
      kind: "fitting",
      connectors: [port(0, 10, 2), port(1, 600, 0)],
    },
    {
      ...owner,
      id: 300,
      uniqueId: "purpose-300",
      kind: "terminal",
      connectors: [port(0, 10, 1, "in")],
    },
    {
      ...owner,
      id: 600,
      uniqueId: "purpose-600",
      kind: "terminal",
      connectors: [port(0, 500, 1, "in")],
    },
  ];
  const ps = [port(0, 100, 0), port(1, 300, 0), port(2, 500, 0)];
  ps[1]!.point = [10, 0, 0];
  ps[2]!.point = [4, 0, 0];
  s.segments = [
    {
      ...fixture().segments[0]!,
      id: 10,
      uniqueId: "purpose-10",
      lengthFt: 10,
      polyline: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      connectors: ps,
    },
  ];
  delete e.b;
  if (e.a?.kind !== "fan" || e.t?.kind !== "terminal") throw Error("fixture roles");
  e.a.designFlowCfm = 300;
  e.a.outlet = pin(s, 100, 0);
  e.t.flowCfm = 200;
  e.t.port = pin(s, 300, 0);
  e.branch = { ...e.t, element: identity(600), port: pin(s, 600, 0), flowCfm: 100 };
  const c = price(s, {}, work(e)).next.design.componentFlows.find((c) =>
    c.elementIds.includes(100),
  )!;
  expect(c.status).toBe("unique");
  expect(
    c.edges
      .filter((e) => e.kind === "duct-subrun")
      .map((e) => ({ length: e.lengthFt, q: e.signedCfm })),
  ).toEqual([
    { length: 4, q: 300 },
    { length: 6, q: 200 },
  ]);
});
it("requires sourced signed sense for a bidirectional terminal and refuses foreign constraints", () => {
  const { s, e } = sharedFlowFixture();
  s.nodes.find((n) => n.id === 300)!.connectors[0]!.direction = "bidirectional";
  if (e.t?.kind !== "terminal") throw Error("fixture terminal");
  e.t.port = pin(s, 300, 0);
  const baseline = price(s, {}, work(e)).next.design.componentFlows[0]!;
  expect(baseline.status).toBe("underdetermined");
  const constraint = {
    element: identity(300),
    port: pin(s, 300, 0),
    signedCfm: -300,
    source: "Explicit300CFM withdrawal",
  };
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: baseline.componentWitness,
    constraints: [constraint],
    source: "Known signed terminal sense",
  };
  expect(price(s, {}, work(e)).next.design.componentFlows[0]!.status).toBe("unique");
  constraint.element.uniqueId = "foreign";
  expect(
    price(s, {}, work(e)).next.design.componentFlows[0]!.reasons.some(
      (r) => r.code === "stale-flow-constraint",
    ),
  ).toBe(true);
});

it("never treats a KCL-compatible sourced equal split as KVL/pressure certification or native apply input", () => {
  const { s, e } = parallelFlowFixture();
  const witness = price(s, {}, work(e)).next.design.componentFlows[0]!.componentWitness;
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: witness,
    constraints: [
      {
        element: identity(10),
        port: pin(s, 10, 0),
        signedCfm: -150,
        source: "Synthetic equal split, NOT hydraulic proof",
      },
    ],
    source: "Sourced conditional design",
  };
  const p = price(s, {}, work(e)),
    c = p.next.design.componentFlows[0]!;
  expect(c.status).toBe("unique");
  expect(c.edges.filter((e) => e.kind === "duct-subrun").map((e) => e.signedCfm)).toEqual([
    150, 150,
  ]);
  expect(p.next.design.circuits[0]!.status).toBe("partial");
  expect(p.next.design.circuits[0]!.requiredExternalTotalPressureInWg).toBeNull();
  expect(JSON.stringify(applyRequest(s, p, "purpose-time", []))).not.toContain("componentWitness");
  expect(JSON.stringify(applyRequest(s, p, "purpose-time", []))).not.toContain("signedCfm");
});
it("does not allow independently derived inlet/outlet demands to leak mass through one fan", () => {
  const { s, e } = sharedFlowFixture(),
    owner = s.nodes[0]!;
  s.nodes = [
    { ...owner, id: 100, uniqueId: "purpose-100", connectors: [port(0, 300, 0), port(1, 600, 0)] },
    {
      ...owner,
      id: 300,
      uniqueId: "purpose-300",
      kind: "terminal",
      connectors: [port(0, 100, 0, "out")],
    },
    {
      ...owner,
      id: 600,
      uniqueId: "purpose-600",
      kind: "terminal",
      connectors: [port(0, 100, 1, "in")],
    },
  ];
  delete e.b;
  if (e.a?.kind !== "fan" || e.t?.kind !== "terminal") throw Error("fixture roles");
  e.a.inlet = pin(s, 100, 0);
  e.a.outlet = pin(s, 100, 1);
  e.a.designFlowCfm = null;
  e.t.port = pin(s, 300, 0);
  e.t.flowCfm = 100;
  e.other = { ...e.t, element: identity(600), port: pin(s, 600, 0), flowCfm: 200 };
  const cs = price(s, {}, work(e)).next.design.componentFlows;
  expect(cs.every((c) => c.status === "inconsistent")).toBe(true);
  expect(cs.every((c) => c.reasons.some((r) => r.code === "fan-mass-continuity"))).toBe(true);
});

it("stale component-flow evidence cannot leave a previously complete tree pressure result certified", () => {
  const { s, e } = sharedFlowFixture();
  s.nodes = s.nodes.filter((n) => n.id === 100 || n.id === 300);
  s.nodes[0]!.connectors = [port(0, 300, 0)];
  s.nodes[1]!.connectors = [port(0, 100, 0, "in")];
  delete e.b;
  if (e.a?.kind !== "fan" || e.t?.kind !== "terminal") throw Error("fixture roles");
  e.a.outlet = pin(s, 100, 0);
  e.t.port = pin(s, 300, 0);
  e.t.flowCfm = 100;
  e.t.loss = { flowCfm: 100, totalLossInWg: 0.03, source: "Explicit synthetic TOTAL loss" };
  const before = price(s, {}, work(e)).next.design;
  expect(before.circuits[0]!.status).toBe("complete-for-declared-design");
  const witness = structuredClone(before.componentFlows[0]!.componentWitness);
  witness[0]!.family = "stale family";
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: witness,
    constraints: [
      { element: identity(100), port: pin(s, 100, 0), signedCfm: 100, source: "Design100" },
    ],
    source: "Old component witness",
  };
  const after = price(s, {}, work(e)).next.design;
  expect(after.componentFlows[0]!.status).toBe("inconsistent");
  expect(after.circuits[0]!.status).toBe("partial");
  expect(after.circuits[0]!.requiredExternalTotalPressureInWg).toBeNull();
});

it("retains shared tap station continuity without inventing a zero-length friction subrun", () => {
  const { s, e } = parallelFlowFixture(),
    main = s.segments[0]!,
    owner = s.nodes[0]!;
  main.lengthFt = 10;
  main.polyline = [
    [0, 0, 0],
    [10, 0, 0],
  ];
  main.connectors[1]!.point = [10, 0, 0];
  for (const [id, index] of [
    [700, 2],
    [800, 3],
  ] as const) {
    const p = port(index, id, 0);
    p.point = [4, 0, 0];
    main.connectors.push(p);
    const back = port(0, 10, index);
    back.point = [4, 0, 0];
    s.nodes.push({ ...owner, id, uniqueId: `purpose-${id}`, kind: "cap", connectors: [back] });
  }
  const before = price(s, {}, work(e)).next.design;
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: before.componentFlows.find((c) => c.elementIds.includes(100))!
      .componentWitness,
    constraints: [
      {
        element: identity(10),
        port: pin(s, 10, 0),
        signedCfm: -200,
        source: "Sourced200, no station order evidence",
      },
    ],
    source: "Synthetic coincident taps",
  };
  const d = price(s, {}, work(e)).next.design;
  expect(
    d.componentFlows.flatMap((c) => c.edges).filter((e) => e.kind === "station-arm"),
  ).toHaveLength(2);
  expect(
    d.circuits.every((c) => c.status === "partial" && c.requiredExternalTotalPressureInWg === null),
  ).toBe(true);
  expect(d.graph.ports.filter((p) => p.elementId === 10).map((p) => p.connector.index)).toEqual([
    0, 1, 2, 3,
  ]);
  expect(d.graph.joints).toHaveLength(before.graph.joints.length);
  expect(d.componentFlows.flatMap((c) => c.edges).filter((e) => e.kind === "joint")).toHaveLength(
    d.graph.joints.length,
  );
  expect(
    d.componentFlows
      .flatMap((c) => c.edges)
      .some((e) => e.kind === "duct-subrun" && e.elementId === 10 && e.lengthFt === 0),
  ).toBe(false);
});
it("refuses duct connector projection outside derived native arithmetic error", () => {
  const { s, e } = parallelFlowFixture();
  s.segments[0]!.connectors[0]!.point = [0, 0.005, 0];
  const d = price(s, {}, work(e)).next.design;
  expect(
    d.componentFlows.flatMap((c) => c.reasons).some((r) => r.code === "flow-subrun-geometry"),
  ).toBe(true);
  expect(d.graph.ports.some((p) => p.elementId === 10 && p.connector.index === 0)).toBe(true);
});

it("allows projection residual within derived native arithmetic error", () => {
  const { s, e } = parallelFlowFixture();
  s.segments[0]!.connectors[0]!.point = [0, 1e-14, 0];
  expect(
    price(s, {}, work(e))
      .next.design.componentFlows.flatMap((c) => c.reasons)
      .some((r) => r.code === "flow-subrun-geometry"),
  ).toBe(false);
});

function refusedContinuityFixture() {
  const s = fixture(),
    owner = s.nodes[0]!,
    main = s.segments[0]!;
  const points = [
    [0, 0, 0],
    [10, 0, 0],
    [4, 0, 0],
    [4, 0, 0],
  ];
  s.nodes = [100, 200, 300, 400].map((id, index) => ({
    ...owner,
    id,
    uniqueId: `purpose-${id}`,
    connectors: [{ ...port(0, 10, index), point: points[index]! }],
  }));
  s.segments = [
    {
      ...main,
      lengthFt: 10,
      polyline: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      connectors: s.nodes.map((n, index) => ({
        ...port(index, n.id, 0),
        kind: index < 2 ? "end" : "curve",
        point: points[index]!,
      })),
    },
  ];
  return s;
}
it.each(["unknown-encoding", "missing-polyline", "off-polyline"])(
  "keeps joint flows unknown across %s duct continuity instead of deriving false zero",
  (failure) => {
    const s = refusedContinuityFixture();
    if (failure === "unknown-encoding") Reflect.deleteProperty(s, "coordinateEncoding");
    if (failure === "missing-polyline") s.segments[0]!.polyline = [];
    if (failure === "off-polyline") s.segments[0]!.connectors[2]!.point = [4, 1, 0];
    const cs = price(s, {}, work({})).next.design.componentFlows;
    const joints = cs.flatMap((c) => c.edges.filter((e) => e.kind === "joint"));
    expect(joints).toHaveLength(4);
    expect(joints.every((e) => e.signedCfm === null && e.source === null)).toBe(true);
    expect(cs.every((c) => c.status === "underdetermined" && c.maxResidualCfm === null)).toBe(true);
    expect(cs.flatMap((c) => c.boundaries).filter((b) => b.port.startsWith("10:"))).toHaveLength(4);
  },
);
it("preserves independently stated boundary/constraint flows and legitimate cap zero at refused continuity", () => {
  const s = refusedContinuityFixture();
  s.segments[0]!.polyline = [];
  s.nodes[0]!.connectors[0]!.direction = "out";
  s.nodes[1]!.kind = "cap";
  const e: Record<string, DuctCalculation> = {
    fan: {
      kind: "fan",
      element: identity(100),
      inlet: null,
      outlet: pin(s, 100, 0),
      designFlowCfm: 125,
      referenceTotalPressureInWg: 0,
      source: "Explicit125CFM boundary",
    },
  };
  const baseline = price(s, {}, work(e)).next.design.componentFlows;
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: baseline.find((c) => c.elementIds.includes(300))!.componentWitness,
    constraints: [
      {
        element: identity(300),
        port: pin(s, 300, 0),
        signedCfm: 75,
        source: "Explicit75CFM joint",
      },
    ],
    source: "Independent joint design",
  };
  const cs = price(s, {}, work(e)).next.design.componentFlows;
  const joint = (id: number) =>
    cs
      .flatMap((c) => c.edges)
      .find((e) => e.kind === "joint" && (e.from === `${id}:0` || e.to === `${id}:0`))!;
  expect(Math.abs(joint(100).signedCfm!)).toBe(125);
  expect(joint(100).source).toBe("conservation");
  expect(Math.abs(joint(200).signedCfm!)).toBe(0);
  expect(joint(200).source).toBe("conservation");
  expect(Math.abs(joint(300).signedCfm!)).toBe(75);
  expect(joint(300).source).toBe("staged-constraint");
  expect(joint(400).signedCfm).toBeNull();
  expect(cs.every((c) => c.status === "underdetermined")).toBe(true);
});

function sharedStationFixture(spacing = 0) {
  const s = refusedContinuityFixture();
  const main = s.segments[0]!;
  main.polyline = [
    [293.45470444255335, 591.7499486928011, -12.152641961698464],
    [293.45470444255335, 591.7499486928011, -2.152641961698464],
  ];
  const points = [
    main.polyline[0]!,
    main.polyline[1]!,
    [293.45470444255335, 591.7499486928011, -8.152641961698464],
    [293.45470444255335, 591.7499486928011, -8.152641961698464 + spacing],
  ];
  for (const [i, c] of main.connectors.entries()) {
    c.point = points[i]!;
    s.nodes[i]!.connectors[0]!.point = points[i]!;
  }
  s.nodes[0]!.connectors[0]!.direction = "out";
  for (const node of s.nodes.slice(1)) {
    node.kind = "terminal";
    node.connectors[0]!.direction = "in";
  }
  const e: Record<string, DuctCalculation> = {
    fan: {
      kind: "fan",
      element: identity(100),
      inlet: null,
      outlet: pin(s, 100, 0),
      designFlowCfm: 1500,
      referenceTotalPressureInWg: 0,
      source: "Synthetic1500CFM design",
    },
  };
  for (const [id, flowCfm] of [
    [200, 750],
    [300, 375],
    [400, 375],
  ] as const)
    e[`terminal:${id}`] = {
      kind: "terminal",
      element: identity(id),
      port: pin(s, id, 0),
      role: "demand",
      flowCfm,
      boundaryTotalPressureInWg: 0,
      loss: null,
      source: "Synthetic known withdrawal",
    };
  return { s, e };
}
it("retains opposing shared-station tap ports in a flow-only continuity hub", () => {
  const { s, e } = sharedStationFixture(6e-14);
  const d = price(s, {}, work(e)).next.design,
    c = d.componentFlows.find((c) => c.elementIds.includes(100))!;
  expect(c.status).toBe("unique");
  expect(c.maxResidualCfm).toBe(0);
  expect(c.edges.filter((e) => e.kind === "station-arm").map((e) => e.lengthFt)).toEqual([
    null,
    null,
  ]);
  const runs = c.edges.filter((e) => e.kind === "duct-subrun");
  expect(runs.map((e) => Math.abs(e.signedCfm!))).toEqual([1500, 750]);
  expect(runs.every((e) => e.lengthFt! > 0)).toBe(true);
  expect(runs[0]!.lengthFt).toBeCloseTo(4, 10);
  expect(runs[1]!.lengthFt).toBeCloseTo(6, 10);
  expect(c.edges.filter((e) => e.kind === "joint")).toHaveLength(4);
  expect(
    c.edges
      .filter((e) => e.kind === "joint")
      .map((e) => Math.abs(e.signedCfm!))
      .sort((a, b) => a - b),
  ).toEqual([375, 375, 750, 1500]);
  const original = c.edges;
  s.segments[0]!.polyline.reverse();
  s.segments[0]!.connectors.reverse();
  s.nodes.reverse();
  expect(
    price(s, {}, work(e))
      .next.design.componentFlows.find((c) => c.elementIds.includes(100))!
      .edges.slice()
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual(original.slice().sort((a, b) => a.id.localeCompare(b.id)));
  expect(
    d.circuits.every((c) => c.status === "partial" && c.requiredExternalTotalPressureInWg === null),
  ).toBe(true);
});
it.each([
  1.818198813730021e-9, 2.579633928689873e-8, 3.6704583157853854e-5, 0.0017713385100712742,
  0.0032141193888493014,
])("preserves genuinely ordered native station spacing %s feet", (spacing) => {
  const { s, e } = sharedStationFixture(spacing),
    c = price(s, {}, work(e)).next.design.componentFlows.find((c) => c.elementIds.includes(100))!;
  expect(c.status).toBe("unique");
  expect(c.edges.some((e) => e.kind === "station-arm")).toBe(false);
  const runs = c.edges.filter((e) => e.kind === "duct-subrun");
  expect(runs).toHaveLength(3);
  expect(runs.every((e) => e.lengthFt! > 0)).toBe(true);
});
it.each([undefined, "rounded-3", "foreign"])(
  "refuses unasserted coordinate encoding %s without zero-flow propagation",
  (encoding) => {
    const { s, e } = sharedStationFixture();
    Reflect.set(s, "coordinateEncoding", encoding);
    const cs = price(s, {}, work(e)).next.design.componentFlows;
    expect(cs.every((c) => c.status !== "unique")).toBe(true);
    expect(cs.flatMap((c) => c.reasons).some((r) => r.code === "flow-coordinate-encoding")).toBe(
      true,
    );
    expect(
      cs.flatMap((c) => c.edges).some((e) => e.kind === "duct-subrun" || e.kind === "station-arm"),
    ).toBe(false);
  },
);
it("refuses malformed/nonfinite geometry and unsupported curve length", () => {
  for (const mutation of ["nonfinite", "malformed", "curve"]) {
    const { s, e } = sharedStationFixture();
    const edit = work(e);
    if (mutation === "nonfinite") s.segments[0]!.connectors[2]!.point[0] = Infinity;
    if (mutation === "malformed") s.segments[0]!.polyline[0] = [1, 2];
    if (mutation === "curve") s.segments[0]!.lengthFt = 12;
    const cs = price(s, {}, edit).next.design.componentFlows;
    expect(cs.every((c) => c.status !== "unique")).toBe(true);
    expect(cs.flatMap((c) => c.reasons).some((r) => r.code === "flow-subrun-geometry")).toBe(true);
  }
});

it("preserves all six ports and two actual native shared stations from retained9173326 geometry", () => {
  // Geometry is the frozen after-Pea11 capture; the1500/375/375/750 roles below are synthetic, not project facts.
  const { s, e } = sharedStationFixture(),
    main = s.segments[0]!,
    owner = s.nodes[0]!;
  const z = [
    9.999999999999648, 10.953166666666538, 10.624121941532547, 10.624121941532543,
    10.651015469267557, 10.651015469267556,
  ];
  const points = z.map((v) => [277.87711515041065, 624.6588642540819, v]);
  main.lengthFt = 0.9531666666668901;
  main.polyline = [points[0]!, points[1]!];
  for (let i = 0; i < 4; i++) {
    main.connectors[i]!.point = points[i]!;
    s.nodes[i]!.connectors[0]!.point = points[i]!;
  }
  for (const [i, id] of [
    [4, 500],
    [5, 600],
  ] as const) {
    main.connectors.push({ ...port(i, id, 0), kind: "curve", point: points[i]! });
    s.nodes.push({
      ...owner,
      id,
      uniqueId: `purpose-${id}`,
      kind: "cap",
      connectors: [{ ...port(0, 10, i), point: points[i]! }],
    });
  }
  if (e.fan?.kind !== "fan") throw Error("fixture fan");
  e.fan.outlet = pin(s, 100, 0);
  for (const id of [200, 300, 400]) {
    const t = e[`terminal:${id}`];
    if (t?.kind !== "terminal") throw Error("fixture terminal");
    t.port = pin(s, id, 0);
  }
  const c = price(s, {}, work(e)).next.design.componentFlows.find((c) =>
    c.elementIds.includes(100),
  )!;
  expect(c.status).toBe("unique");
  expect(c.maxResidualCfm).toBe(0);
  expect(c.edges.filter((e) => e.kind === "station-arm")).toHaveLength(4);
  expect(c.edges.filter((e) => e.kind === "duct-subrun")).toHaveLength(3);
  expect(c.edges.filter((e) => e.kind === "joint")).toHaveLength(6);
  expect(
    c.edges
      .filter((e) => e.kind === "joint")
      .map((e) => Math.abs(e.signedCfm!))
      .sort((a, b) => a - b),
  ).toEqual([0, 0, 375, 375, 750, 1500]);
  expect(c.componentWitness.find((w) => w.element.id === 10)!.ports.map((p) => p.index)).toEqual([
    0, 1, 2, 3, 4, 5,
  ]);
});
it("binds component flow Work freshness to coordinate encoding without legacy normalization", () => {
  const { s, e } = sharedStationFixture(),
    w = price(s, {}, work(e)).next.design.componentFlows[0]!.componentWitness;
  expect(w.every((e) => e.coordinateEncoding === "native-double")).toBe(true);
  const old = structuredClone(w);
  for (const e of old) e.coordinateEncoding = null;
  e.flow = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: old,
    constraints: [
      { element: identity(100), port: pin(s, 100, 0), signedCfm: 1500, source: "Sourced1500" },
    ],
    source: "Historical encoding unavailable",
  };
  expect(
    price(s, {}, work(e)).next.design.componentFlows.some((c) =>
      c.reasons.some((r) => r.code === "stale-component-flow"),
    ),
  ).toBe(true);
  for (const record of old) Reflect.deleteProperty(record, "coordinateEncoding");
  expect(() => work(e)).toThrow();
});

it.each([undefined, "arc", "flex-polyline", "other"])(
  "does not certify ordered stations from unsupported curve kind %s",
  (kind) => {
    const { s, e } = sharedStationFixture();
    Reflect.set(s.segments[0]!, "curveKind", kind);
    const before = structuredClone(s.segments[0]!.polyline),
      cs = price(s, {}, work(e)).next.design.componentFlows;
    expect(cs.every((c) => c.status !== "unique")).toBe(true);
    expect(cs.flatMap((c) => c.reasons).some((r) => r.code === "flow-subrun-geometry")).toBe(true);
    expect(s.segments[0]!.polyline).toEqual(before);
    expect(
      cs.flatMap((c) => c.edges).some((e) => e.kind === "duct-subrun" || e.kind === "station-arm"),
    ).toBe(false);
  },
);
it("refuses chained overlapping station envelopes rather than merging numerically distinct groups transitively", () => {
  const { s } = sharedStationFixture(1e-11),
    main = s.segments[0]!,
    owner = s.nodes[0]!;
  const point = [...main.connectors[2]!.point];
  point[2]! += 2e-11;
  main.connectors.push({ ...port(4, 500, 0), kind: "curve", point });
  s.nodes.push({
    ...owner,
    id: 500,
    uniqueId: "purpose-500",
    kind: "cap",
    connectors: [{ ...port(0, 10, 4), point }],
  });
  const cs = price(s, {}, null).next.design.componentFlows;
  expect(cs.flatMap((c) => c.reasons).some((r) => r.code === "ambiguous-flow-stations")).toBe(true);
  expect(
    cs.flatMap((c) => c.edges).some((e) => e.kind === "duct-subrun" || e.kind === "station-arm"),
  ).toBe(false);
});

it("keeps very short positive native line subruns positive without scalar length rounding", () => {
  const s = refusedContinuityFixture(),
    main = s.segments[0]!;
  main.lengthFt = 1e-4;
  main.polyline = [
    [0, 0, 0],
    [1e-4, 0, 0],
  ];
  const points = [
    [0, 0, 0],
    [1e-4, 0, 0],
    [4e-5, 0, 0],
    [4e-5, 0, 0],
  ];
  for (const [i, c] of main.connectors.entries()) {
    c.point = points[i]!;
    s.nodes[i]!.kind = "cap";
    s.nodes[i]!.connectors[0]!.point = points[i]!;
  }
  const c = price(s, {}, null).next.design.componentFlows.find((c) => c.elementIds.includes(10))!;
  expect(c.status).toBe("unique");
  const runs = c.edges.filter((e) => e.kind === "duct-subrun");
  expect(runs).toHaveLength(2);
  expect(runs.every((e) => e.lengthFt! > 0)).toBe(true);
  expect(runs.reduce((sum, e) => sum + e.lengthFt!, 0)).toBeCloseTo(1e-4, 14);
});

it.each(["arc", "flex-polyline"] as const)(
  "retains two-end-port %s mass continuity without inventing a chord loss edge",
  (curveKind) => {
    const { s, e } = sharedStationFixture();
    s.segments[0]!.curveKind = curveKind;
    s.segments[0]!.lengthFt = 12;
    s.segments[0]!.connectors = s.segments[0]!.connectors.slice(0, 2);
    s.nodes = s.nodes.slice(0, 2);
    delete e["terminal:300"];
    delete e["terminal:400"];
    const t = e["terminal:200"];
    if (t?.kind !== "terminal") throw Error("fixture terminal");
    t.flowCfm = 1500;
    const c = price(s, {}, work(e)).next.design.componentFlows[0]!;
    expect(c.status).toBe("unique");
    expect(c.maxResidualCfm).toBe(0);
    expect(
      c.edges
        .filter((e) => e.kind === "curve-continuity")
        .map((e) => ({ q: Math.abs(e.signedCfm!), length: e.lengthFt })),
    ).toEqual([{ q: 1500, length: null }]);
    expect(c.edges.some((e) => e.kind === "duct-subrun")).toBe(false);
    const unknown = price(s, {}, null).next.design.componentFlows[0]!;
    expect(unknown.status).toBe("underdetermined");
    expect(unknown.edges.every((e) => e.signedCfm === null)).toBe(true);
    const duplicate = structuredClone(s);
    duplicate.segments[0]!.connectors[1]!.kind = "curve";
    expect(
      price(duplicate, {}, null)
        .next.design.componentFlows.flatMap((c) => c.edges)
        .some((e) => e.kind === "curve-continuity"),
    ).toBe(false);
  },
);
it("retains nonlinear two-port continuity as a loop leg without claiming hydraulic head", () => {
  const { s, e } = parallelFlowFixture();
  s.segments[0]!.curveKind = "arc";
  s.segments[0]!.lengthFt = 12;
  const d = price(s, {}, work(e)).next.design;
  expect(
    d.componentFlows.some(
      (c) => c.cycleRank === 1 && c.edges.some((e) => e.kind === "curve-continuity"),
    ),
  ).toBe(true);
  expect(
    d.circuits.every((c) => c.status === "partial" && c.requiredExternalTotalPressureInWg === null),
  ).toBe(true);
});

it("closes prescribed-flow pressure over all physical parts without a new fan operating-point claim", () => {
  const s = fixture();
  const point = (x: number) => [x, 0, 0];
  for (const n of s.nodes)
    for (const p of n.connectors) p.point = point(n.id === 100 ? 0 : n.id === 200 ? 5 : 10);
  for (const [i, seg] of s.segments.entries()) {
    seg.polyline = [point(i * 5), point((i + 1) * 5)];
    seg.connectors.forEach((p, j) => {
      p.point = point((i + j) * 5);
    });
  }
  s.nodes.find((n) => n.id === 300)!.connectors[0]!.direction = "in";
  const e = evidence(s);
  const c = price(s, {}, work(e)).next.design.componentFlows.find((c) =>
    c.elementIds.includes(10),
  )!;
  e.closure = {
    kind: "component-flow",
    componentWitness: c.componentWitness,
    constraints: [],
    hydraulics: {
      mode: "prescribed-flow-demand",
      anchors: [],
      laws: [],
      stationEquivalences: [],
      fanAllocations: [],
      source: "Purpose exact prescribed design",
    },
    source: "Purpose closure",
  };
  const result = price(s, {}, work(e)).next.design.componentFlows.find((c) =>
    c.elementIds.includes(10),
  )!;
  expect(result.hydraulics?.status).toBe("complete-for-prescribed-flow");
  expect(result.hydraulics?.fanHeads[0]?.requiredExternalTotalPressureInWg).toBeCloseTo(
    2 * friction(roundSection(8), 100, 5, 0.0003).dp + 0.13,
    12,
  );
});

function prescribedPurpose() {
  const s = fixture();
  const point = (x: number) => [x, 0, 0];
  for (const n of s.nodes)
    for (const p of n.connectors) p.point = point(n.id === 100 ? 0 : n.id === 200 ? 5 : 10);
  for (const [i, d] of s.segments.entries()) {
    d.polyline = [point(i * 5), point((i + 1) * 5)];
    d.connectors.forEach((p, j) => {
      p.point = point((i + j) * 5);
    });
  }
  s.nodes.find((n) => n.id === 300)!.connectors[0]!.direction = "in";
  return { s, e: evidence(s) };
}
const emptyHydraulics = (): DuctHydraulics => ({
  mode: "prescribed-flow-demand",
  anchors: [],
  laws: [],
  stationEquivalences: [],
  fanAllocations: [],
  source: "Purpose stated pressure design",
});
function pressureResult(
  s: DuctSnapshot,
  e: Record<string, DuctCalculation>,
  h = emptyHydraulics(),
) {
  delete e.closure;
  const c = price(s, {}, work(e)).next.design.componentFlows.find((c) =>
    c.elementIds.includes(100),
  )!;
  e.closure = {
    kind: "component-flow",
    hydraulics: h,
    componentWitness: c.componentWitness,
    constraints: [],
    source: "Purpose complete physical component",
  };
  return price(s, {}, work(e)).next.design.componentFlows.find((c) => c.elementIds.includes(100))!
    .hydraulics!;
}
it("withholds unknown flow and pressure law rather than manufacturing zero", () => {
  const { s, e } = prescribedPurpose();
  delete e.grille;
  expect(pressureResult(s, e).status).toBe("partial");
  const v = prescribedPurpose();
  delete v.e.filter;
  v.s.nodes.find((n) => n.id === 200)!.kind = "fitting";
  expect(
    pressureResult(v.s, v.e).reasons.some((r) => r.code === "hydraulic-part-law-unknown"),
  ).toBe(true);
});
it("rejects reciprocal gaps and unequal profile as automatic zero-pressure interfaces", () => {
  for (const change of ["gap", "profile"]) {
    const { s, e } = prescribedPurpose(),
      p = s.nodes.find((n) => n.id === 100)!.connectors[0]!;
    if (change === "gap") p.point = [0.001, 0, 0];
    else p.diameterIn = 9;
    if (e.fan!.kind !== "fan") throw Error("purpose fan");
    e.fan.outlet = pin(s, 100, 0);
    const h = pressureResult(s, e);
    expect(h.status).toBe("partial");
    expect(h.reasons.some((r) => r.code === "hydraulic-interface-unknown")).toBe(true);
  }
});
it("checks every non-tree pressure constraint and rejects incompatible fixed pressure without balancing", () => {
  const { s, e } = prescribedPurpose(),
    h = emptyHydraulics();
  h.anchors = [
    {
      at: { element: identity(100), port: pin(s, 100, 0) },
      kind: "physical-boundary",
      totalPressureInWg: 10,
      source: "Purpose incompatible fixed boundary",
    },
  ];
  const result = pressureResult(s, e, h);
  expect(result.status).toBe("inconsistent");
  expect(result.maxPressureResidualInWg).toBeGreaterThan(1);
});
it("closed recirculation required head is gauge invariant without an ambient-pressure claim", () => {
  const { s, e } = prescribedPurpose();
  s.nodes = s.nodes.filter((n) => n.id !== 300);
  delete e.grille;
  const fan = s.nodes.find((n) => n.id === 100)!;
  fan.connectors.push({ ...port(3, 20, 1, "in"), point: [10, 0, 0] });
  s.segments[1]!.connectors[1]!.connectedTo = { elementId: 100, connector: 3 };
  if (e.fan!.kind !== "fan") throw Error("purpose fan");
  e.fan.inlet = pin(s, 100, 3);
  e.fan.designFlowCfm = 100;
  const first = pressureResult(s, e),
    h = emptyHydraulics();
  h.anchors = [
    {
      at: { element: identity(100), port: pin(s, 100, 0) },
      kind: "gauge",
      totalPressureInWg: 500,
      source: "Computational gauge only",
    },
  ];
  const second = pressureResult(s, e, h);
  expect(first.status).toBe("complete-for-prescribed-flow");
  expect(second.status).toBe(first.status);
  expect(second.fanHeads[0]!.requiredExternalTotalPressureInWg).toBeCloseTo(
    first.fanHeads[0]!.requiredExternalTotalPressureInWg!,
    12,
  );
  expect(second.ports.every((p) => p.totalPressureInWg === null)).toBe(true);
});
it("series fan heads remain unallocated until an explicit matching fan relation is supplied", () => {
  const { s, e } = prescribedPurpose();
  delete e.filter;
  e.second = {
    kind: "fan",
    element: identity(200),
    inlet: pin(s, 200, 1),
    outlet: pin(s, 200, 2),
    designFlowCfm: 100,
    referenceTotalPressureInWg: 0,
    source: "Purpose series fan",
  };
  const first = pressureResult(s, e);
  expect(first.fanHeads.every((f) => f.requiredExternalTotalPressureInWg === null)).toBe(true);
  const h = emptyHydraulics();
  h.fanAllocations = [
    {
      element: identity(200),
      inlet: pin(s, 200, 1),
      outlet: pin(s, 200, 2),
      flowCfm: 100,
      totalRiseInWg: 0.05,
      source: "Explicit series allocation, not equal sharing",
    },
  ];
  const second = pressureResult(s, e, h);
  expect(second.status).toBe("complete-for-prescribed-flow");
  expect(
    second.fanHeads.find((f) => f.elementId === 200)!.requiredExternalTotalPressureInWg,
  ).toBeCloseTo(0.05, 12);
  expect(
    second.fanHeads.find((f) => f.elementId === 100)!.requiredExternalTotalPressureInWg,
  ).not.toBeCloseTo(0.05, 8);
});
function sharedPressurePurpose() {
  const s = fixture();
  s.segments = [];
  s.nodes = [
    { ...s.nodes.find((n) => n.id === 100)!, connectors: [port(0, 400, 0, "out")] },
    { ...s.nodes.find((n) => n.id === 200)!, connectors: [port(0, 400, 1, "out")] },
    {
      ...s.nodes.find((n) => n.id === 300)!,
      category: "Terminal",
      connectors: [port(0, 400, 2, "in")],
    },
    {
      ...s.nodes.find((n) => n.id === 200)!,
      id: 400,
      uniqueId: "purpose-400",
      kind: "fitting",
      connectors: [port(0, 100, 0), port(1, 200, 0), port(2, 300, 0)],
    },
  ];
  s.nodes.find((n) => n.id === 300)!.connectors[0]!.direction = "in";
  const e: Record<string, DuctCalculation> = {
    scenario: { kind: "balanced-design", source: "Purpose design" },
    a: {
      kind: "fan",
      element: identity(100),
      inlet: null,
      outlet: pin(s, 100, 0),
      designFlowCfm: 100,
      referenceTotalPressureInWg: 0,
      source: "Purpose100",
    },
    b: {
      kind: "fan",
      element: identity(200),
      inlet: null,
      outlet: pin(s, 200, 0),
      designFlowCfm: 200,
      referenceTotalPressureInWg: 0,
      source: "Purpose200",
    },
    t: {
      kind: "terminal",
      element: identity(300),
      port: pin(s, 300, 0),
      flowCfm: 300,
      role: "demand",
      boundaryTotalPressureInWg: 0,
      loss: { flowCfm: 300, totalLossInWg: 0.03, source: "PurposeTOTAL" },
      source: "Purpose demand",
    },
  };
  const h = emptyHydraulics(),
    portFlows = [0, 1, 2].map((i) => ({
      at: { element: identity(400), port: pin(s, 400, i) },
      signedCfm: [-100, -200, 300][i]!,
    }));
  h.laws = [
    {
      from: { element: identity(400), port: pin(s, 400, 0) },
      to: { element: identity(400), port: pin(s, 400, 2) },
      signedCfm: 100,
      totalPressureDifferenceInWg: 0.1,
      portFlows,
      source: "Purpose full300=100+200 mixing regime point",
    },
    {
      from: { element: identity(400), port: pin(s, 400, 1) },
      to: { element: identity(400), port: pin(s, 400, 2) },
      signedCfm: 200,
      totalPressureDifferenceInWg: 0.2,
      portFlows,
      source: "Purpose full300=100+200 other inlet regime point",
    },
  ];
  return { s, e, h };
}
it("shared component100+200?300 has distinct sourced required heads and no equal allocation", () => {
  const { s, e, h } = sharedPressurePurpose(),
    result = pressureResult(s, e, h);
  expect(result.status).toBe("complete-for-prescribed-flow");
  expect(
    result.fanHeads.find((f) => f.elementId === 100)!.requiredExternalTotalPressureInWg,
  ).toBeCloseTo(0.13, 12);
  expect(
    result.fanHeads.find((f) => f.elementId === 200)!.requiredExternalTotalPressureInWg,
  ).toBeCloseTo(0.23, 12);
});
it("a changed third-leg flow invalidates a multiport source point despite unchanged geometry", () => {
  const { s, e, h } = sharedPressurePurpose();
  if (e.a!.kind !== "fan" || e.b!.kind !== "fan") throw Error("purpose fan");
  e.a.designFlowCfm = 120;
  e.b.designFlowCfm = 180;
  const result = pressureResult(s, e, h);
  expect(result.status).toBe("partial");
  expect(result.reasons.some((r) => r.code === "hydraulic-law-flow-vector")).toBe(true);
});
it("mixing may transfer pressure between incoming legs but may not generate passive energy", () => {
  const { s, e, h } = sharedPressurePurpose();
  h.laws[0]!.totalPressureDifferenceInWg = -0.1;
  h.laws[1]!.totalPressureDifferenceInWg = 0.2;
  expect(pressureResult(s, e, h).status).toBe("complete-for-prescribed-flow");
  h.laws[1]!.totalPressureDifferenceInWg = -0.2;
  const invalid = pressureResult(s, e, h);
  expect(invalid.status).toBe("inconsistent");
  expect(invalid.fanHeads.every((f) => f.requiredExternalTotalPressureInWg === null)).toBe(true);
  expect(
    invalid.ports.every((p) => p.relativePressureInWg === null && p.totalPressureInWg === null),
  ).toBe(true);
});
it("rejects remote laws, stale pins, and static/unit fields as TOTAL-law authority", () => {
  const { s, e, h } = sharedPressurePurpose();
  h.laws[0]!.to = { element: identity(200), port: pin(s, 200, 0) };
  expect(pressureResult(s, e, h).status).toBe("partial");
  const v = sharedPressurePurpose();
  v.h.laws[0]!.from.port.point = [1, 0, 0];
  expect(pressureResult(v.s, v.e, v.h).status).toBe("partial");
  const bad = { ...emptyHydraulics(), unit: "Pa" };
  expect(ductHydraulicsSchema.safeParse(bad).success).toBe(false);
  expect(
    ductHydraulicsSchema.safeParse({
      ...v.h,
      laws: [{ ...v.h.laws[0], totalStaticPressureInWg: 0.1 }],
    }).success,
  ).toBe(false);
});

it("keeps pressure residuals scoped to the physical pressure network", () => {
  const { s, e, h } = sharedPressurePurpose();
  const other: ReturnType<typeof sharedPressurePurpose> = JSON.parse(
    JSON.stringify(sharedPressurePurpose()),
    (key, value) => {
      if (
        (key === "id" || key === "elementId") &&
        typeof value === "number" &&
        [100, 200, 300, 400].includes(value)
      )
        return value + 1000;
      if (key === "uniqueId" && typeof value === "string" && value.startsWith("purpose-"))
        return `purpose-${Number(value.slice(8)) + 1000}`;
      return value;
    },
  );
  s.nodes.push(...other.s.nodes);
  for (const [k, v] of Object.entries(other.e)) if (k !== "scenario") e[`other:${k}`] = v;
  other.h.laws.push({ ...structuredClone(other.h.laws[0]!), totalPressureDifferenceInWg: 1.1 });
  const bad = price(s, {}, work(e)).next.design.componentFlows.find((c) =>
    c.elementIds.includes(1100),
  )!;
  e.badClosure = {
    kind: "component-flow",
    hydraulics: other.h,
    componentWitness: bad.componentWitness,
    constraints: [],
    source: "Purpose disjoint inconsistent network",
  };
  const valid = pressureResult(s, e, h);
  expect(valid.status).toBe("complete-for-prescribed-flow");
  expect(valid.maxPressureResidualInWg).toBeCloseTo(0, 12);
  const invalid = price(s, {}, work(e)).next.design.componentFlows.find((c) =>
    c.elementIds.includes(1100),
  )!.hydraulics!;
  expect(invalid.status).toBe("inconsistent");
  expect(invalid.maxPressureResidualInWg).toBeGreaterThan(0.9);
  expect(invalid.fanHeads.every((f) => f.requiredExternalTotalPressureInWg === null)).toBe(true);
});

it("preserves4ft at300 and6ft at200 while keeping a solitary tap pressure plane distinct", () => {
  const { s, e } = prescribedPurpose();
  delete e.filter;
  s.segments = [
    {
      ...s.segments[0]!,
      lengthFt: 10,
      polyline: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      connectors: [
        { ...port(0, 100, 0), point: [0, 0, 0] },
        { ...port(1, 300, 0), point: [10, 0, 0] },
        { ...port(2, 200, 0), kind: "curve", point: [4, 0, 0] },
      ],
    },
  ];
  const branch = s.nodes.find((n) => n.id === 200)!;
  branch.kind = "terminal";
  branch.connectors = [{ ...port(0, 10, 2, "in"), point: [4, 0, 0] }];
  s.nodes.find((n) => n.id === 300)!.connectors[0] = { ...port(0, 10, 1, "in"), point: [10, 0, 0] };
  if (e.fan!.kind !== "fan" || e.grille!.kind !== "terminal") throw Error("purpose roles");
  e.fan.designFlowCfm = 300;
  e.grille.port = pin(s, 300, 0);
  e.grille.flowCfm = 200;
  e.grille.loss = { flowCfm: 200, totalLossInWg: 0.03, source: "Purpose TOTAL200" };
  e.branch = {
    kind: "terminal",
    element: identity(200),
    port: pin(s, 200, 0),
    role: "demand",
    flowCfm: 100,
    boundaryTotalPressureInWg: 0,
    loss: {
      flowCfm: 100,
      totalLossInWg: 0.03 + friction(roundSection(8), 200, 6, 0.0003).dp,
      source: "Purpose compatible branch TOTAL point",
    },
    source: "Purpose100 branch",
  };
  const unresolved = pressureResult(s, e);
  expect(unresolved.status).toBe("partial");
  expect(unresolved.reasons.some((r) => r.code === "hydraulic-part-law-unknown")).toBe(true);
  const h = emptyHydraulics();
  h.stationEquivalences = [
    {
      element: identity(10),
      ports: [pin(s, 10, 2)],
      source:
        "Purpose explicitly justified same8in cross-section pressure plane, no unrepresented tap loss",
    },
  ];
  const solved = pressureResult(s, e, h);
  expect(solved.status).toBe("complete-for-prescribed-flow");
  expect(solved.fanHeads[0]!.requiredExternalTotalPressureInWg).toBeCloseTo(
    0.03 +
      friction(roundSection(8), 300, 4, 0.0003).dp +
      friction(roundSection(8), 200, 6, 0.0003).dp,
    12,
  );
  expect(
    solved.lawEvidence.some(
      (l) => l.from.includes("pressure-station") || l.to.includes("pressure-station"),
    ),
  ).toBe(true);
  s.segments[0]!.connectors[2]!.diameterIn = 6;
  branch.connectors[0]!.diameterIn = 6;
  if (e.branch.kind !== "terminal") throw Error("purpose branch");
  e.branch.port = pin(s, 200, 0);
  h.stationEquivalences[0]!.ports = [pin(s, 10, 2)];
  const unequal = pressureResult(s, e, h);
  expect(unequal.status).toBe("partial");
  expect(unequal.reasons.some((r) => r.code === "hydraulic-station-equivalence")).toBe(true);
});

it("retains unrequested fan-side dependency evidence once and refuses its missing joint pressure law", () => {
  const { s, e } = prescribedPurpose(),
    fan = s.nodes.find((n) => n.id === 100)!;
  fan.connectors.push({ ...port(3, 30, 1, "in"), point: [-5, 0, 0] });
  s.nodes.push({
    ...s.nodes.find((n) => n.id === 300)!,
    id: 400,
    uniqueId: "purpose-400",
    connectors: [{ ...port(0, 30, 0, "out"), point: [-8, 0, 0] }],
  });
  s.segments.push({
    ...s.segments[0]!,
    id: 30,
    uniqueId: "purpose-30",
    lengthFt: 3,
    polyline: [
      [-8, 0, 0],
      [-5, 0, 0],
    ],
    connectors: [
      { ...port(0, 400, 0), point: [-8, 0, 0] },
      { ...port(1, 100, 3), point: [-5, 0, 0] },
    ],
  });
  if (e.fan!.kind !== "fan") throw Error("purpose fan");
  e.fan.inlet = pin(s, 100, 3);
  e.fan.designFlowCfm = 100;
  e.intake = {
    kind: "terminal",
    element: identity(400),
    port: pin(s, 400, 0),
    role: "reference",
    flowCfm: 100,
    boundaryTotalPressureInWg: 0,
    loss: { flowCfm: 100, totalLossInWg: 0.02, source: "Purpose inlet TOTAL" },
    source: "Purpose outdoor boundary",
  };
  const head = pressureResult(s, e);
  expect(head.status).toBe("complete-for-prescribed-flow");
  expect(head.physicalComponentIds).toHaveLength(2);
  const components = price(s, {}, work(e)).next.design.componentFlows.filter((c) =>
    head.physicalComponentIds.includes(c.id),
  );
  expect(components.every((c) => c.hydraulics !== null)).toBe(true);
  expect(components.some((c) => c.hydraulics!.lawEvidence.some((l) => l.elementId === 30))).toBe(
    true,
  );
  expect(
    components.every((c) => c.hydraulics!.ports.length < c.hydraulics!.physicalPortCount),
  ).toBe(true);
  s.segments.find((s) => s.id === 30)!.connectors[1]!.diameterIn = 9;
  const broken = pressureResult(s, e);
  expect(broken.status).toBe("partial");
  expect(broken.reasons.some((r) => r.code === "hydraulic-interface-unknown")).toBe(true);
  expect(broken.fanHeads[0]!.requiredExternalTotalPressureInWg).toBeNull();
});

it("admits sourced physical-interface loss with outward flow sense and rejects interface energy creation", () => {
  const { s, e } = prescribedPurpose(),
    h = emptyHydraulics();
  s.nodes.find((n) => n.id === 100)!.connectors[0]!.point = [0.001, 0, 0];
  if (e.fan!.kind !== "fan") throw Error("purpose fan");
  e.fan.outlet = pin(s, 100, 0);
  const from = { element: identity(100), port: pin(s, 100, 0) },
    to = { element: identity(10), port: pin(s, 10, 0) };
  h.laws = [
    {
      from,
      to,
      signedCfm: 100,
      portFlows: [
        { at: from, signedCfm: 100 },
        { at: to, signedCfm: -100 },
      ],
      totalPressureDifferenceInWg: 0.02,
      source: "Purpose sourced interface total-pressure point",
    },
  ];
  const admitted = pressureResult(s, e, h);
  expect(admitted.status).toBe("complete-for-prescribed-flow");
  expect(admitted.fanHeads[0]!.requiredExternalTotalPressureInWg).toBeCloseTo(
    2 * friction(roundSection(8), 100, 5, 0.0003).dp + 0.15,
    12,
  );
  h.laws[0]!.totalPressureDifferenceInWg = -0.02;
  const forwardGain = pressureResult(s, e, h);
  expect(forwardGain.status).toBe("inconsistent");
  expect(
    forwardGain.ports.every((p) => p.relativePressureInWg === null && p.totalPressureInWg === null),
  ).toBe(true);
  expect(forwardGain.fanHeads.every((f) => f.requiredExternalTotalPressureInWg === null)).toBe(
    true,
  );
  h.laws = [
    { ...h.laws[0]!, from: to, to: from, signedCfm: -100, totalPressureDifferenceInWg: -0.02 },
  ];
  const reversed = pressureResult(s, e, h);
  expect(reversed.status).toBe("complete-for-prescribed-flow");
  expect(reversed.fanHeads[0]!.requiredExternalTotalPressureInWg).toBeCloseTo(
    admitted.fanHeads[0]!.requiredExternalTotalPressureInWg!,
    12,
  );
  h.laws[0]!.totalPressureDifferenceInWg = 0.02;
  const bad = pressureResult(s, e, h);
  expect(bad.status).toBe("inconsistent");
  expect(bad.fanHeads.every((f) => f.requiredExternalTotalPressureInWg === null)).toBe(true);
  expect(
    bad.ports.every((p) => p.relativePressureInWg === null && p.totalPressureInWg === null),
  ).toBe(true);
});

it("direct physical interfaces require native-double encoding before automatic pressure equivalence", () => {
  const { s, e } = prescribedPurpose();
  s.nodes = s.nodes.filter((n) => n.id === 100 || n.id === 300);
  s.segments = [];
  s.nodes.find((n) => n.id === 100)!.connectors[0]!.connectedTo = { elementId: 300, connector: 0 };
  s.nodes.find((n) => n.id === 300)!.connectors[0]!.connectedTo = { elementId: 100, connector: 0 };
  s.nodes.find((n) => n.id === 300)!.connectors[0]!.point = [0, 0, 0];
  delete e.filter;
  if (e.fan!.kind !== "fan" || e.grille!.kind !== "terminal") throw Error("purpose roles");
  e.fan.outlet = pin(s, 100, 0);
  e.grille.port = pin(s, 300, 0);
  expect(pressureResult(s, e).status).toBe("complete-for-prescribed-flow");
  // Deliberately decoded untrusted legacy JSON violates the current producer DTO.
  const legacySnapshot = JSON.parse(JSON.stringify(s));
  legacySnapshot.coordinateEncoding = null;
  const legacy = pressureResult(legacySnapshot, e);
  expect(legacy.status).toBe("partial");
  expect(legacy.reasons.some((r) => r.code === "hydraulic-flow-not-unique")).toBe(true);
  expect(legacy.fanHeads[0]!.requiredExternalTotalPressureInWg).toBeNull();
});

function openPhysicalFanPurpose(flow: number | null = 300) {
  const s = fixture();
  const fan = s.nodes[0]!,
    grille = s.nodes[2]!;
  fan.connectors = [port(0, 300, 0, "out")];
  grille.connectors = [port(0, 100, 0, "in")];
  grille.category = "Air Terminals";
  grille.terminalDrop = { catalogDropInWg: 0.1, writable: false };
  s.nodes = [fan, grille];
  s.nodes[0]!.connectors.push({
    ...port(3, 999, 0, "in"),
    point: [0, 0, -1],
    shape: "rectangular",
    diameterIn: null,
    widthIn: 17.5,
    heightIn: 21,
    connectedTo: null,
  });
  s.nodes[1]!.connectors[0]!.direction = "in";
  s.nodes[1]!.facts =
    flow === null ? [] : [{ key: "flow", value: flow, unit: "cfm", provenance: "designer-stated" }];
  s.segments = [];
  // The ERV is the base equipment of the system it serves: a proposed fan.
  s.groups = [{ ...group("downstream", [100], 1), systemNames: ["SA up"] }];
  const inlet = ductPortPinSchema.parse({
    index: 3,
    point: [0, 0, -1],
    shape: "rectangular",
    diameterIn: null,
    widthIn: 17.5,
    heightIn: 21,
    direction: "in",
    connectedTo: null,
  });
  const e: Record<string, DuctCalculation> = {
    fan: {
      kind: "fan",
      element: identity(100),
      inlet,
      outlet: pin(s, 100, 0),
      designFlowCfm: null,
      referenceTotalPressureInWg: 999,
      source: "Purpose actual open exterior inlet, NOT conceptual reservoir",
    },
    grille: {
      kind: "terminal",
      element: identity(300),
      port: pin(s, 300, 0),
      role: "demand",
      flowCfm: flow,
      boundaryTotalPressureInWg: 0,
      loss: { flowCfm: 300, totalLossInWg: 0.1, source: "Purpose stated TOTAL drop" },
      source: "Purpose demand",
    },
  };
  const components = price(s, {}, work(e)).next.design.componentFlows;
  for (const c of components)
    e[`hyd:${c.id}`] = {
      kind: "component-flow",
      constraints: [],
      componentWitness: c.componentWitness,
      hydraulics: ductHydraulicsSchema.parse({
        ...emptyHydraulics(),
        anchors: c.boundaries.some((b) => b.port === "100:3")
          ? [
              {
                at: { element: identity(100), port: inlet },
                kind: "physical-boundary",
                totalPressureInWg: -0.01,
                source:
                  "Purpose sourced face Pt: reservoir0 minus entrance0.01 at300; NOT automatic ambient0",
              },
            ]
          : [],
      }),
      source: "Purpose open-face hydraulic scope",
    };
  return { s, e, inlet };
}
it("binds an actual open fan face and transfers only qualified same-fan flow", () => {
  const { s, e } = openPhysicalFanPurpose();
  const result = price(s, {}, work(e)).next.design;
  const open = result.componentFlows.find((c) => c.boundaries.some((b) => b.port === "100:3"))!;
  expect(open.status).toBe("unique");
  expect(open.edges).toEqual([]);
  expect(open.boundaries[0]).toMatchObject({
    injectionCfm: -300,
    externalExchange: { ownerOutwardCfm: -300, inflowCfm: 300, derivation: "fan-continuity" },
  });
  expect(open.maxResidualCfm).toBe(0);
  const head = result.componentFlows
    .flatMap((c) => c.hydraulics?.fanHeads ?? [])
    .find((f) => f.id === "fan")!;
  expect(head.flowCfm).toBe(300);
  expect(head.requiredExternalTotalPressureInWg).toBeCloseTo(0.11, 12);
  expect(
    result.componentFlows.every((c) => c.hydraulics?.status === "complete-for-prescribed-flow"),
  ).toBe(true);
  expect(result.circuits.every((c) => c.status === "partial")).toBe(true);
});

it("keeps separate open ERV fan streams on one cabinet without exchanging their flows", () => {
  const { s, e, inlet } = openPhysicalFanPurpose();
  for (const name of Object.keys(e)) if (name.startsWith("hyd:")) delete e[name];
  const fan = s.nodes[0]!;
  fan.connectors.push({ ...fan.connectors[1]!, index: 5, point: [0, 0, -2] });
  fan.connectors.push(port(2, 400, 0, "out"));
  const grille = structuredClone(s.nodes[1]!);
  grille.id = 400;
  grille.uniqueId = "purpose-400";
  grille.connectors = [port(0, 100, 2, "in")];
  grille.facts = [{ key: "flow", value: 75, unit: "cfm", provenance: "designer-stated" }];
  s.nodes.push(grille);
  const inletB = ductPortPinSchema.parse({ ...inlet, index: 5, point: [0, 0, -2] });
  e.fanB = {
    kind: "fan",
    element: identity(100),
    inlet: inletB,
    outlet: pin(s, 100, 2),
    designFlowCfm: null,
    referenceTotalPressureInWg: 0,
    source: "Second actual ERV stream",
  };
  e.grilleB = {
    kind: "terminal",
    element: identity(400),
    port: pin(s, 400, 0),
    role: "demand",
    flowCfm: 75,
    boundaryTotalPressureInWg: 0,
    loss: { totalLossInWg: 0.1, flowCfm: 75, source: "Purpose" },
    source: "Purpose",
  };
  const result = price(s, {}, work(e)).next.design.componentFlows;
  const boundaries = result.flatMap((c) => c.boundaries);
  expect(boundaries.find((b) => b.port === "100:3")?.externalExchange?.ownerOutwardCfm).toBe(-300);
  expect(boundaries.find((b) => b.port === "100:5")?.externalExchange?.ownerOutwardCfm).toBe(-75);
  expect(result.every((c) => c.status === "unique")).toBe(true);
});

it("does not turn unknown exterior flow or missing face pressure into a known head", () => {
  for (const mode of ["unknown", "pressure"] as const) {
    const { s, e } = openPhysicalFanPurpose(mode === "unknown" ? null : 300);
    if (mode === "pressure")
      for (const value of Object.values(e))
        if (value.kind === "component-flow" && value.hydraulics) value.hydraulics.anchors = [];
    const components = price(s, {}, work(e)).next.design.componentFlows;
    const open = components.find((c) => c.boundaries.some((b) => b.port === "100:3"))!;
    if (mode === "unknown") {
      expect(open.status).toBe("underdetermined");
      expect(open.maxResidualCfm).toBeNull();
      expect(open.boundaries[0]!.externalExchange!.ownerOutwardCfm).toBeNull();
    }
    expect(
      components
        .flatMap((c) => c.hydraulics?.fanHeads ?? [])
        .every((f) => f.requiredExternalTotalPressureInWg === null),
    ).toBe(true);
  }
});

it("invalidates exact open fan pins when native identity, geometry, sense or peer changes", () => {
  for (const mode of ["peer", "disconnect", "uid", "point", "width", "direction"] as const) {
    const { s, e } = openPhysicalFanPurpose();
    const node = s.nodes[0]!,
      p = node.connectors[1]!;
    if (mode === "peer") p.connectedTo = { elementId: 300, connector: 0 };
    if (mode === "disconnect") node.connectors[0]!.connectedTo = null;
    if (mode === "uid") node.uniqueId = "replaced-owner";
    if (mode === "point") p.point = [0, 0, -2];
    if (mode === "width") p.widthIn = 18;
    if (mode === "direction") p.direction = "out";
    const result = price(s, {}, work(e)).next.design;
    expect(result.reasons.some((r) => r.code === "stale-port-evidence")).toBe(true);
    expect(
      result.componentFlows
        .flatMap((c) => c.hydraulics?.fanHeads ?? [])
        .every((f) => f.requiredExternalTotalPressureInWg === null),
    ).toBe(true);
  }
});

it("refuses contradictory fan design flow and leaves unclaimed open equipment unknown", () => {
  const { s, e } = openPhysicalFanPurpose();
  if (e.fan?.kind !== "fan") throw Error("Purpose fan");
  e.fan.designFlowCfm = 200;
  let components = price(s, {}, work(e)).next.design.componentFlows;
  expect(components.some((c) => c.status === "inconsistent")).toBe(true);
  expect(
    components
      .flatMap((c) => c.hydraulics?.fanHeads ?? [])
      .every((f) => f.requiredExternalTotalPressureInWg === null),
  ).toBe(true);
  delete e.fan;
  for (const name of Object.keys(e)) if (name.startsWith("hyd:")) delete e[name];
  components = price(s, {}, work(e)).next.design.componentFlows;
  const open = components.find((c) => c.boundaries.some((b) => b.port === "100:3"))!;
  expect(open.status).toBe("underdetermined");
  expect(open.boundaries[0]!.injectionCfm).toBeNull();
  expect(open.boundaries[0]!.externalExchange).toBeUndefined();
});

it("keeps component joint constraints connected-only while admitting exact open fan pins", () => {
  const { s, inlet } = openPhysicalFanPurpose();
  const componentWitness = price(s, {}, work({})).next.design.componentFlows[0]!.componentWitness;
  expect(() =>
    ductsRouteState.schema.parse({
      calculation: {
        bad: {
          edit: {
            value: {
              kind: "component-flow",
              componentWitness,
              constraints: [
                {
                  element: identity(100),
                  port: inlet,
                  signedCfm: -300,
                  source: "Cannot be an open native joint",
                },
              ],
              hydraulics: null,
              source: "Purpose",
            },
          },
        },
      },
    }),
  ).toThrow();
});

it("never promotes an open passive face into an automatic exterior premise", () => {
  const { s, e, inlet } = openPhysicalFanPurpose();
  e.fan = {
    kind: "passive",
    element: identity(100),
    ports: [inlet, pin(s, 100, 0)],
    loss: {
      flowCfm: 300,
      totalLossInWg: 0,
      source: "Purpose explicitly stated passive loss point",
    },
    source: "Purpose passive open equipment",
  };
  for (const name of Object.keys(e)) if (name.startsWith("hyd:")) delete e[name];
  const components = price(s, {}, work(e)).next.design.componentFlows;
  const open = components.flatMap((c) => c.boundaries).find((b) => b.port === "100:3")!;
  expect(open.injectionCfm).toBeNull();
  expect(open.externalExchange).toBeUndefined();
  expect(components.every((c) => c.status === "underdetermined")).toBe(true);
});

it("uses explicit fan design flow including stated zero without reading native placeholders", () => {
  for (const q of [0, 300]) {
    const { s, e } = openPhysicalFanPurpose(q);
    if (e.fan?.kind !== "fan") throw Error("Purpose fan");
    e.fan.designFlowCfm = q;
    const result = price(s, {}, work(e)).next.design.componentFlows;
    const open = result.find((c) => c.boundaries.some((b) => b.port === "100:3"))!;
    expect(open.status).toBe("unique");
    expect(open.boundaries[0]!.externalExchange).toMatchObject({
      ownerOutwardCfm: -q,
      inflowCfm: q,
      derivation: "fan-design",
    });
  }
});
