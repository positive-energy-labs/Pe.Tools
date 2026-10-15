import { prescribedHydraulics } from "./hydraulic-closure.ts";
import { componentFlows, type ComponentFlow } from "./component-flows.ts";
import { physicalGraph, type PhysicalGraph, type CircuitReason } from "./physical-graph.ts";
import type { DuctCalculation, DuctPortPin } from "@pe/agent-contracts";
import type { GroupTree } from "./topology.ts";
import { terminalCfm } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";
import { friction, sectionOf } from "./loss-physics.ts";
import type { Overrides, Row } from "./losses.ts";

type Fan = Extract<DuctCalculation, { kind: "fan" }>;
export interface CircuitSide {
  port: number | null;
  elementIds: number[];
  flowCfm: number | null;
  continuityResidualCfm: number | null;
  jointFlows: { from: string; to: string; cfm: number }[];
  totalPressureInWg: number | null;
  paths: {
    terminalId: number;
    flowCfm: number;
    total: number;
    rows: Row[];
    balancingInWg: number | null;
  }[];
  backEdges: [number, number][];
  reasons: CircuitReason[];
}
export interface DesignCircuit {
  id: string;
  equipmentId: number;
  uniqueId: string;
  flowCfm: number | null;
  inlet: CircuitSide;
  outlet: CircuitSide;
  requiredExternalTotalPressureInWg: number | null;
  requiredExternalStaticPressureInWg: number | null;
  status: "complete-for-declared-design" | "partial";
  reasons: CircuitReason[];
}
export interface CircuitResult {
  basis: "balanced-design-demand";
  graph: PhysicalGraph;
  coverage: {
    equipment: number;
    passiveEquipment: number;
    fanEquipment: number;
    fanCircuits: number;
    unassignedEquipmentPorts: number;
    terminals: number;
    admittedTerminals: number;
    reachedTerminals: number;
  };
  circuits: DesignCircuit[];
  componentFlows: ComponentFlow[];
  reasons: CircuitReason[];
}
const key = (id: number, port: number) => `${id}:${port}`;
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const reason = (code: string, elementId: number | null, message: string): CircuitReason => ({
  code,
  elementId,
  message,
});

