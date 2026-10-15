import type { DuctCalculation, DuctPortPin } from "@pe/agent-contracts";
import type { DuctSnapshot } from "./types.ts";
type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Element = Node | Segment;
type Fan = Extract<DuctCalculation, { kind: "fan" }>;
type Terminal = Extract<DuctCalculation, { kind: "terminal" }>;
type Passive = Extract<DuctCalculation, { kind: "passive" }>;
export interface CircuitReason {
  code: string;
  elementId: number | null;
  message: string;
}
export interface PhysicalGraph {
  ports: { elementId: number; uniqueId: string | null; connector: Node["connectors"][number] }[];
  joints: { a: string; b: string; reciprocal: boolean }[];
  parts: {
    elementId: number;
    uniqueId: string | null;
    ports: number[];
    continuity: "component" | "passive" | "fan-boundary" | "unknown-equipment";
  }[];
}
const key = (id: number, port: number) => `${id}:${port}`;
const reason = (code: string, elementId: number | null, message: string): CircuitReason => ({
  code,
  elementId,
  message,
});
/** Retains every physical port and joint. Internal equipment continuity requires staged evidence. */
export function physicalGraph(
  snapshot: DuctSnapshot,
  evidence: Readonly<Record<string, DuctCalculation>>,
) {
  const elements = new Map<number, Element>(
    [...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]),
  );
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const segments = new Map(snapshot.segments.map((s) => [s.id, s]));
  const entries = Object.entries(evidence).sort(([a], [b]) => a.localeCompare(b));
  const reasons: CircuitReason[] = [];
  if (elements.size !== snapshot.nodes.length + snapshot.segments.length)
    reasons.push(reason("duplicate-element-id", null, "Collected element ids are not unique"));
  const uids = [...elements.values()].flatMap((e) => (e.uniqueId ? [e.uniqueId] : []));
  if (new Set(uids).size !== uids.length)
    reasons.push(
      reason("duplicate-element-identity", null, "Collected native UniqueIds are not unique"),
    );
  const passives = new Map<number, Passive>();
  const terminals = new Map<number, Terminal>();
  const fans: { id: string; value: Fan }[] = [];
  const claims = new Map<string, string[]>();
  const scenarios = entries.filter(([, e]) => e.kind === "balanced-design");
  const identity = (e: Exclude<DuctCalculation, { kind: "balanced-design" | "component-flow" }>) =>
    elements.get(e.element.id)?.uniqueId === e.element.uniqueId;
  const pinMatches = (id: number, pin: DuctPortPin) => {
    const cs = elements.get(id)?.connectors.filter((c) => c.index === pin.index) ?? [];
    if (cs.length !== 1) return false;
    const c = cs[0]!;
    const to = c.connectedTo;
    const other = to ? elements.get(to.elementId) : undefined;
    const back = other?.connectors.filter((c) => c.index === to?.connector) ?? [];
    return (
      !!to &&
      other?.uniqueId === pin.connectedTo.uniqueId &&
      to.elementId === pin.connectedTo.id &&
      to.connector === pin.connectedTo.connector &&
      back.length === 1 &&
      back[0]!.connectedTo?.elementId === id &&
      back[0]!.connectedTo?.connector === pin.index &&
      c.point.length === 3 &&
      c.point.every((n, i) => n === pin.point[i]) &&
      c.shape === pin.shape &&
      (c.diameterIn ?? null) === pin.diameterIn &&
      (c.widthIn ?? null) === pin.widthIn &&
      (c.heightIn ?? null) === pin.heightIn &&
      c.direction === pin.direction
    );
  };
  const pinsOf = (e: Exclude<DuctCalculation, { kind: "balanced-design" | "component-flow" }>) =>
    e.kind === "passive"
      ? e.ports
      : e.kind === "terminal"
        ? [e.port]
        : [e.inlet, e.outlet].filter((p) => p !== null);
  for (const [id, e] of entries) {
    if (e.kind === "balanced-design" || e.kind === "component-flow") continue;
    const element = nodes.get(e.element.id);
    if (!identity(e) || !pinsOf(e).every((p) => pinMatches(e.element.id, p))) {
      reasons.push(
        reason(
          "stale-port-evidence",
          e.element.id,
          `${id}: element identity or exact reciprocal connector witness does not match`,
        ),
      );
      continue;
    }
    if (
      (e.kind === "terminal") !== (element?.kind === "terminal") ||
      (e.kind !== "terminal" && element?.kind !== "equipment")
    ) {
      reasons.push(
        reason(
          "invalid-equipment-role",
          e.element.id,
          `${id}: evidence role does not match the collected element kind`,
        ),
      );
      continue;
    }
    if (
      e.kind === "fan" &&
      (e.inlet?.direction.toLowerCase() === "out" || e.outlet?.direction.toLowerCase() === "in")
    ) {
      reasons.push(
        reason(
          "contradictory-fan-direction",
          e.element.id,
          `${id}: staged inlet/outlet contradicts an explicit native connector direction`,
        ),
      );
      continue;
    }
    const pins = pinsOf(e);
    if (
      new Set(pins.map((p) => p.index)).size !== pins.length ||
      ((e.kind === "passive" || e.kind === "terminal") &&
        element!.connectors.length !== pins.length)
    ) {
      reasons.push(
        reason(
          "contradictory-port-pair",
          e.element.id,
          `${id}: ports repeat or do not cover the passive/terminal physical connectors`,
        ),
      );
      continue;
    }
    for (const p of pins) {
      const k = key(e.element.id, p.index);
      claims.set(k, [...(claims.get(k) ?? []), id]);
    }
    if (e.kind === "passive") passives.set(e.element.id, e);
    else if (e.kind === "terminal") terminals.set(e.element.id, e);
    else fans.push({ id, value: e });
  }
  const conflicts = new Set<number>();
  for (const [port, ids] of claims)
    if (ids.length > 1) {
      const id = Number(port.split(":")[0]);
      conflicts.add(id);
      reasons.push(
        reason("contradictory-port-role", id, `${port} is claimed by ${ids.join(", ")}`),
      );
    }
  for (const id of conflicts) {
    passives.delete(id);
    terminals.delete(id);
  }
  const validFans = fans.filter((f) => !conflicts.has(f.value.element.id));
  const fanPorts = new Set(
    validFans.flatMap((f) =>
      [f.value.inlet, f.value.outlet].flatMap((p) => (p ? [key(f.value.element.id, p.index)] : [])),
    ),
  );
  const graph: PhysicalGraph = { ports: [], joints: [], parts: [] };
  const seenJoints = new Set<string>();
  const adjacent = new Map<number, number[]>();
  const badJoints = new Set<number>();
  for (const e of elements.values()) {
    const equipment = nodes.get(e.id)?.kind === "equipment";
    if (!equipment || passives.has(e.id)) adjacent.set(e.id, []);
    graph.parts.push({
      elementId: e.id,
      uniqueId: e.uniqueId ?? null,
      ports: e.connectors.map((c) => c.index),
      continuity: !equipment
        ? "component"
        : passives.has(e.id)
          ? "passive"
          : e.connectors.some((c) => fanPorts.has(key(e.id, c.index)))
            ? "fan-boundary"
            : "unknown-equipment",
    });
    for (const c of e.connectors) {
      graph.ports.push({ elementId: e.id, uniqueId: e.uniqueId ?? null, connector: c });
      if (!c.connectedTo) continue;
      const to = c.connectedTo;
      const a = key(e.id, c.index),
        b = key(to.elementId, to.connector);
      const joint = [a, b].sort().join("|");
      if (seenJoints.has(joint)) continue;
      seenJoints.add(joint);
      const other =
        elements.get(to.elementId)?.connectors.filter((p) => p.index === to.connector) ?? [];
      const reciprocal =
        other.length === 1 &&
        other[0]!.connectedTo?.elementId === e.id &&
        other[0]!.connectedTo?.connector === c.index;
      graph.joints.push({ a, b, reciprocal });
      if (!reciprocal) {
        badJoints.add(e.id);
        badJoints.add(to.elementId);
      }
    }
  }
  // Preserve multiplicity: two distinct physical joints between owners close a cycle.
  for (const j of graph.joints)
    if (j.reciprocal) {
      const a = Number(j.a.split(":")[0]),
        b = Number(j.b.split(":")[0]);
      if (adjacent.has(a) && adjacent.has(b)) {
        adjacent.get(a)!.push(b);
        adjacent.get(b)!.push(a);
      }
    }
  for (const list of adjacent.values()) list.sort((a, b) => a - b);
  return {
    pinMatches,
    flowDesigns: entries.filter(([, e]) => e.kind === "component-flow"),
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
  };
}
