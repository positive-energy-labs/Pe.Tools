import type { HydraulicClosure } from "./hydraulic-closure.ts";
import type { DuctComponentWitness } from "@pe/agent-contracts";
import { terminalCfm } from "./topology.ts";
import type { physicalGraph, CircuitReason } from "./physical-graph.ts";

type Graph = ReturnType<typeof physicalGraph>;
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  kind: "joint" | "duct-subrun" | "station-arm" | "curve-continuity" | "fitting-arm" | "passive";
  elementId: number;
  lengthFt: number | null;
  signedCfm: number | null;
  source: "conservation" | "staged-constraint" | null;
}
export interface ComponentFlow {
  hydraulics: HydraulicClosure | null;
  id: string;
  elementIds: number[];
  componentWitness: DuctComponentWitness;
  status: "unique" | "underdetermined" | "inconsistent";
  nodeCount: number;
  cycleRank: number;
  unknownEdges: number;
  maxResidualCfm: number | null;
  edges: FlowEdge[];
  boundaries: {
    port: string;
    injectionCfm: number | null;
    source: string;
    externalExchange?: {
      ownerOutwardCfm: number | null;
      inflowCfm: number | null;
      source: string;
      derivation: "fan-design" | "fan-continuity" | null;
      fromComponentId: string | null;
    };
  }[];
  reasons: CircuitReason[];
}
const portKey = (id: number, index: number) => `${id}:${index}`;
// For n rounded operations, gamma(n)=n*u/(1-n*u), u=EPSILON/2. A leg projection
// uses <64 scalar operations (subtract/dot/norm/clamp/reconstruct); include cumulative legs.
// Scaling by absolute world coordinates bounds cancellation. This is numerical error, not a physical merge tolerance.
export const ductArithmeticError = (points: number[][], legs: number) => {
  const n = 64 * (legs + 1),
    u = Number.EPSILON / 2;
  return (
    ((n * u) / (1 - n * u)) *
    points.reduce((scale, p) => p.reduce((scale, v) => Math.max(scale, Math.abs(v)), scale), 0)
  );
};
const validPoint = (p: number[]) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
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
      const refuse = (code: string, message: string) =>
        geometryReasons.set(e.id, [issue(code, e.id, message)]);
      if (!g.coordinateEncoding) {
        refuse(
          "flow-coordinate-encoding",
          "Native-double coordinate encoding is not asserted; duct continuity is unknown",
        );
        continue;
      }
      if (
        !Array.isArray(e.polyline) ||
        !e.polyline.every(validPoint) ||
        !ps.every((p) => validPoint(p.point))
      ) {
        refuse(
          "flow-subrun-geometry",
          "Polyline and connector coordinates must be finite model-foot XYZ triples",
        );
        continue;
      }
      if (e.curveKind === "arc" || e.curveKind === "flex-polyline") {
        if (
          e.uniqueId &&
          ps.length === 2 &&
          ps[0]!.index !== ps[1]!.index &&
          ps.every((p) => p.kind === "end") &&
          !g.badJoints.has(e.id) &&
          Number.isFinite(e.lengthFt) &&
          e.lengthFt > 0 &&
          e.polyline.length >= 2
        ) {
          // Native two-end-port MEPCurve mass continuity only; no chord, subrun, or pressure-loss law.
          add(portKey(e.id, ps[0]!.index), portKey(e.id, ps[1]!.index), "curve-continuity", e.id);
        } else
          refuse(
            "flow-subrun-geometry",
            "Nonlinear MEPCurve does not establish one stable two-end-port physical channel",
          );
        continue;
      }
      if (e.curveKind !== "line" || e.polyline.length !== 2) {
        refuse(
          "flow-subrun-geometry",
          "Native line curve kind is not established; nonlinear multiport samples do not certify ordered arclength stations",
        );
        continue;
      }
      const polyline = canonicalPolyline(e.polyline);
      const legs = polyline.slice(1).map((p, i) => distance(p, polyline[i]!));
      const total = legs.reduce((a, b) => a + b, 0);
      const errorFt = ductArithmeticError([...polyline, ...ps.map((p) => p.point)], legs.length);
      if (
        !(total > errorFt) ||
        !Number.isFinite(total) ||
        !Number.isFinite(e.lengthFt) ||
        !(e.lengthFt > 0) ||
        ps.length < 2 ||
        legs.some((l) => !(l > errorFt)) ||
        Math.abs(total - e.lengthFt) > errorFt
      ) {
        refuse(
          "flow-subrun-geometry",
          "Positive native polyline/length and supported curve geometry are not established",
        );
        continue;
      }
      const located = ps
        .map((p) => {
          let best = { error: Infinity, at: 0 },
            run = 0;
          const projections: { error: number; at: number }[] = [];
          for (let i = 0; i < legs.length; i++) {
            const a = polyline[i]!,
              b = polyline[i + 1]!;
            const delta = b.map((v, k) => v - a[k]!);
            const square = delta.reduce((sum, v) => sum + v * v, 0);
            const t = Math.max(
              0,
              Math.min(1, delta.reduce((sum, v, k) => sum + v * (p.point[k]! - a[k]!), 0) / square),
            );
            const error = distance(
              p.point,
              a.map((v, k) => v + t * delta[k]!),
            );
            const projected = { error, at: run + t * legs[i]! };
            projections.push(projected);
            if (error < best.error) best = projected;
            run += legs[i]!;
          }
          const tied = projections.filter((q) => q.error <= best.error + errorFt);
          const ambiguous = tied.some((q) => Math.abs(q.at - best.at) > 2 * errorFt);
          return { p, ...best, ambiguous };
        })
        .sort((a, b) => a.at - b.at || a.p.index - b.p.index);
      if (
        located.some((p) => p.ambiguous || !Number.isFinite(p.at) || p.error > errorFt) ||
        located[0]!.at > errorFt ||
        total - located.at(-1)!.at > errorFt
      ) {
        refuse(
          "flow-subrun-geometry",
          "Connectors are not on the complete native polyline within derived binary64 arithmetic error",
        );
        continue;
      }
      const stations: { ports: typeof located; at: number; key: string }[] = [];
      let ambiguous = false;
      for (const p of located) {
        const previous = stations.at(-1),
          first = previous?.ports[0];
        if (first && p.at - previous!.ports.at(-1)!.at <= 2 * errorFt) {
          if (p.at - first.at > 2 * errorFt || distance(p.p.point, first.p.point) > 2 * errorFt) {
            ambiguous = true;
            break;
          }
          previous!.ports.push(p);
        } else stations.push({ ports: [p], at: p.at, key: "" });
      }
      if (ambiguous) {
        refuse(
          "ambiguous-flow-stations",
          "Overlapping numerical station envelopes do not establish one common physical station",
        );
        continue;
      }
      for (const station of stations) {
        station.at = (station.ports[0]!.at + station.ports.at(-1)!.at) / 2;
        if (station.at <= errorFt) station.at = 0;
        if (total - station.at <= errorFt) station.at = total;
      }
      // A shared station needs one line point inside every port's numerical error ball,
      // not merely a transitive chain of close pairs.
      if (
        stations.some((station) => {
          const point = polyline[0]!.map(
            (v, i) => v + (station.at / total) * (polyline[1]![i]! - v),
          );
          return (
            station.ports.length > 1 &&
            station.ports.some((p) => distance(p.p.point, point) > errorFt)
          );
        })
      ) {
        refuse(
          "ambiguous-flow-stations",
          "No single native line point is within every grouped port's numerical error bound",
        );
        continue;
      }
      for (const station of stations) {
        const ids = station.ports.map((p) => p.p.index).sort((a, b) => a - b);
        station.key =
          ids.length === 1 ? portKey(e.id, ids[0]!) : `${e.id}:station:${ids.join(",")}`;
        if (ids.length > 1) {
          vertices.set(station.key, e.id);
          // Flow-only mass continuity at a numerically common station; never a friction/equal-pressure edge.
          for (const index of ids) add(portKey(e.id, index), station.key, "station-arm", e.id);
        }
      }
      for (let i = 1; i < stations.length; i++)
        add(
          stations[i - 1]!.key,
          stations[i]!.key,
          "duct-subrun",
          e.id,
          ((stations[i]!.at - stations[i - 1]!.at) / total) * e.lengthFt,
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
  const exterior: {
    component: ComponentFlow;
    boundary: ComponentFlow["boundaries"][number];
    other: string | null;
    sign: number;
  }[] = [];
  const fanPorts = new Map<
    string,
    { injection: number | null; source: string; sign: number; other: string | null }
  >();
  for (const f of g.validFans)
    for (const [side, sign] of [
      [f.value.inlet, -1],
      [f.value.outlet, 1],
    ] as const)
      if (side)
        fanPorts.set(portKey(f.value.element.id, side.index), {
          injection: f.value.designFlowCfm == null ? null : sign * f.value.designFlowCfm,
          source: f.value.source,
          sign,
          other: (sign === -1 ? f.value.outlet : f.value.inlet)
            ? portKey(f.value.element.id, (sign === -1 ? f.value.outlet : f.value.inlet)!.index)
            : null,
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
      ...(g.coordinateEncoding
        ? []
        : [
            issue(
              "flow-coordinate-encoding",
              null,
              "Native-double coordinate encoding is not asserted",
            ),
          ]),
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
        coordinateEncoding: g.coordinateEncoding,
        curveKind: "curveKind" in e ? (e.curveKind ?? null) : null,
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
    const localExterior: Omit<(typeof exterior)[number], "component">[] = [];
    const inferable = new Set<string>();
    const terminalMagnitudes = new Map<string, number | null>();
    for (const k of todo) {
      if (k.endsWith(":continuity") || k.includes(":station:")) continue;
      const id = vertices.get(k)!,
        e = g.elements.get(id)!,
        p = e.connectors.find((p) => portKey(id, p.index) === k)!;
      if (geometryReasons.has(id)) {
        injection.set(k, null);
        boundaries.push({
          port: k,
          injectionCfm: null,
          source: "Duct internal continuity is not established",
        });
        continue;
      }
      const fan = fanPorts.get(k);
      if (fan) {
        const open = !p.connectedTo;
        const boundary: ComponentFlow["boundaries"][number] = {
          port: k,
          injectionCfm: fan.injection,
          source: fan.source,
        };
        if (open) {
          boundary.externalExchange = {
            ownerOutwardCfm: fan.injection,
            inflowCfm: fan.injection === null ? null : -fan.injection,
            source: fan.source,
            derivation: fan.injection === null ? null : "fan-design",
            fromComponentId: null,
          };
          // Exterior exchange balances the admitted fan face, without adding a physical joint.
          // A zero net residual here never certifies an unknown crossing flow.
          injection.set(k, 0);
          localExterior.push({ boundary, sign: fan.sign, other: fan.other });
        } else {
          injection.set(k, fan.injection);
          if (fan.injection == null) inferable.add(k);
        }
        boundaries.push(boundary);
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
    const unresolvedExterior = localExterior.some(
      (x) => x.boundary.externalExchange!.ownerOutwardCfm === null,
    );
    const maxResidualCfm =
      unresolvedExterior ||
      reasons.length > 0 ||
      unknownEdges ||
      [...injection.values()].some((q) => q == null)
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
    if (unresolvedExterior)
      reasons.push(
        issue(
          "unknown-exterior-flow",
          null,
          "Admitted open fan face has no stated or qualified same-fan flow",
        ),
      );
    results.push({
      hydraulics: null,
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
    for (const x of localExterior) exterior.push({ ...x, component: results[results.length - 1]! });
  }
  for (const x of exterior) {
    const exchange = x.boundary.externalExchange!;
    if (exchange.ownerOutwardCfm !== null || x.component.status === "inconsistent" || !x.other)
      continue;
    const counterpart = results.find(
      (c) =>
        c.status === "unique" &&
        c.boundaries.some((b) => b.port === x.other && b.injectionCfm !== null),
    );
    const q = counterpart?.boundaries.find((b) => b.port === x.other)?.injectionCfm;
    if (q == null || q * x.sign > 0) continue;
    x.boundary.injectionCfm = -q;
    exchange.ownerOutwardCfm = -q;
    exchange.inflowCfm = q;
    exchange.derivation = "fan-continuity";
    exchange.fromComponentId = counterpart!.id;
    x.component.reasons = x.component.reasons.filter((r) => r.code !== "unknown-exterior-flow");
    x.component.status = x.component.reasons.length ? "underdetermined" : "unique";
    x.component.maxResidualCfm = x.component.reasons.length ? null : 0;
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