/** The existing tree constitutive evaluator is also the reduced, loop-free circuit evaluator. */
export function designCircuits(
  snapshot: DuctSnapshot,
  evidence: Readonly<Record<string, DuctCalculation>>,
  overrides: Overrides,
  evaluate: (
    tree: GroupTree,
    below: Map<number, number>,
    overrides: Overrides,
  ) => { terminalId: number; rows: Row[]; total: number }[],
): CircuitResult {
  const physical = physicalGraph(snapshot, evidence);
  const flowComponents = prescribedHydraulics(physical, componentFlows(physical));
  const {
    elements,
    nodes,
    segments,
    passives,
    terminals,
    validFans,
    scenarios,
    reasons,
    graph,
    adjacent,
    badJoints,
  } = physical;
  const makeSide = (
    fan: Fan,
    pin: DuctPortPin | null,
  ): { side: CircuitSide; tree: GroupTree | null; terminalFlows: Map<number, number | null> } => {
    const side: CircuitSide = {
      port: pin?.index ?? null,
      elementIds: [],
      flowCfm: null,
      continuityResidualCfm: null,
      jointFlows: [],
      totalPressureInWg: pin ? null : fan.referenceTotalPressureInWg,
      paths: [],
      backEdges: [],
      reasons: [],
    };
    if (!pin) return { side, tree: null, terminalFlows: new Map() };
    const start = pin.connectedTo.id;
    if (!adjacent.has(start)) {
      side.reasons.push(
        reason(
          "unknown-equipment-boundary",
          start,
          "Fan port meets equipment without admitted passive continuity",
        ),
      );
      return { side, tree: null, terminalFlows: new Map() };
    }
    const parent = new Map<number, number | null>([[start, null]]);
    const children = new Map<number, number[]>();
    const order = [start];
    for (let k = 0; k < order.length; k++) {
      const x = order[k]!;
      children.set(x, []);
      let usedParent = false;
      for (const y of adjacent.get(x)!) {
        if (y === parent.get(x) && !usedParent) {
          usedParent = true;
          continue;
        }
        if (parent.has(y)) {
          if (x <= y || y === parent.get(x)) side.backEdges.push([x, y]);
        } else {
          parent.set(y, x);
          children.get(x)!.push(y);
          order.push(y);
        }
      }
    }
    side.elementIds = [...order].sort((a, b) => a - b);
    const members = new Set(order);
    const attached = new Set<string>();
    for (const id of order) {
      const e = elements.get(id)!;
      if (!e.uniqueId)
        side.reasons.push(
          reason("missing-stable-identity", id, "Historical element has no native UniqueId"),
        );
      if (badJoints.has(id))
        side.reasons.push(reason("nonreciprocal-joint", id, "Physical joint is not reciprocal"));
      for (const c of e.connectors) {
        if (!c.connectedTo && nodes.get(id)?.kind !== "cap")
          side.reasons.push(
            reason("open-physical-boundary", id, `Unstated open connector ${c.index}`),
          );
        if (c.connectedTo && !members.has(c.connectedTo.elementId))
          attached.add(key(c.connectedTo.elementId, c.connectedTo.connector));
      }
    }
    if (attached.size !== 1 || !attached.has(key(fan.element.id, pin.index)))
      side.reasons.push(
        reason(
          "unresolved-fan-allocation",
          fan.element.id,
          "Shared/series component pressure allocation and converging loss regimes are not implemented; component KCL flow is reported separately",
        ),
      );
    if (side.backEdges.length)
      side.reasons.push(
        reason(
          "mesh-not-solved",
          fan.element.id,
          "Full physical backedges retained; no route was cut to certify a tree result",
        ),
      );
    const terminalIds = order.filter((id) => nodes.get(id)?.kind === "terminal");
    if (!terminalIds.length)
      side.reasons.push(
        reason(
          "no-pressure-boundary",
          fan.element.id,
          "No explicit terminal/reference pressure boundary",
        ),
      );
    const terminalFlows = new Map<number, number | null>();
    for (const id of terminalIds) {
      const t = terminals.get(id);
      if (!t)
        side.reasons.push(
          reason(
            "missing-terminal-evidence",
            id,
            "Terminal role and pressure boundary are not staged",
          ),
        );
      const flow = t
        ? (t.flowCfm ?? (t.role === "demand" ? terminalCfm(nodes.get(id)) : null))
        : null;
      terminalFlows.set(id, flow != null && Number.isFinite(flow) && flow >= 0 ? flow : null);
      if (children.get(id)!.length)
        side.reasons.push(
          reason("through-terminal", id, "A terminal is not a leaf in the physical graph"),
        );
    }
    const parts = new Map(
      order.map((id) => {
        const node = nodes.get(id) ?? null,
          segment = segments.get(id) ?? null;
        return [id, { id, node, segment, lengthFt: segment?.lengthFt ?? 0, cfm: null }];
      }),
    );
    const dist = new Map<number, number>();
    for (const id of order)
      dist.set(
        id,
        (parent.get(id) == null ? 0 : dist.get(parent.get(id)!)!) + parts.get(id)!.lengthFt,
      );
    const tree: GroupTree = {
      groupId: `circuit:${fan.element.id}:${pin.index}`,
      root: { equipment: fan.element.id, port: pin.index, element: start },
      rootWord: "explicit physical fan port",
      rooted: "port",
      extraRoots: [],
      parts,
      order,
      parent,
      children,
      dist,
      backEdges: side.backEdges,
      terminals: terminalIds,
      longest: [],
      issuesByElement: new Map(),
    };
    return { side, tree, terminalFlows };
  };
  const circuits = validFans.map(({ id, value: fan }): DesignCircuit => {
    const inlet = makeSide(fan, fan.inlet),
      outlet = makeSide(fan, fan.outlet);
    const circuitReasons: CircuitReason[] = [];
    if (scenarios.length !== 1)
      circuitReasons.push(
        reason(
          "balanced-design-not-staged",
          fan.element.id,
          "Exactly one sourced balanced-design scenario must be staged",
        ),
      );
    const totals = [inlet, outlet]
      .filter((s) => s.tree && !s.side.reasons.some((r) => r.code === "unresolved-fan-allocation"))
      .map((s) =>
        [...s.terminalFlows.values()].every((q) => q != null)
          ? [...s.terminalFlows.values()].reduce<number>((a, b) => a + b!, 0)
          : null,
      );
    const known = totals.filter((q): q is number => q != null);
    const boundaryFlows = flowComponents.flatMap((c) =>
      c.status === "unique"
        ? c.boundaries
            .filter((b) =>
              [fan.inlet, fan.outlet].some((p) => p && b.port === key(fan.element.id, p.index)),
            )
            .map((b) => Math.abs(b.injectionCfm!))
        : [],
    );
    const q = fan.designFlowCfm ?? boundaryFlows[0] ?? known[0] ?? null;
    if (q == null)
      circuitReasons.push(
        reason(
          "unknown-design-flow",
          fan.element.id,
          "Fan demand is neither stated nor uniquely derived from terminal demands",
        ),
      );
    if (q != null && known.some((n) => !close(n, q)))
      circuitReasons.push(
        reason(
          "inconsistent-design-flow",
          fan.element.id,
          "Inlet, outlet and stated fan design flow disagree",
        ),
      );
    for (const [which, s] of [
      ["inlet", inlet],
      ["outlet", outlet],
    ] as const) {
      s.side.flowCfm = q;
      if (!s.tree) continue;
      const component = flowComponents.find((c) =>
        c.edges.some(
          (e) =>
            e.from === key(fan.element.id, s.side.port!) ||
            e.to === key(fan.element.id, s.side.port!),
        ),
      );
      if (component) {
        s.side.jointFlows = component.edges
          .filter((e) => e.kind === "joint" && e.signedCfm != null)
          .map((e) => ({
            from: e.signedCfm! >= 0 ? e.from : e.to,
            to: e.signedCfm! >= 0 ? e.to : e.from,
            cfm: Math.abs(e.signedCfm!),
          }));
        if (
          component.status === "inconsistent" ||
          (component.status !== "unique" &&
            s.side.reasons.some((r) => r.code === "unresolved-fan-allocation"))
        )
          s.side.reasons.push(...component.reasons);
      }
      if (s.side.reasons.some((r) => r.code === "unresolved-fan-allocation")) {
        s.side.continuityResidualCfm = component?.maxResidualCfm ?? null;
        continue;
      }
      const unknown = [...s.terminalFlows].filter(([, v]) => v == null);
      const knownSum = [...s.terminalFlows.values()].reduce<number>((a, b) => a + (b ?? 0), 0);
      if (
        unknown.length === 1 &&
        q != null &&
        q >= knownSum &&
        terminals.get(unknown[0]![0])?.role === "reference"
      )
        s.terminalFlows.set(unknown[0]![0], q - knownSum);
      if ([...s.terminalFlows.values()].some((v) => v == null))
        s.side.reasons.push(
          reason(
            "unknown-terminal-flow",
            fan.element.id,
            "Terminal/reference flow allocation is underdetermined",
          ),
        );
      if (
        q != null &&
        !close(
          [...s.terminalFlows.values()].reduce<number>((a, b) => a + (b ?? 0), 0),
          q,
        )
      )
        s.side.reasons.push(
          reason(
            "inconsistent-mass-demand",
            fan.element.id,
            "Terminal boundary flows do not conserve fan design flow",
          ),
        );
      if (q != null && ![...s.terminalFlows.values()].some((v) => v == null))
        s.side.continuityResidualCfm =
          [...s.terminalFlows.values()].reduce<number>((a, b) => a + b!, 0) - q;
      const below = new Map<number, number>();
      for (const part of [...s.tree.order].reverse())
        below.set(
          part,
          (s.terminalFlows.get(part) ?? 0) +
            s.tree.children.get(part)!.reduce((a, b) => a + (below.get(b) ?? 0), 0),
        );
      const componentDrop = { ...overrides.componentDrop };
      const terminalPs = { ...overrides.terminalPs };
      for (const part of s.tree.order) {
        const passive = passives.get(part);
        if (passive) {
          if (!close(passive.loss.flowCfm, below.get(part)!))
            s.side.reasons.push(
              reason(
                "passive-loss-off-design-point",
                part,
                "Stated loss is only valid at its sourced design flow; no curve was fabricated",
              ),
            );
          if (passive.loss.flowCfm === 0 && passive.loss.totalLossInWg !== 0)
            s.side.reasons.push(
              reason(
                "nonzero-loss-at-zero-flow",
                part,
                "Passive aerodynamic design loss cannot be nonzero at zero flow",
              ),
            );
          componentDrop[part] = passive.loss.totalLossInWg;
        }
        const element = elements.get(part)!;
        if (new Set(element.connectors.map((c) => c.index)).size !== element.connectors.length)
          s.side.reasons.push(
            reason("ambiguous-connector-index", part, "Physical connector indices repeat"),
          );
        const up = s.tree.parent.get(part);
        const towardRoot = element.connectors.find(
          (c) =>
            c.connectedTo?.elementId === (up ?? fan.element.id) &&
            (up != null || c.connectedTo?.connector === s.side.port),
        );
        const direction = towardRoot?.direction.toLowerCase();
        if (direction === (which === "outlet" ? "out" : "in"))
          s.side.reasons.push(
            reason(
              "contradictory-design-direction",
              part,
              "Native connector direction contradicts the staged physical fan path",
            ),
          );
        const segment = segments.get(part);
        if (
          segment &&
          (!(segment.lengthFt >= 0) ||
            !Number.isFinite(segment.lengthFt) ||
            !(segment.roughness.valueFt >= 0) ||
            !Number.isFinite(segment.roughness.valueFt))
        )
          s.side.reasons.push(
            reason("invalid-segment-input", part, "Length or roughness is negative/non-finite"),
          );
        if (segment?.kind === "flex" && segment.roughness.provenance === "revit-default")
          s.side.reasons.push(
            reason(
              "unknown-flex-roughness",
              part,
              "Rigid default roughness does not establish flex-duct design loss",
            ),
          );
        const node = nodes.get(part);
        if (node && node.kind !== "equipment" && overrides.componentDrop?.[part] != null)
          s.side.reasons.push(
            reason(
              "component-drop-design-point-unknown",
              part,
              "Legacy scalar component cell has no exact port/flow-point witness for physical circuit certification",
            ),
          );
        if (node?.kind === "accessory")
          s.side.reasons.push(
            reason(
              "unverified-accessory-rule",
              part,
              "Generic damper table selection does not establish accessory construction/opening applicability",
            ),
          );
        if (node?.partType === "Elbow") {
          const angle = node.facts.find((f) => f.key === "angle")?.value;
          if (angle == null || !close(angle, 90))
            s.side.reasons.push(
              reason(
                "unverified-elbow-angle",
                part,
                "Existing elbow rule does not establish measured 90-degree applicability",
              ),
            );
        }
        if (
          which === "inlet" &&
          node &&
          (node.connectors.length > 2 || node.partType?.startsWith("Tap"))
        )
          s.side.reasons.push(
            reason(
              "reverse-junction-regime",
              part,
              "Rooted takeoff law does not establish physical converging-flow loss",
            ),
          );
        const t = terminals.get(part);
        if (t) {
          if (t.loss) {
            if (!close(t.loss.flowCfm, s.terminalFlows.get(part) ?? NaN))
              s.side.reasons.push(
                reason(
                  "terminal-loss-off-design-point",
                  part,
                  "Catalog design-point loss does not match terminal flow",
                ),
              );
            if (t.loss.flowCfm === 0 && t.loss.totalLossInWg !== 0)
              s.side.reasons.push(
                reason(
                  "nonzero-loss-at-zero-flow",
                  part,
                  "Terminal aerodynamic design loss cannot be nonzero at zero flow",
                ),
              );
            terminalPs[part] = t.loss.totalLossInWg;
          } else {
            s.side.reasons.push(
              reason(
                "terminal-total-loss-unknown",
                part,
                "Explicit terminal TOTAL-loss design point is required; legacy catalog/static cells have no admitted pressure-basis conversion",
              ),
            );
          }
        }
      }
      if (s.side.reasons.length || circuitReasons.length) continue;
      s.side.jointFlows = s.tree.order.map((part) => {
        const parent = s.tree!.parent.get(part);
        const c = elements
          .get(part)!
          .connectors.find(
            (c) =>
              c.connectedTo?.elementId === (parent ?? fan.element.id) &&
              (parent != null || c.connectedTo?.connector === s.side.port),
          )!;
        const a = key(part, c.index),
          b = key(c.connectedTo!.elementId, c.connectedTo!.connector);
        return {
          from: which === "outlet" ? b : a,
          to: which === "outlet" ? a : b,
          cfm: below.get(part)!,
        };
      });
      s.side.paths = evaluate(s.tree, below, {
        ...overrides,
        componentDrop,
        terminalPs,
        terminalCfm: Object.fromEntries([...s.terminalFlows].map(([id, q]) => [id, q!])),
      }).map((p) => ({ ...p, flowCfm: s.terminalFlows.get(p.terminalId)!, balancingInWg: null }));
      if (s.side.paths.some((p) => p.rows.some((r) => !Number.isFinite(r.dp))))
        s.side.reasons.push(
          reason(
            "nonfinite-loss",
            fan.element.id,
            "Constitutive loss calculation returned a non-finite value",
          ),
        );
      if (s.side.paths.some((p) => p.rows.some((r) => r.notes?.some((n) => /clamp/i.test(n)))))
        s.side.reasons.push(
          reason(
            "table-domain-clamped",
            fan.element.id,
            "A table input was clamped outside its represented range; no circuit completeness claim",
          ),
        );
      if (s.side.paths.some((p) => p.rows.some((r) => r.error)))
        s.side.reasons.push(
          reason(
            "unpriced-circuit-path",
            fan.element.id,
            "Constitutive path rows remain unpriced; totals are partial arithmetic",
          ),
        );
      if (!s.side.reasons.length) {
        const pressures = s.side.paths.map(
          (p) =>
            terminals.get(p.terminalId)!.boundaryTotalPressureInWg +
            (which === "outlet" ? p.total : -p.total),
        );
        s.side.totalPressureInWg =
          which === "outlet" ? Math.max(...pressures) : Math.min(...pressures);
        s.side.paths.forEach((p, i) => {
          p.balancingInWg = Math.abs(s.side.totalPressureInWg! - pressures[i]!);
        });
      }
    }
    const allReasons = [
      ...flowComponents
        .filter((c) => c.hydraulics && c.elementIds.includes(fan.element.id))
        .flatMap((c) => c.hydraulics!.reasons),
      ...circuitReasons,
      ...inlet.side.reasons,
      ...outlet.side.reasons,
      ...reasons.filter(
        (r) =>
          r.elementId === null ||
          r.elementId === fan.element.id ||
          inlet.side.elementIds.includes(r.elementId!) ||
          outlet.side.elementIds.includes(r.elementId!),
      ),
    ];
    if (snapshot.storeError)
      allReasons.push(
        reason(
          "unreadable-model-store",
          fan.element.id,
          "Applied table choices/provenance are unknown",
        ),
      );
    const consumedNodes = [
      ...new Set([...inlet.side.elementIds, ...outlet.side.elementIds]),
    ].flatMap((id) => nodes.get(id) ?? []);
    if (
      consumedNodes.some((n) =>
        n.facts.some((f) => f.key === "familyCoefficient" && f.value != null && f.value > 0),
      )
    )
      allReasons.push(
        reason(
          "native-family-coefficient-parity",
          fan.element.id,
          "Shared arithmetic does not consume native positive family coefficient precedence",
        ),
      );
    if (
      consumedNodes.some(
        (n) =>
          n.kind === "accessory" &&
          overrides.componentDrop?.[n.id] == null &&
          n.facts.some((f) => f.key === "pressureDrop" && f.value != null),
      )
    )
      allReasons.push(
        reason(
          "native-accessory-drop-parity",
          fan.element.id,
          "Observed accessory own drop is not consumed by shared arithmetic",
        ),
      );
    if (
      [...inlet.side.paths, ...outlet.side.paths].some((p) =>
        p.rows.some((r) => r.c != null && r.c < 0),
      )
    )
      allReasons.push(
        reason(
          "native-negative-coefficient-parity",
          fan.element.id,
          "Native and shared negative coefficient behavior differs",
        ),
      );
    const total =
      allReasons.length ||
      inlet.side.totalPressureInWg == null ||
      outlet.side.totalPressureInWg == null
        ? null
        : outlet.side.totalPressureInWg - inlet.side.totalPressureInWg;
    // Static/total conversion belongs to the exact exterior planes, not a summed classification maximum.
    const velocityPressure = (pin: DuctPortPin | null) => {
      if (!pin) return 0;
      const section = sectionOf(pin.shape, pin.diameterIn, pin.widthIn, pin.heightIn);
      return section && q != null ? friction(section, q, 0).pv : null;
    };
    const pvi = velocityPressure(fan.inlet),
      pvo = velocityPressure(fan.outlet);
    if (total != null && (pvi == null || pvo == null))
      allReasons.push(
        reason(
          "unknown-external-velocity-pressure",
          fan.element.id,
          "Exact port area is required for static/total conversion",
        ),
      );
    return {
      id,
      equipmentId: fan.element.id,
      uniqueId: fan.element.uniqueId,
      flowCfm: q,
      inlet: inlet.side,
      outlet: outlet.side,
      requiredExternalTotalPressureInWg: total,
      requiredExternalStaticPressureInWg:
        total != null && pvi != null && pvo != null ? total - (pvo - pvi) : null,
      status: allReasons.length ? "partial" : "complete-for-declared-design",
      reasons: allReasons,
    };
  });
  if (!circuits.length)
    reasons.push(
      reason(
        "no-admitted-fan-circuits",
        null,
        "No staged physical fan evidence; legacy group totals remain separate partial arithmetic",
      ),
    );
  const equipment = snapshot.nodes.filter((n) => n.kind === "equipment");
  const claimedPorts = new Set(
    [...passives.values()].flatMap((p) => p.ports.map((port) => key(p.element.id, port.index))),
  );
  for (const fan of validFans)
    for (const port of [fan.value.inlet, fan.value.outlet])
      if (port) claimedPorts.add(key(fan.value.element.id, port.index));
  const coverage = {
    equipment: equipment.length,
    passiveEquipment: passives.size,
    fanEquipment: new Set(validFans.map((f) => f.value.element.id)).size,
    fanCircuits: circuits.length,
    unassignedEquipmentPorts: equipment.reduce(
      (a, n) => a + n.connectors.filter((c) => !claimedPorts.has(key(n.id, c.index))).length,
      0,
    ),
    terminals: snapshot.nodes.filter((n) => n.kind === "terminal").length,
    admittedTerminals: terminals.size,
    reachedTerminals: new Set(
      circuits.flatMap((c) => [...c.inlet.paths, ...c.outlet.paths].map((p) => p.terminalId)),
    ).size,
  };
  return {
    basis: "balanced-design-demand",
    graph,
    coverage,
    circuits,
    componentFlows: flowComponents,
    reasons,
  };
}
