/**
 * Tolerance over repair (pressure-drop ledger, 2026-10-16): a gap or a near-miss tap that a
 * person would otherwise heal in Revit becomes a recorded graph assumption. `inferJoints` finds
 * them; `tolerate` rewrites the snapshot as if they were real reciprocal joints, so
 * `physicalGraph`, `groupTree` and the loss walk need no notion of inference. Points are model
 * feet (DuctContracts.cs); `tolIn` is inches. A staged `ignore` verdict on a finding id withholds
 * that one inference. Nothing here is stored and nothing reaches Revit.
 */
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Element = Node | Segment;
type Group = DuctSnapshot["groups"][number];

export interface InferredJoint {
  a: string;
  b: string;
  kind: "joined-by-proximity";
  gapIn: number;
}
export interface InferredTap {
  a: string;
  segment: number;
  kind: "tap-by-proximity";
  gapIn: number;
  /** Along the segment's polyline from its first point, ft. */
  at: number;
}
export interface ProximityFinding {
  id: string;
  kind: InferredJoint["kind"] | InferredTap["kind"] | "loop-by-inference";
  elementIds: number[];
  note: string;
}
export interface Inference {
  joints: InferredJoint[];
  taps: InferredTap[];
  findings: ProximityFinding[];
}

const key = (id: number, index: number) => `${id}:${index}`;
const parse = (k: string) => {
  const [id, index] = k.split(":").map(Number);
  return { elementId: id!, connector: index! };
};
const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));

/** The nearest point of a polyline to `p`: distance, the point, and the run to it, all ft. */
function nearestOnPolyline(poly: number[][], p: number[]) {
  let best = { d: Infinity, point: p, at: 0 };
  let run = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!,
      ab = poly[i]!.map((v, k) => v - a[k]!);
    const len2 = ab.reduce((s, v) => s + v * v, 0);
    const dot = ab.reduce((s, v, k) => s + v * (p[k]! - a[k]!), 0);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot / len2));
    const point = a.map((v, k) => v + ab[k]! * t);
    const d = dist(point, p);
    if (d < best.d) best = { d, point, at: run + t * Math.sqrt(len2) };
    run += Math.sqrt(len2);
  }
  return best;
}

const ignored = (work: DuctsRouteDocument | null, id: string) => {
  const value = work?.assumptions[id]?.staged?.value;
  return value?.kind === "verdict" && value.verdict === "ignore";
};

/** Union-find over the reciprocal joints; equipment is an attachment, never a path, as in `groupTree`. */
function components(elements: Element[], equipment: ReadonlySet<number>) {
  const up = new Map<number, number>();
  const find = (x: number): number => {
    const p = up.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    up.set(x, root);
    return root;
  };
  const union = (a: number, b: number) => {
    if (equipment.has(a) || equipment.has(b)) return;
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) up.set(ra, rb);
  };
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const e of elements)
    for (const c of e.connectors) {
      const to = c.connectedTo;
      const back = to && byId.get(to.elementId)?.connectors.find((p) => p.index === to.connector);
      if (to && back?.connectedTo?.elementId === e.id && back.connectedTo.connector === c.index)
        union(e.id, to.elementId);
    }
  return { find, union };
}

/**
 * Joints and taps the model implies within `tolIn` inches. (a) Two open connectors within
 * tolerance join, nearest pair first, each port once; shape compatibility is not required.
 * (b) An open connector left over whose nearest segment interior is within tolerance, away from
 * that segment's own end connectors, taps it. Each inference is a finding; one that joins two
 * elements already in one component is also a `loop-by-inference` finding.
 */
