/**
 * Tolerance over repair (pressure-drop ledger, 2026-10-16): a gap or a near-miss tap that a
 * person would otherwise heal in Revit becomes a recorded graph assumption. `inferJoints` finds
 * them; `tolerate` rewrites the snapshot as if they were real reciprocal joints, so
 * `physicalGraph`, `groupTree` and the loss walk need no notion of inference. Points are model
 * feet (DuctContracts.cs); `tolIn` is inches. A staged `ignore` verdict on a finding id withholds
 * that one inference. Nothing here is stored and nothing reaches Revit.
 * A duct landing on a duct's side and a duct landing on an end cap are one rule (kaitpw
 * 2026-10-19): each duct is a solid, its polyline swept by its cross-section, closed at an end an
 * end cap closes; an open connector whose point is near that surface, whose axis points into it,
 * and whose point lies within the face, lands there. Centering is not required and any number of
 * connectors may land on one face.
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
  /** Along the segment's polyline from its first point, ft; a capped end's is 0 or its length. */
  at: number;
  /** Where the tap sits on the segment's centerline, ft. */
  point: number[];
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
const sub = (p: number[], q: number[]) => p.map((v, k) => v - q[k]!);
const add = (p: number[], q: number[], by = 1) => p.map((v, k) => v + q[k]! * by);
const dot = (p: number[], q: number[]) => p.reduce((s, v, k) => s + v * q[k]!, 0);
const unit = (p: number[]) => {
  const n = Math.hypot(...p);
  return n < 1e-9 ? null : p.map((v) => v / n);
};

/**
 * ponytail: tuned by one case (Chadds 14122436 short of cap 14107111, 1.6 in of air to the cap
 * face). Move to a ruled per-document value if more models disagree.
 */
export const FACE_TOL_IN = 2;
/** ponytail: one measured cap (Chadds 14107111's face sits 1.0 in outboard of the duct end); caps carry no size in the snapshot. */
export const CAP_THICKNESS_IN = 1;
/** The least cosine between a landing connector's outward axis and the face's inward normal. */
const AXIS_COS = 0.7;

/**
 * A segment's cross-section on an axis `u`, ft. A rectangle whose roll is known has half-sides
 * `w` along `x` and `h` along `y`; otherwise a band `inner..outer` from the centerline.
 * ponytail: the snapshot carries no rect roll; a non-vertical rect is taken in Revit's default
 * roll (width horizontal), and a vertical one (or an oval) as the round-equivalent band from its
 * half-short-side to its half-diagonal, so any roll lands.
 */
type Section =
  | { w: number; h: number; x: number[]; y: number[] }
  | { inner: number; outer: number };
function sectionOf(s: Segment, u: number[]): Section | null {
  const [w, h] = [(s.widthIn ?? 0) / 24, (s.heightIn ?? 0) / 24];
  if (s.shape === "round" || (!w && !h)) {
    const r = (s.diameterIn ?? 0) / 24;
    return r > 0 ? { inner: r, outer: r } : null;
  }
  if (!w || !h) return null;
  const x = s.shape === "rectangular" && Math.abs(u[2]!) < 0.99 ? unit([-u[1]!, u[0]!, 0]) : null;
  if (!x) return { inner: Math.min(w, h), outer: Math.hypot(w, h) };
  const y = [
    u[1]! * x[2]! - u[2]! * x[1]!,
    u[2]! * x[0]! - u[0]! * x[2]!,
    u[0]! * x[1]! - u[1]! * x[0]!,
  ];
  return { w, h, x, y };
}

/** The side face nearest `r` (an offset square to the axis): signed distance out of the solid, the inward normal, and whether `r` lies within that face. */
function side(section: Section, r: number[]) {
  if ("inner" in section) {
    const n = Math.hypot(...r);
    if (n < 1e-9) return null;
    const d = n > section.outer ? n - section.outer : n < section.inner ? n - section.inner : 0;
    return { d, normal: r.map((v) => -v / n), within: true };
  }
  const [x, y] = [dot(r, section.x), dot(r, section.y)];
  const [dx, dy] = [Math.abs(x) - section.w, Math.abs(y) - section.h];
  return dx >= dy
    ? { d: dx, normal: section.x.map((v) => -Math.sign(x) * v), within: dy <= 0 }
    : { d: dy, normal: section.y.map((v) => -Math.sign(y) * v), within: dx <= 0 };
}

/** Whether `r` (an offset in an end face's plane) lies within that face. */
const withinEnd = (section: Section, r: number[]) =>
  "inner" in section
    ? Math.hypot(...r) <= section.outer
    : Math.abs(dot(r, section.x)) <= section.w && Math.abs(dot(r, section.y)) <= section.h;

/**
 * An open connector's outward axis. A segment's end reads its polyline; a node's port points from
 * the node's point, or, when the node's point is that port (a transition's insertion), away from
 * its other ports. A segment's side (`curve`) port has none.
 * ponytail: the snapshot carries no connector frame; derived from geometry, as above.
 */
