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
      referencePressureInWg: 0,
      designFlowCfm: null,
      source: "Purpose fan external-plane role",
    },
    filter: {
      kind: "passive",
      element: identity(200),
      ports: [pin(s, 200, 1), pin(s, 200, 2)],
      loss: { flowCfm: 100, inWg: 0.1, source: "Purpose catalog point at100CFM" },
      source: "Purpose inline filter role",
    },
    grille: {
      kind: "terminal",
      element: identity(300),
      port: pin(s, 300, 0),
      role: "demand",
      flowCfm: null,
      pressureInWg: 0,
      loss: null,
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
  e.filter.loss = { flowCfm: 0, inWg: 0, source: "Purpose explicit zero-flow loss" };
  e.grille.loss = { flowCfm: 0, inWg: 0, source: "Purpose explicit zero-flow loss" };
  const c = price(s, {}, work(e)).next.design.circuits[0]!;
  expect(c.status).toBe("complete-for-declared-design");
  expect(c.requiredExternalTotalPressureInWg).toBe(0);
  e.filter.loss.inWg = 0.1;
  expect(
    price(s, {}, work(e)).next.design.circuits[0]!.reasons.some(
      (r) => r.code === "nonzero-loss-at-zero-flow",
    ),
  ).toBe(true);
  const unknown = fixture(),
    u = evidence(unknown);
  unknown.nodes.find((n) => n.id === 300)!.terminalDrop = {
    catalogDropInWg: null,
    assignedPressureDropInWg: 0,
    connectorLossMethod: "ConnectorLossMethodNotDefined",
    writable: false,
  };
  const partial = price(unknown, {}, work(u)).next.design.circuits[0]!;
  expect(partial.requiredExternalTotalPressureInWg).toBeNull();
  expect(partial.reasons.some((r) => r.code === "terminal-drop-authority")).toBe(true);
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
      referencePressureInWg: 0,
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
      pressureInWg: 0,
      loss: {
        inWg: s.nodes.find((n) => n.id === id)!.terminalDrop!.catalogDropInWg!,
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
        referencePressureInWg: 0,
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
