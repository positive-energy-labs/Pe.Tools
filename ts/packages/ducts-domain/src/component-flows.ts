import type { DuctComponentWitness } from "@pe/agent-contracts";
import { terminalCfm } from "./topology.ts";
import type { physicalGraph, CircuitReason } from "./physical-graph.ts";

type Graph = ReturnType<typeof physicalGraph>;
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  kind: "joint" | "duct-subrun" | "fitting-arm" | "passive";
  elementId: number;
  lengthFt: number | null;
  signedCfm: number | null;
  source: "conservation" | "staged-constraint" | null;
}
export interface ComponentFlow {
  id: string;
  elementIds: number[];
  componentWitness: DuctComponentWitness;
  status: "unique" | "underdetermined" | "inconsistent";
  nodeCount: number;
  cycleRank: number;
  unknownEdges: number;
  maxResidualCfm: number | null;
  edges: FlowEdge[];
  boundaries: { port: string; injectionCfm: number | null; source: string }[];
  reasons: CircuitReason[];
}
const portKey = (id: number, index: number) => `${id}:${index}`;
// DuctSnapshots.cs:394-395 rounds model-foot XYZ coordinates to 3 decimals.
// Each point has <=sqrt(3)*0.0005 ft error; connector vs interpolated polyline doubles it.
const projectionToleranceFt = Math.sqrt(3) * 0.001 + 1e-9;
const stationSeparationFt = 2 * projectionToleranceFt;
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
const canonicalPolyline = (points: number[][]) => {
  const reversed = [...points].reverse();
  return (JSON.stringify(points) <= JSON.stringify(reversed) ? points : reversed).map((p) => [
    ...p,
  ]);
};
const issue = (code: string, elementId: number | null, message: string): CircuitReason => ({
  code,
  elementId,
  message,
});

