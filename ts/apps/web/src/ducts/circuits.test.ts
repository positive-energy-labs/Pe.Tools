import { expect, it } from "vite-plus/test";
import {
  applyPatches,
  transitionPatches,
  ductsRouteState,
  type DuctCalculation,
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
    document: {
      title: "Purpose fixture, NOT Chadds",
      readAt: "2026-10-15T00:00:00Z",
      elapsedMs: 0,
    },
    levels: [],
    groups: [group("upstream", [100, 200], 0), group("downstream", [200], 1)],
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
    systems: [],
  } as unknown as DuctSnapshot;
}
function pin(s: DuctSnapshot, id: number, index: number): DuctPortPin {
  const elements = [...s.nodes, ...s.segments];
  const c = elements.find((e) => e.id === id)!.connectors.find((c) => c.index === index)!;
  const to = c.connectedTo!;
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
const work = (values: Record<string, DuctCalculation>, staged = true) =>
  ductsRouteState.schema.parse({
    calculation: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        staged ? { staged: { value } } : { proposal: { value } },
      ]),
    ),
  });

it("charges a staged passive once on the actual fan circuit while retaining legacy arithmetic", () => {
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

it("uses generic Work proposal/staging guards and refuses lossy scalar unit writes", () => {
  const s = fixture(),
    value = evidence(s).filter!;
  const env = { version: 1 as const, revision: 3, doc: ductsRouteState.schema.parse({}) };
  const propose = transitionPatches(
    ["calculation"],
    "filter",
    {},
    { kind: "propose", rung: { value } },
  );
  expect(applyPatches(ductsRouteState, env, "agent", propose, 3)).toMatchObject({ ok: true });
  const stage = transitionPatches(
    ["calculation"],
    "filter",
    {},
    { kind: "stage", rung: { value } },
  );
  expect(applyPatches(ductsRouteState, env, "agent", stage, 3)).toMatchObject({
    ok: false,
    kind: "refused",
  });
  expect(applyPatches(ductsRouteState, env, "human", stage, 3)).toMatchObject({ ok: true });
  expect(applyPatches(ductsRouteState, env, "human", stage, 2)).toMatchObject({ ok: false });
  const doc = work(evidence(s));
  doc.unitStatics["100"] = { staged: { value: { inWg: 0.2 } } };
  expect(() => applyRequest(s, price(s, {}, doc), "purpose-time", "")).toThrow(
    "no admitted manufacturer scalar ESP mapping",
  );
  delete doc.unitStatics["100"];
  doc.unitStatics["200"] = { staged: { value: { inWg: 0.2 } } };
  expect(() => applyRequest(s, price(s, {}, structuredClone(doc)), "purpose-time", "")).toThrow(
    "no admitted manufacturer scalar ESP mapping",
  );
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
  const staged = work(e);
  s.document.readAt = "2099-01-01";
  expect(price(s, {}, staged).next.design.componentFlows[0]!.status).toBe("unique");
  s.segments[0]!.lengthFt = 6;
  expect(
    price(s, {}, staged).next.design.componentFlows[0]!.reasons.some(
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
  expect(JSON.stringify(applyRequest(s, p, "purpose-time", ""))).not.toContain("componentWitness");
  expect(JSON.stringify(applyRequest(s, p, "purpose-time", ""))).not.toContain("signedCfm");
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

it("refuses distinct tap ports at one axial station instead of inventing a zero-length ordered subrun", () => {
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
    d.componentFlows.filter((c) => c.elementIds.includes(10)).every((c) => c.status !== "unique"),
  ).toBe(true);
  expect(
    d.componentFlows.flatMap((c) => c.reasons).some((r) => r.code === "ambiguous-flow-stations"),
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
it("refuses duct connector projection outside the collector coordinate rounding bound", () => {
  const { s, e } = parallelFlowFixture();
  s.segments[0]!.connectors[0]!.point = [0, 0.005, 0];
  const d = price(s, {}, work(e)).next.design;
  expect(
    d.componentFlows.flatMap((c) => c.reasons).some((r) => r.code === "flow-subrun-geometry"),
  ).toBe(true);
  expect(d.graph.ports.some((p) => p.elementId === 10 && p.connector.index === 0)).toBe(true);
});

it("allows projection residual within the explicit conservative coordinate rounding bound", () => {
  const { s, e } = parallelFlowFixture();
  s.segments[0]!.connectors[0]!.point = [0, 0.001, 0];
  expect(
    price(s, {}, work(e))
      .next.design.componentFlows.flatMap((c) => c.reasons)
      .some((r) => r.code === "flow-subrun-geometry"),
  ).toBe(false);
});