export function inferJoints(
  snapshot: DuctSnapshot,
  tolIn = 1,
  work: DuctsRouteDocument | null = null,
): Inference {
  const tol = tolIn / 12;
  const elements: Element[] = [...snapshot.nodes, ...snapshot.segments];
  const equipment = new Set(snapshot.nodes.filter((n) => n.kind === "equipment").map((n) => n.id));
  const open = elements.flatMap((e) =>
    e.connectors
      .filter((c) => !c.connectedTo && c.point.length === 3)
      .map((c) => ({ k: key(e.id, c.index), id: e.id, index: c.index, point: c.point })),
  );
  const { find, union } = components(elements, equipment);
  const joints: InferredJoint[] = [],
    taps: InferredTap[] = [],
    findings: ProximityFinding[] = [];
  const used = new Set<string>();
  const closes = (id: string, a: number, b: number) => {
    if (!equipment.has(a) && !equipment.has(b) && find(a) === find(b))
      findings.push({
        id: `loop-by-inference:${id.slice("proximity:".length)}`,
        kind: "loop-by-inference",
        elementIds: [a, b],
        note: `inferring ${id} closes a loop: ${a} and ${b} were already connected another way`,
      });
    union(a, b);
  };
  const pairs: { a: (typeof open)[number]; b: (typeof open)[number]; d: number }[] = [];
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++) {
      const [a, b] = [open[i]!, open[j]!].sort((x, y) => x.id - y.id || x.index - y.index);
      const d = dist(a!.point, b!.point);
      if (a!.id !== b!.id && d <= tol) pairs.push({ a: a!, b: b!, d });
    }
  pairs.sort((x, y) => x.d - y.d || x.a.k.localeCompare(y.a.k) || x.b.k.localeCompare(y.b.k));
  for (const { a, b, d } of pairs) {
    if (used.has(a.k) || used.has(b.k)) continue;
    const id = `proximity:${a.k}|${b.k}`;
    if (ignored(work, id)) continue;
    used.add(a.k).add(b.k);
    const gapIn = d * 12;
    joints.push({ a: a.k, b: b.k, kind: "joined-by-proximity", gapIn });
    findings.push({
      id,
      kind: "joined-by-proximity",
      elementIds: [a.id, b.id],
      note: `open ends ${a.k} and ${b.k} are ${gapIn.toFixed(2)} in apart; joined`,
    });
    closes(id, a.id, b.id);
  }
  for (const p of open) {
    if (used.has(p.k)) continue;
    let best: { segment: Segment; d: number; at: number } | null = null;
    for (const s of snapshot.segments) {
      if (s.id === p.id || s.polyline.length < 2) continue;
      const near = nearestOnPolyline(s.polyline, p.point);
      if (near.d > tol || (best && near.d >= best.d)) continue;
      if (s.connectors.some((c) => c.kind !== "curve" && dist(c.point, near.point) <= tol))
        continue;
      best = { segment: s, d: near.d, at: near.at };
    }
    if (!best) continue;
    const id = `proximity:${p.k}|${best.segment.id}`;
    if (ignored(work, id)) continue;
    used.add(p.k);
    const gapIn = best.d * 12;
    taps.push({ a: p.k, segment: best.segment.id, kind: "tap-by-proximity", gapIn, at: best.at });
    findings.push({
      id,
      kind: "tap-by-proximity",
      elementIds: [p.id, best.segment.id],
      note: `open end ${p.k} is ${gapIn.toFixed(2)} in from duct ${best.segment.id} at ${best.at.toFixed(2)} ft along it; tapped`,
    });
    closes(id, p.id, best.segment.id);
  }
  return { joints, taps, findings };
}

/**
 * The snapshot with every inference applied as a real joint: reciprocal `connectedTo` links, one
 * virtual `Tap` fitting (negative id) hung off a new `curve` connector per inferred tap, the
 * consumed `open-end` issues dropped, and the groups it bridged merged into one (the one with
 * equipment, else the lower id). The input is never mutated.
 */
