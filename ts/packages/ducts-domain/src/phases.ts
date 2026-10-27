/**
 * Phase anomalies (kaitpw 2026-10-19): an MEP firm models what its views show, so an element in a
 * phase its views do not show is often forgotten junk (Project A duct 11621952 on Future inside duct
 * 12089962 while the views show Existing; FC-23's duplicate 8732550 on Future). Work's
 * `workingPhase` (edit, else proposed) names the phase. `phased` drops every element that does
 * not exist in it by the snapshot's phase order (created after it, or demolished at or before it)
 * before any network or proximity reads the snapshot, and each dropped element that connects to,
 * meets by proximity, or sits inside a kept one is an `out-of-phase` warning a person rules on.
 * With no working phase, or one the snapshot's `phases.order` does not list, nothing changes.
 */
import { subjectName } from "./words.ts";
import { workingPhaseOf, type DuctsRouteDocument } from "@pe/agent-contracts";

import { depth, inferJoints, sidesOf, type ProximityFinding } from "./proximity.ts";
import type { DuctSnapshot } from "./types.ts";

type Element = DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number];

const IN = 1 / 12;
/** Inferences that would have joined a dropped element to a kept one. */
const MEETS = new Set([
  "joined-by-proximity",
  "tap-by-proximity",
  "inline-by-inference",
  "near-miss-across-classifications",
]);

/** Whether `e` exists in phase `at` of `order`; a phase the order does not list reads as existing. */
export function existsIn(e: Element, order: readonly string[], at: number) {
  const created = e.phaseCreated ? order.indexOf(e.phaseCreated) : -1;
  const demolished = e.phaseDemolished ? order.indexOf(e.phaseDemolished) : -1;
  return created <= at && (demolished < 0 || demolished > at);
}

const nameOf = (e: Element) => subjectName(e.kind, "family" in e ? e.family : null);
const list = (ids: Set<number>) => [...ids].sort((a, b) => a - b).join(", ");

/** The snapshot as it stands in Work's working phase, and an `out-of-phase` finding per dropped element touching it. */
export function phased(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null,
): { snapshot: DuctSnapshot; findings: ProximityFinding[] } {
  const phase = workingPhaseOf(work);
  const order = snapshot.phases?.order ?? [];
  const at = phase == null ? -1 : order.indexOf(phase);
  const all: Element[] = [...snapshot.nodes, ...snapshot.segments];
  const out = new Set(all.filter((e) => at >= 0 && !existsIn(e, order, at)).map((e) => e.id));
  if (!out.size) return { snapshot, findings: [] };

  const touch = new Map<
    number,
    { connects: Set<number>; meets: Set<number>; inside: Set<number> }
  >();
  const of = (id: number) =>
    touch.get(id) ??
    touch.set(id, { connects: new Set(), meets: new Set(), inside: new Set() }).get(id)!;
  for (const e of all)
    for (const c of e.connectors) {
      const to = c.connectedTo?.elementId;
      if (to == null || out.has(e.id) === out.has(to)) continue;
      if (out.has(e.id)) of(e.id).connects.add(to);
      else of(to).connects.add(e.id);
    }
  for (const f of inferJoints(snapshot, 1, work).findings) {
    const [x, y] = f.elementIds;
    if (!MEETS.has(f.kind) || x == null || y == null || out.has(x) === out.has(y)) continue;
    if (out.has(x)) of(x).meets.add(y);
    else of(y).meets.add(x);
  }
  const sides = sidesOf(snapshot.segments.filter((s) => !out.has(s.id)));
  for (const e of all.filter((e) => out.has(e.id))) {
    const points = [
      ...("polyline" in e ? e.polyline : [e.point]),
      ...e.connectors.map((c) => c.point),
    ];
    for (const side of sides)
      if (
        points.some((p) => {
          const d = depth(side, p);
          // A point at a piece's end is where it would connect, not inside it.
          return d != null && d.d <= 0 && d.t > IN && d.t < side.len - IN;
        })
      )
        of(e.id).inside.add(side.owner);
  }

  const byId = new Map(all.map((e) => [e.id, e]));
  const findings: ProximityFinding[] = [...touch]
    .sort(([a], [b]) => a - b)
    .map(([id, t]) => {
      const e = byId.get(id)!;
      const when =
        e.phaseDemolished && order.indexOf(e.phaseDemolished) <= at
          ? `demolished in ${e.phaseDemolished}`
          : `created in ${e.phaseCreated}`;
      const how = [
        t.connects.size ? `connects to ${list(t.connects)}` : null,
        t.meets.size ? `meets ${list(t.meets)} by proximity` : null,
        t.inside.size ? `sits inside ${list(t.inside)}` : null,
      ].filter((s) => s != null);
      return {
        id: `out-of-phase:${id}`,
        kind: "out-of-phase" as const,
        elementIds: [
          id,
          ...[...new Set([...t.connects, ...t.meets, ...t.inside])].sort((a, b) => a - b),
        ],
        note: `${nameOf(e)} is ${when}, so it does not exist in working phase ${phase}; left out of the network, though it ${how.length > 1 ? `${how.slice(0, -1).join(", ")} and ${how.at(-1)}` : how[0]}`,
        grade: null,
      };
    });

  const kept = <T extends Element>(e: T): T => ({
    ...e,
    connectors: e.connectors.map((c) =>
      c.connectedTo && out.has(c.connectedTo.elementId) ? { ...c, connectedTo: null } : c,
    ),
  });
  const issues = snapshot.issues.filter((i) => i.elementId == null || !out.has(i.elementId));
  const issueIds = new Set(issues.map((i) => i.id));
  const dropped = new Map<string, number>();
  for (const e of all)
    if (out.has(e.id) && e.groupId != null)
      dropped.set(e.groupId, (dropped.get(e.groupId) ?? 0) + 1);
  return {
    findings,
    snapshot: {
      ...snapshot,
      nodes: snapshot.nodes.filter((n) => !out.has(n.id)).map(kept),
      segments: snapshot.segments.filter((s) => !out.has(s.id)).map(kept),
      flows: snapshot.flows.filter((f) => !out.has(f.segmentId)),
      issues,
      groups: snapshot.groups
        .map((g) => ({
          ...g,
          rootIds: g.rootIds.filter((id) => !out.has(id)),
          elementCount: g.elementCount - (dropped.get(g.id) ?? 0),
          issueIds: g.issueIds.filter((id) => issueIds.has(id)),
        }))
        .filter((g) => g.elementCount > 0),
    },
  };
}