function axisOf(e: Element, c: Element["connectors"][number]): number[] | null {
  if ("polyline" in e) {
    const poly = e.polyline;
    if (c.kind === "curve" || poly.length < 2) return null;
    const first = dist(c.point, poly[0]!) <= dist(c.point, poly.at(-1)!);
    return first ? unit(sub(poly[0]!, poly[1]!)) : unit(sub(poly.at(-1)!, poly.at(-2)!));
  }
  const out = sub(c.point, e.point);
  if (Math.hypot(...out) > 0.01) return unit(out);
  const others = e.connectors.filter((o) => o !== c && o.point.length === 3);
  if (!others.length) return null;
  const mid = c.point.map((_, k) => others.reduce((s, o) => s + o.point[k]!, 0) / others.length);
  return unit(sub(c.point, mid));
}

/** Which polyline ends of each segment an end cap closes: 0 the first point, 1 the last. */
function cappedEnds(snapshot: DuctSnapshot) {
  const byId = new Map(snapshot.segments.map((s) => [s.id, s]));
  const out = new Map<number, Set<0 | 1>>();
  for (const cap of snapshot.nodes)
    if (cap.kind === "cap")
      for (const c of cap.connectors) {
        const s = c.connectedTo ? byId.get(c.connectedTo.elementId) : undefined;
        const end = s?.connectors.find((p) => p.index === c.connectedTo!.connector);
        if (!s || !end || s.polyline.length < 2) continue;
        const first = dist(end.point, s.polyline[0]!) <= dist(end.point, s.polyline.at(-1)!);
        if (!out.has(s.id)) out.set(s.id, new Set());
        out.get(s.id)!.add(first ? 0 : 1);
      }
  return out;
}

interface Landing {
  segment: Segment;
  /** Signed distance out of the face, ft; negative is inside. */
  d: number;
  at: number;
  point: number[];
  face: "side" | "capped end";
}

/** The face of `s` that `point`, with outward `axis`, lands on within `tol` ft; the nearest. */
function landOn(
  s: Segment,
  capped: ReadonlySet<0 | 1> | undefined,
  point: number[],
  axis: number[],
  tol: number,
): Landing | null {
  const poly = s.polyline;
  const found: Landing[] = [];
  let run = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!,
      len = dist(a, poly[i]!),
      u = unit(sub(poly[i]!, a));
    const section = u && sectionOf(s, u);
    const t = u ? dot(sub(point, a), u) : -1;
    const face = section && t >= 0 && t <= len ? side(section, add(sub(point, a), u!, -t)) : null;
    if (face?.within && dot(axis, face.normal) > AXIS_COS)
      found.push({ segment: s, d: face.d, at: run + t, point: add(a, u!, t), face: "side" });
    run += len;
  }
  for (const end of capped ?? []) {
    const [e, f] = end ? [poly.at(-1)!, poly.at(-2)!] : [poly[0]!, poly[1]!];
    const out = unit(sub(e, f));
    const section = out && sectionOf(s, out);
    if (!out || !section || dot(axis, out) >= -AXIS_COS) continue;
    const v = sub(point, add(e, out, CAP_THICKNESS_IN / 12));
    const d = dot(v, out);
    if (withinEnd(section, add(v, out, -d)))
      found.push({ segment: s, d, at: end ? run : 0, point: e, face: "capped end" });
  }
  return (
    found.filter((l) => Math.abs(l.d) <= tol).sort((x, y) => Math.abs(x.d) - Math.abs(y.d))[0] ??
    null
  );
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
 * Joints and taps the model implies. (a) Two open connectors within `tolIn` inches join, nearest
 * pair first, each port once; shape compatibility is not required. (b) An open connector left
 * over that lands on a duct's face within `FACE_TOL_IN` (a side, or an end a cap closes, the cap
 * counted as the duct's) taps that duct where it lands, nearest face first. Each inference is a
 * finding; one that joins two elements already in one component is also a `loop-by-inference`.
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
  const capped = cappedEnds(snapshot);
  const faceTol = FACE_TOL_IN / 12;
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const p of open) {
    if (used.has(p.k)) continue;
    const element = byId.get(p.id)!;
    const axis = axisOf(element, element.connectors.find((c) => c.index === p.index)!);
    if (!axis) continue;
    let best: Landing | null = null;
    for (const s of snapshot.segments) {
      if (s.id === p.id || s.polyline.length < 2) continue;
      const landing = landOn(s, capped.get(s.id), p.point, axis, faceTol);
      if (landing && (!best || Math.abs(landing.d) < Math.abs(best.d))) best = landing;
    }
    if (!best) continue;
    const id = `proximity:${p.k}|${best.segment.id}`;
    if (ignored(work, id)) continue;
    used.add(p.k);
    const gapIn = best.d * 12;
    taps.push({
      a: p.k,
      segment: best.segment.id,
      kind: "tap-by-proximity",
      gapIn,
      at: best.at,
      point: best.point,
    });
    findings.push({
      id,
      kind: "tap-by-proximity",
      elementIds: [p.id, best.segment.id],
      note: `open end ${p.k} lands on the ${best.face} of duct ${best.segment.id}, ${Math.abs(gapIn).toFixed(2)} in ${gapIn < 0 ? "into" : "short of"} its face, ${best.at.toFixed(2)} ft along it; tapped`,
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
    const point = t.point;
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