export function tolerate(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null = null,
  tolIn = 1,
): Inference & { snapshot: DuctSnapshot } {
  const inference = inferJoints(snapshot, tolIn, work);
  if (!inference.joints.length && !inference.taps.length) return { snapshot, ...inference };
  const nodes = snapshot.nodes.map((n) => ({
    ...n,
    connectors: n.connectors.map((c) => ({ ...c })),
  }));
  const segments = snapshot.segments.map((s) => ({
    ...s,
    connectors: s.connectors.map((c) => ({ ...c })),
  }));
  const byId = new Map<number, Element>([...nodes, ...segments].map((e) => [e.id, e]));
  const port = (k: string) => {
    const { elementId, connector } = parse(k);
    return byId.get(elementId)!.connectors.find((c) => c.index === connector)!;
  };
  const consumed = new Set<string>();
  const groups = new Map(snapshot.groups.map((g) => [g.id, { ...g, rootIds: [...g.rootIds] }]));
  const alias = new Map<string, string>();
  const canon = (id: string): string => {
    const to = alias.get(id);
    return to == null ? id : canon(to);
  };
  const bridge = (a: number, b: number) => {
    const ga = byId.get(a)!.groupId ?? null,
      gb = byId.get(b)!.groupId ?? null;
    if (ga == null && gb == null) return;
    if (ga == null || gb == null) {
      const group = groups.get(canon(ga ?? gb!))!;
      const root = ga == null ? a : b;
      if (!group.rootIds.includes(root)) group.rootIds.push(root);
      return;
    }
    const [x, y] = [canon(ga), canon(gb)];
    if (x === y) return;
    const gx = groups.get(x)!,
      gy = groups.get(y)!;
    const keep =
      gx.rootIds.length >= gy.rootIds.length && (gx.rootIds.length > gy.rootIds.length || x < y)
        ? x
        : y;
    const drop = keep === x ? y : x;
    const [k, d] = [groups.get(keep)!, groups.get(drop)!];
    k.rootIds.push(...d.rootIds.filter((r) => !k.rootIds.includes(r)));
    k.classifications = [...new Set([...k.classifications, ...d.classifications])];
    k.systemNames = [...new Set([...k.systemNames, ...d.systemNames])];
    k.terminalCount += d.terminalCount;
    k.elementCount += d.elementCount;
    k.loops += d.loops;
    k.issueIds = [...k.issueIds, ...d.issueIds];
    groups.delete(drop);
    alias.set(drop, keep);
  };
  for (const j of inference.joints) {
    port(j.a).connectedTo = parse(j.b);
    port(j.b).connectedTo = parse(j.a);
    consumed.add(j.a).add(j.b);
    bridge(parse(j.a).elementId, parse(j.b).elementId);
  }
  inference.taps.forEach((t, i) => {
    const id = -(i + 1);
    const main = byId.get(t.segment) as Segment;
    const branch = parse(t.a);
    const p = port(t.a);
    const point = nearestOnPolyline(main.polyline, p.point).point;
    const index = Math.max(-1, ...main.connectors.map((c) => c.index)) + 1;
    main.connectors.push({
      ...p,
      index,
      kind: "curve",
      point,
      connectedTo: { elementId: id, connector: 0 },
    });
    p.connectedTo = { elementId: id, connector: 1 };
    const tap: Node = {
      id,
      kind: "fitting",
      category: "Fitting",
      family: "Inferred tap",
      type: null,
      partType: "Tap",
      levelId: main.levelId ?? null,
      point,
      groupId: main.groupId ?? null,
      systemName: main.systemName ?? null,
      classification: main.classification ?? null,
      connectors: [
        {
          ...p,
          index: 0,
          kind: "end",
          point,
          connectedTo: { elementId: main.id, connector: index },
        },
        {
          ...p,
          index: 1,
          kind: "end",
          connectedTo: { elementId: branch.elementId, connector: branch.connector },
        },
      ],
      facts: [],
      uniqueId: null,
    };
    nodes.push(tap);
    byId.set(id, tap);
    consumed.add(t.a);
    if (main.groupId != null) groups.get(canon(main.groupId))!.elementCount += 1;
    bridge(branch.elementId, main.id);
  });
  const regroup = <T extends { groupId?: string | null }>(e: T): T =>
    e.groupId == null ? e : { ...e, groupId: canon(e.groupId) };
  const openEnd = (issue: DuctSnapshot["issues"][number]) =>
    issue.kind === "open-end" &&
    issue.elementId != null &&
    consumed.has(key(issue.elementId, Number(issue.id.split(":").at(-1))));
  const issues = snapshot.issues.filter((i) => !openEnd(i)).map(regroup);
  const kept = new Set(issues.map((i) => i.id));
  const merged: Group[] = snapshot.groups.flatMap((g) => {
    const group = groups.get(g.id);
    return group ? [{ ...group, issueIds: group.issueIds.filter((id) => kept.has(id)) }] : [];
  });
  return {
    ...inference,
    snapshot: {
      ...snapshot,
      groups: merged,
      nodes: nodes.map(regroup),
      segments: segments.map(regroup),
      issues,
    },
  };
}