/** Stated-design KCL only. Fitting hubs express mass continuity, never equal pressure or a loss law. */
export function componentFlows(g: Graph): ComponentFlow[] {
  const edges: FlowEdge[] = [];
  const vertices = new Map<string, number>();
  const geometryReasons = new Map<number, CircuitReason[]>();
  const portNode = (id: number, index: number) => {
    const k = portKey(id, index);
    vertices.set(k, id);
    return k;
  };
  const add = (
    from: string,
    to: string,
    kind: FlowEdge["kind"],
    elementId: number,
    lengthFt: number | null = null,
  ) => {
    edges.push({
      id: `${kind}:${from}|${to}`,
      from,
      to,
      kind,
      elementId,
      lengthFt,
      signedCfm: null,
      source: null,
    });
  };
  for (const e of g.elements.values()) for (const c of e.connectors) portNode(e.id, c.index);
  for (const j of g.graph.joints)
    if (j.reciprocal) add(j.a, j.b, "joint", Number(j.a.split(":")[0]));
  for (const e of g.elements.values()) {
    const ps = [...e.connectors].sort((a, b) => a.index - b.index);
    if (e.kind === "equipment") {
      const passive = g.passives.get(e.id);
      if (passive)
        add(
          portKey(e.id, passive.ports[0].index),
          portKey(e.id, passive.ports[1].index),
          "passive",
          e.id,
        );
      continue;
    }
    if (e.kind === "terminal" || e.kind === "cap") continue;
    if (e.kind === "duct" || e.kind === "flex") {
      const polyline = canonicalPolyline(e.polyline);
      const legs = polyline.slice(1).map((p, i) => distance(p, polyline[i]!));
      const total = legs.reduce((a, b) => a + b, 0);
      if (!(total > 0) || !Number.isFinite(total) || !(e.lengthFt >= 0) || ps.length < 2) {
        geometryReasons.set(e.id, [
          issue(
            "flow-subrun-geometry",
            e.id,
            "Duct polyline/length or connector census cannot establish ordered subruns",
          ),
        ]);
        continue;
      }
      const located = ps
        .map((p) => {
          let best = { error: Infinity, at: 0 };
          let run = 0;
          for (let i = 0; i < legs.length; i++) {
            const a = polyline[i]!,
              b = polyline[i + 1]!;
            const delta = b.map((v, k) => v - a[k]!);
            const square = delta.reduce((sum, v) => sum + v * v, 0);
            const t =
              square === 0
                ? 0
                : Math.max(
                    0,
                    Math.min(
                      1,
                      delta.reduce((sum, v, k) => sum + v * (p.point[k]! - a[k]!), 0) / square,
                    ),
                  );
            const error = distance(
              p.point,
              a.map((v, k) => v + t * delta[k]!),
            );
            if (error < best.error) best = { error, at: run + t * legs[i]! };
            run += legs[i]!;
          }
          return { p, ...best };
        })
        .sort((a, b) => a.at - b.at || a.p.index - b.p.index);
      // This capture-error bound establishes projection applicability, not physical partner coincidence.
      if (
        located.some((p) => p.error > projectionToleranceFt) ||
        located[0]!.at > projectionToleranceFt ||
        total - located.at(-1)!.at > projectionToleranceFt
      ) {
        geometryReasons.set(e.id, [
          issue(
            "flow-subrun-geometry",
            e.id,
            "Connectors exceed the snapshot 3-decimal XYZ rounding bound (sqrt(3)*0.001 ft); subrun geometry is not established",
          ),
        ]);
        continue;
      }
      if (located.some((p, i) => i > 0 && p.at - located[i - 1]!.at <= stationSeparationFt)) {
        geometryReasons.set(e.id, [
          issue(
            "ambiguous-flow-stations",
            e.id,
            "Distinct duct connectors have coincident or capture-indistinguishable axial stations; no ordered subruns are asserted",
          ),
        ]);
        continue;
      }
      for (let i = 1; i < located.length; i++)
        add(
          portKey(e.id, located[i - 1]!.p.index),
          portKey(e.id, located[i]!.p.index),
          "duct-subrun",
          e.id,
          ((located[i]!.at - located[i - 1]!.at) / total) * e.lengthFt,
        );
    } else if (ps.length > 1) {
      const hub = `${e.id}:continuity`;
      vertices.set(hub, e.id);
      for (const p of ps) add(portKey(e.id, p.index), hub, "fitting-arm", e.id);
    }
  }
  const incident = new Map([...vertices.keys()].map((k) => [k, [] as number[]]));
  edges.forEach((e, i) => {
    incident.get(e.from)?.push(i);
    incident.get(e.to)?.push(i);
  });
  const consumedDesigns = new Set<string>();
  const seen = new Set<string>(),
    results: ComponentFlow[] = [];
  const fanPorts = new Map<string, { injection: number | null; source: string }>();
  for (const f of g.validFans)
    for (const [side, sign] of [
      [f.value.inlet, -1],
      [f.value.outlet, 1],
    ] as const)
      if (side)
        fanPorts.set(portKey(f.value.element.id, side.index), {
          injection: f.value.designFlowCfm == null ? null : sign * f.value.designFlowCfm,
          source: f.value.source,
        });
  for (const first of [...vertices.keys()].sort()) {
    if (seen.has(first)) continue;
    const todo = [first],
      memberEdges = new Set<number>();
    seen.add(first);
    for (let i = 0; i < todo.length; i++)
      for (const index of incident.get(todo[i]!) ?? []) {
        memberEdges.add(index);
        const e = edges[index]!,
          other = e.from === todo[i] ? e.to : e.from;
        if (!seen.has(other)) {
          seen.add(other);
          todo.push(other);
        }
      }
    const members = new Set(todo),
      elementIds = [...new Set(todo.map((k) => vertices.get(k)!))].sort((a, b) => a - b);
    const reasons = [
      ...elementIds.flatMap((id) => geometryReasons.get(id) ?? []),
      ...g.reasons.filter((r) => r.elementId == null || elementIds.includes(r.elementId)),
    ];
    if (
      elementIds.some((id) => {
        const ports = g.elements.get(id)!.connectors;
        return new Set(ports.map((p) => p.index)).size !== ports.length;
      })
    )
      reasons.push(
        issue(
          "flow-ambiguous-port-index",
          null,
          "Native connector indices repeat; physical joint identity is ambiguous",
        ),
      );
    if (elementIds.some((id) => !g.elements.get(id)?.uniqueId))
      reasons.push(
        issue("flow-stable-identity", null, "Component has missing stable native identity"),
      );
    if (elementIds.some((id) => g.badJoints.has(id)))
      reasons.push(
        issue("flow-nonreciprocal-joint", null, "Component contains nonreciprocal joint evidence"),
      );
    const witness: DuctComponentWitness = elementIds.map((id) => {
      const e = g.elements.get(id)!;
      const rolePartitions = [...g.passives.values()]
        .filter((p) => p.element.id === id)
        .map(
          (p) =>
            `passive:${p.ports
              .map((p) => p.index)
              .sort((a, b) => a - b)
              .join(",")}`,
        );
      for (const f of g.validFans.filter((f) => f.value.element.id === id))
        rolePartitions.push(
          `fan:${f.value.inlet?.index ?? "reservoir"}->${f.value.outlet?.index ?? "reservoir"}`,
        );
      const terminal = g.terminals.get(id);
      if (terminal) rolePartitions.push(`terminal:${terminal.port.index}:${terminal.role}`);
      return {
        element: { id, uniqueId: e.uniqueId ?? "" },
        kind: e.kind,
        family: "family" in e ? (e.family ?? null) : null,
        type: "type" in e ? (e.type ?? null) : null,
        partType: "partType" in e ? (e.partType ?? null) : null,
        classification: "classification" in e ? (e.classification ?? null) : null,
        ports: [...e.connectors]
          .sort((a, b) => a.index - b.index)
          .map((p) => ({
            index: p.index,
            kind: p.kind,
            point: [...p.point],
            shape: p.shape,
            diameterIn: p.diameterIn ?? null,
            widthIn: p.widthIn ?? null,
            heightIn: p.heightIn ?? null,
            direction: p.direction,
            classification: p.classification ?? null,
            connectedTo: p.connectedTo
              ? {
                  id: p.connectedTo.elementId,
                  uniqueId: g.elements.get(p.connectedTo.elementId)?.uniqueId ?? null,
                  connector: p.connectedTo.connector,
                }
              : null,
          })),
        polyline: "polyline" in e ? canonicalPolyline(e.polyline) : null,
        lengthFt: "lengthFt" in e ? e.lengthFt : null,
        rolePartitions: rolePartitions.sort(),
      };
    });
    const ce = [...memberEdges].sort((a, b) => a - b).map((i) => edges[i]!);
    const boundaries: ComponentFlow["boundaries"] = [];
    const injection = new Map(todo.map((k) => [k, 0 as number | null]));
    const inferable = new Set<string>();
    const terminalMagnitudes = new Map<string, number | null>();
    for (const k of todo) {
      if (k.endsWith(":continuity")) continue;
      const id = vertices.get(k)!,
        e = g.elements.get(id)!,
        p = e.connectors.find((p) => portKey(id, p.index) === k)!;
      const fan = fanPorts.get(k);
      if (fan) {
        injection.set(k, fan.injection);
        if (fan.injection == null) inferable.add(k);
        boundaries.push({ port: k, injectionCfm: fan.injection, source: fan.source });
        continue;
      }
      if (e.kind === "equipment" && !g.passives.has(id)) {
        injection.set(k, null);
        boundaries.push({
          port: k,
          injectionCfm: null,
          source: "Unknown equipment continuity/role",
        });
        continue;
      }
      if (e.kind === "terminal") {
        const t = g.terminals.get(id);
        const stated = t
          ? (t.flowCfm ?? (t.role === "demand" ? terminalCfm(g.nodes.get(id)) : null))
          : null;
        const q = stated != null && Number.isFinite(stated) && stated >= 0 ? stated : null;
        const sign =
          p.direction.toLowerCase() === "in" ? -1 : p.direction.toLowerCase() === "out" ? 1 : null;
        const value = q != null && sign != null ? sign * q : null;
        terminalMagnitudes.set(k, q);
        injection.set(k, value);
        if (t?.role === "reference" && q == null && sign != null) inferable.add(k);
        boundaries.push({
          port: k,
          injectionCfm: value,
          source: t?.source ?? "Terminal role/flow/sense not staged",
        });
      } else if (!p.connectedTo && e.kind !== "cap") {
        injection.set(k, null);
        boundaries.push({ port: k, injectionCfm: null, source: "Unstated open physical port" });
      }
    }
    const touched = g.flowDesigns.filter(
      ([, d]) =>
        d.kind === "component-flow" &&
        (d.constraints.some((c) => members.has(portKey(c.element.id, c.port.index))) ||
          JSON.stringify(d.componentWitness.map((w) => w.element.id)) ===
            JSON.stringify(elementIds)),
    );
    let contradictory = touched.length > 1;
    if (touched.length > 1)
      reasons.push(
        issue(
          "multiple-component-flow-designs",
          null,
          "Stage one complete flow design entry per physical component",
        ),
      );
    for (const [name, d] of touched) {
      consumedDesigns.add(name);
      if (d.kind !== "component-flow") continue;
      if (JSON.stringify(d.componentWitness) !== JSON.stringify(witness)) {
        reasons.push(
          issue(
            "stale-component-flow",
            null,
            `${name}: complete component content/role witness differs`,
          ),
        );
        contradictory = true;
        continue;
      }
      for (const c of d.constraints) {
        const from = portKey(c.element.id, c.port.index),
          to = portKey(c.port.connectedTo.id, c.port.connectedTo.connector);
        const edge = ce.find(
          (e) =>
            e.kind === "joint" &&
            ((e.from === from && e.to === to) || (e.from === to && e.to === from)),
        );
        if (
          !members.has(from) ||
          !edge ||
          g.elements.get(c.element.id)?.uniqueId !== c.element.uniqueId ||
          !g.pinMatches(c.element.id, c.port)
        ) {
          reasons.push(
            issue(
              "stale-flow-constraint",
              c.element.id,
              `${name}: constraint is foreign, stale or not reciprocal`,
            ),
          );
          contradictory = true;
          continue;
        }
        const q = edge.from === from ? c.signedCfm : -c.signedCfm;
        if (edge.signedCfm != null && !close(edge.signedCfm, q)) {
          reasons.push(
            issue(
              "conflicting-flow-constraint",
              c.element.id,
              `${name}: duplicate joint constraints disagree`,
            ),
          );
          contradictory = true;
        } else {
          edge.signedCfm = q;
          edge.source = "staged-constraint";
        }
      }
    }
    // A sourced joint constraint can establish an otherwise unknown one-port boundary sense.
    for (const b of boundaries)
      if (
        injection.get(b.port) == null &&
        (terminalMagnitudes.has(b.port) || inferable.has(b.port))
      ) {
        const ies = (incident.get(b.port) ?? []).map((i) => edges[i]!);
        if (ies.length === 1 && ies[0]!.signedCfm != null) {
          const e = ies[0]!,
            q = e.from === b.port ? e.signedCfm! : -e.signedCfm!;
          const magnitude = terminalMagnitudes.get(b.port);
          if (magnitude != null && !close(Math.abs(q), magnitude)) {
            reasons.push(
              issue(
                "constraint-boundary-flow",
                vertices.get(b.port)!,
                "Signed constraint disagrees with stated terminal flow magnitude",
              ),
            );
            contradictory = true;
          } else {
            injection.set(b.port, q);
            b.injectionCfm = q;
            b.source += "; signed joint design constraint";
          }
        }
      }
    const unknown = [...injection].filter(([, q]) => q == null);
    if (unknown.length === 1 && inferable.has(unknown[0]![0])) {
      const k = unknown[0]![0],
        q = -[...injection.values()].reduce<number>((s, q) => s + (q ?? 0), 0);
      const fan = fanPorts.get(k),
        p = g.elements
          .get(vertices.get(k)!)!
          .connectors.find((p) => portKey(vertices.get(k)!, p.index) === k)!;
      const sign = fan
        ? g.validFans.some(
            (f) => f.value.element.id === vertices.get(k) && f.value.outlet?.index === p.index,
          )
          ? 1
          : -1
        : p.direction.toLowerCase() === "in"
          ? -1
          : 1;
      if (q * sign >= 0) {
        injection.set(k, q);
        const b = boundaries.find((b) => b.port === k)!;
        b.injectionCfm = q;
        b.source += "; uniquely derived by conservation";
      }
    }
    const residual = new Map(injection);
    for (const e of ce)
      if (e.signedCfm != null) {
        if (residual.get(e.from) != null) residual.set(e.from, residual.get(e.from)! - e.signedCfm);
        if (residual.get(e.to) != null) residual.set(e.to, residual.get(e.to)! + e.signedCfm);
      }
    const unresolved = new Map(
      todo.map((k) => [
        k,
        new Set((incident.get(k) ?? []).map((i) => edges[i]!).filter((e) => e.signedCfm == null)),
      ]),
    );
    const queue = todo.filter((k) => residual.get(k) != null && unresolved.get(k)!.size <= 1);
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i]!,
        remaining = unresolved.get(k)!;
      if (remaining.size !== 1 || residual.get(k) == null) continue;
      const e = [...remaining][0]!,
        q = e.from === k ? residual.get(k)! : -residual.get(k)!;
      e.signedCfm = q;
      e.source = "conservation";
      for (const [node, sign] of [
        [e.from, -1],
        [e.to, 1],
      ] as const) {
        unresolved.get(node)!.delete(e);
        if (residual.get(node) != null) residual.set(node, residual.get(node)! + sign * q);
        if (unresolved.get(node)!.size === 1) queue.push(node);
      }
    }
    const unknownEdges = ce.filter((e) => e.signedCfm == null).length;
    const knownResiduals = [...residual]
      .filter(([k, q]) => q != null && unresolved.get(k)!.size === 0)
      .map(([, q]) => q!);
    const maxResidualCfm =
      unknownEdges || [...injection.values()].some((q) => q == null)
        ? null
        : knownResiduals.reduce((max, q) => Math.max(max, Math.abs(q)), 0);
    const scale = boundaries.reduce((max, b) => Math.max(max, Math.abs(b.injectionCfm ?? 0)), 1);
    if (knownResiduals.some((q) => !close(q / scale, 0))) {
      reasons.push(
        issue(
          "component-mass-imbalance",
          null,
          "Stated boundary injections/flow constraints leave nonzero node mass residual",
        ),
      );
      contradictory = true;
    }
    if ([...injection.values()].some((q) => q == null))
      reasons.push(
        issue(
          "unknown-boundary-injection",
          null,
          "Boundary flow magnitude or signed sense is not established",
        ),
      );
    if (unknownEdges)
      reasons.push(
        issue(
          "insufficient-flow-constraints",
          null,
          "Remaining cycle/boundary freedoms need independent sourced signed flow constraints",
        ),
      );
    results.push({
      id: first,
      elementIds,
      componentWitness: witness,
      status: contradictory
        ? "inconsistent"
        : reasons.length || unknownEdges
          ? "underdetermined"
          : "unique",
      nodeCount: todo.length,
      cycleRank: ce.length - todo.length + 1,
      unknownEdges,
      maxResidualCfm,
      edges: ce,
      boundaries,
      reasons,
    });
  }
  for (const [name] of g.flowDesigns)
    if (!consumedDesigns.has(name))
      for (const c of results) {
        c.status = "inconsistent";
        c.reasons.push(
          issue(
            "foreign-component-flow",
            null,
            `${name}: no current component matches this staged design scope`,
          ),
        );
      }
  for (const fan of g.validFans) {
    const inlet = fan.value.inlet,
      outlet = fan.value.outlet;
    if (!inlet || !outlet) continue;
    const a = results.find((c) =>
      c.boundaries.some((b) => b.port === portKey(fan.value.element.id, inlet.index)),
    );
    const b = results.find((c) =>
      c.boundaries.some((b) => b.port === portKey(fan.value.element.id, outlet.index)),
    );
    const qi = a?.boundaries.find(
      (b) => b.port === portKey(fan.value.element.id, inlet.index),
    )?.injectionCfm;
    const qo = b?.boundaries.find(
      (b) => b.port === portKey(fan.value.element.id, outlet.index),
    )?.injectionCfm;
    if (qi != null && qo != null && !close(-qi, qo))
      for (const c of new Set([a, b]))
        if (c) {
          c.status = "inconsistent";
          c.reasons.push(
            issue(
              "fan-mass-continuity",
              fan.value.element.id,
              "Inlet and outlet design injections of the same physical fan disagree",
            ),
          );
        }
  }
  return results;
}
