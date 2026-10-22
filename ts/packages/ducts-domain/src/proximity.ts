/**
 * Tolerance over repair (pressure-drop ledger, 2026-10-16): a gap or a near-miss tap that a
 * person would otherwise heal in Revit becomes a recorded graph assumption. `inferJoints` finds
 * them; `tolerate` rewrites the snapshot as if they were real reciprocal joints, so
 * `physicalGraph`, `groupTree` and the loss walk need no notion of inference. Points are model
 * feet (DuctContracts.cs); `tolIn` is inches. A staged `ignore` verdict on a finding id withholds
 * that one inference. Nothing here is stored and nothing reaches Revit.
 * A duct landing on a duct's side and a duct landing on an end cap are one rule (kaitpw
 * 2026-10-19), and so is a duct landing on an open connector's mouth off its centre (Project A SA 19
 * duct 8750451 under grille 8747668): each duct is a solid, its polyline swept by its
 * cross-section, closed at an end an end cap closes, and each open connector is a face its size
 * wide; an open connector whose point is near a face, whose axis points into it, and whose point
 * lies within the face's outline, lands there. Centering is not required and any number of
 * connectors may land on one face. A duct end anywhere inside a duct's body, pointing across it,
 * taps it at its nearest point along it, however deep (kaitpw 2026-10-19: Project A 7266368 on
 * 14342882 is a real join); the body is part of the solid, not only its surface.
 * An inference is never correct, only likely (kaitpw 2026-10-19): every joint and tap is a
 * warning a person rules on. Ends whose air classifications differ (supply, return, exhaust)
 * never join silently: the would-be join is a `near-miss-across-classifications` warning, and a
 * staged `connect` verdict on its id joins it anyway.
 * An accessory or fitting lying inside one duct's body, aligned with it, neither end connected
 * (Project A damper 13568060 inside duct 11275610), is inline on that duct (kaitpw 2026-10-19):
 * `tolerate` splices it into the duct where it sits, so its loss prices, and it is a warning too.
 * A connector faces the way the snapshot's `facing` (Revit's BasisZ) says, and a rectangular one
 * is rolled the way its `widthAxis` says; older snapshots without them fall back to geometry.
 * Inference may compute, never conclude (kaitpw 2026-10-19): every join carries a `grade` measured
 * from its geometry (`DUCT_INFERENCE_GRADES`); near-miss and stretched joins are bridged and final (ruling 5,
 * `bins.ts`), and a path resting on an anomalous one is provisional
 * (`losses.ts`), and only a person's staged `connect` (confirm) or `ignore` (break) rules on
 * it; a Pea proposal never does. A terminal whose open connector sits in a duct's open end but
 * faces the wrong way (a stand-in family; Project A grilles 10922066, 10922068 in their plenums) joins
 * that end anyway, always `anomalous`, its note naming the reversed connector and the repair.
 */
import type { DuctInferenceGrade, DuctsRouteDocument } from "@pe/agent-contracts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Element = Node | Segment;
type Group = DuctSnapshot["groups"][number];

export interface InferredJoint {
  /** The finding id that rules on it. */
  id: string;
  a: string;
  b: string;
  kind: "joined-by-proximity";
  gapIn: number;
  grade: DuctInferenceGrade;
}
export interface InferredTap {
  /** The finding id that rules on it. */
  id: string;
  a: string;
  segment: number;
  kind: "tap-by-proximity";
  gapIn: number;
  /** Along the segment's polyline from its first point, ft; a capped end's is 0 or its length. */
  at: number;
  /** Where the tap sits on the segment's centerline, ft. */
  point: number[];
  grade: DuctInferenceGrade;
}
/** An accessory or fitting spliced inline on the duct whose body holds both its open ports. */
export interface InferredInline {
  /** The finding id that rules on it. */
  id: string;
  node: number;
  segment: number;
  kind: "inline-by-inference";
  /** The node's port keys, the one facing the segment's first polyline point first. */
  ports: [string, string];
  grade: DuctInferenceGrade;
}
/**
 * The finding kinds a person rules on as inferred: a joint, tap or inline part made, one refused
 * across classifications, or an element left out of the working phase (`phases.ts`).
 */
export const INFERRED_KINDS = new Set([
  "joined-by-proximity",
  "tap-by-proximity",
  "inline-by-inference",
  "near-miss-across-classifications",
  "out-of-phase",
]);
export interface ProximityFinding {
  id: string;
  kind:
    | InferredJoint["kind"]
    | InferredTap["kind"]
    | InferredInline["kind"]
    | "loop-by-inference"
    | "near-miss-across-classifications"
    | "out-of-phase";
  elementIds: number[];
  note: string;
  /** A join's grade; null on a finding that joins nothing (a refused near miss, a loop, out of phase). */
  grade: DuctInferenceGrade | null;
}
export interface Inference {
  joints: InferredJoint[];
  taps: InferredTap[];
  inline: InferredInline[];
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
/** An air classification as connectors spell it (`SupplyAir`); null when none or undefined. */
const classOf = (v: string | null | undefined) => {
  const c = v?.replace(/\s+/g, "");
  return c && !c.startsWith("Undefined") ? c : null;
};
const segmentClass = (s: Segment) =>
  s.connectors.map((c) => classOf(c.classification)).find((c) => c != null) ??
  classOf(s.classification);

/**
 * ponytail: tuned by one case (Project A 14122436 short of cap 14107111, 1.6 in of air to the cap
 * face). Move to a ruled per-document value if more models disagree.
 */
export const FACE_TOL_IN = 2;
/** ponytail: one measured cap (Project A 14107111's face sits 1.0 in outboard of the duct end); caps carry no size in the snapshot. */
export const CAP_THICKNESS_IN = 1;
/** The least cosine between a landing connector's outward axis and the face's inward normal. */
const AXIS_COS = 0.7;
/** The most |cos| between an end's axis and a duct's run for the end, inside it, to point across it. */
const ACROSS_COS = Math.sqrt(1 - AXIS_COS ** 2);
/** The least |cos| between an inline part's port axes and its host duct's run (about 18 degrees). */
const ALONG_COS = 0.95;
/**
 * Grade bounds (pressure-drop ledger, 2026-10-19). An open-to-open join is a `near-miss` within
 * `NEAR_MISS_GAP_IN`, its connectors facing each other (cos below `-NEAR_MISS_OPPOSED_COS`) and
 * centred within `NEAR_MISS_CENTRED_IN` of each other's axis; a part's (not a duct's) port deeper
 * than `THROUGH_IN` inside a duct's body is placed through it, `anomalous`.
 * ponytail: tuned on Project A 2026-10-19 (grille 8747668 on duct 8750451 sits 2.0 in off-centre and
 * must read stretched); move to ruled per-document values if more models disagree.
 */
export const NEAR_MISS_GAP_IN = 1;
export const NEAR_MISS_CENTRED_IN = 0.5;
export const NEAR_MISS_OPPOSED_COS = 0.9;
export const THROUGH_IN = 1;
const RANK: Record<DuctInferenceGrade, number> = { "near-miss": 0, stretched: 1, anomalous: 2 };
/** The worse of two grades. */
export const worse = (a: DuctInferenceGrade, b: DuctInferenceGrade) => (RANK[b] > RANK[a] ? b : a);

/**
 * A cross-section on an axis `u`, ft, from a segment's or a connector's size. A rectangle whose
 * roll is known (`roll`, its connector's `widthAxis`) has half-sides `w` along `x` and `h` along
 * `y`; otherwise a band `inner..outer` from the centerline.
 * ponytail: snapshots before `widthAxis` carry no rect roll; there a non-vertical rect is taken in
 * Revit's default roll (width horizontal), and a vertical one (or an oval) as the round-equivalent
 * band from its half-short-side to its half-diagonal, so any roll lands.
 */
type Section =
  | { w: number; h: number; x: number[]; y: number[] }
  | { inner: number; outer: number };
type Sized = Pick<Segment, "shape" | "widthIn" | "heightIn" | "diameterIn">;
function sectionOf(s: Sized, u: number[], roll: number[] | null = null): Section | null {
  const [w, h] = [(s.widthIn ?? 0) / 24, (s.heightIn ?? 0) / 24];
  if (s.shape === "round" || (!w && !h)) {
    const r = (s.diameterIn ?? 0) / 24;
    return r > 0 ? { inner: r, outer: r } : null;
  }
  if (!w || !h) return null;
  const rolled = roll?.length === 3 ? unit(add(roll, u, -dot(roll, u))) : null;
  const x =
    s.shape !== "rectangular"
      ? null
      : (rolled ?? (Math.abs(u[2]!) < 0.99 ? unit([-u[1]!, u[0]!, 0]) : null));
  if (!x) return { inner: Math.min(w, h), outer: Math.hypot(w, h) };
  const y = [
    u[1]! * x[2]! - u[2]! * x[1]!,
    u[2]! * x[0]! - u[0]! * x[2]!,
    u[0]! * x[1]! - u[1]! * x[0]!,
  ];
  return { w, h, x, y };
}

/**
 * An open connector's outward axis: the snapshot's `facing` (Revit's BasisZ). A segment's side
 * (`curve`) port has none.
 * ponytail: snapshots before `facing` carry no connector frame, so it derives from geometry: a
 * segment's end reads its polyline; a node's port points from the node's point, or, when the
 * node's point is that port (a transition's insertion), away from its other ports. A one-port node
 * whose port is its insertion point (Project A grilles 10922066, 10922068) derives none.
 */
function axisOf(e: Element, c: Element["connectors"][number]): number[] | null {
  if (c.kind === "curve" && "polyline" in e) return null;
  const facing = c.facing?.length === 3 ? unit(c.facing) : null;
  if (facing) return facing;
  if ("polyline" in e) {
    const poly = e.polyline;
    if (poly.length < 2) return null;
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

/** An open connector: its key, element, index, point and outward axis (null when none derives). */
interface Port {
  k: string;
  id: number;
  index: number;
  point: number[];
  axis: number[] | null;
  /** Whether `axis` is the snapshot's captured `facing`, not derived from geometry. */
  captured: boolean;
  /** Its air classification; null when it states none. */
  cls: string | null;
}
/** Where a landing joins: a tap on a segment's centerline, or the open port whose face it is. */
type Onto = { segment: Segment; at: number; point: number[] } | { port: Port };
/**
 * A face something can land on, owned by element `owner`. A `side` is one polyline piece of a
 * segment swept by its section; a planar face (a capped segment end, an open connector's mouth)
 * is a plane through `origin` facing out along `normal`, bounded by `section`.
 */
type Face =
  | {
      label: "side";
      owner: number;
      cls: string | null;
      segment: Segment;
      a: number[];
      u: number[];
      len: number;
      run: number;
      section: Section;
    }
  | {
      label: "capped end" | "connector face";
      owner: number;
      cls: string | null;
      origin: number[];
      normal: number[];
      section: Section;
      onto: Onto;
    };
type Side = Extract<Face, { label: "side" }>;

/** A rectangular segment's roll: the first of its connectors that states a `widthAxis`. */
const rollOf = (s: Segment) =>
  s.connectors.find((c) => c.widthAxis?.length === 3)?.widthAxis ?? null;

/** Each segment's sides: one per polyline piece, swept by its section. */
export function sidesOf(segments: readonly Segment[]): Side[] {
  const sides: Side[] = [];
  for (const s of segments) {
    let run = 0;
    for (let i = 1; i < s.polyline.length; i++) {
      const a = s.polyline[i - 1]!,
        len = dist(a, s.polyline[i]!),
        u = unit(sub(s.polyline[i]!, a)),
        section = u && sectionOf(s, u, rollOf(s));
      if (u && section)
        sides.push({
          label: "side",
          owner: s.id,
          cls: segmentClass(s),
          segment: s,
          a,
          u,
          len,
          run,
          section,
        });
      run += len;
    }
  }
  return sides;
}

/**
 * Every face in the snapshot: each segment's sides, each end an end cap closes (the cap counted
 * as the segment's, its face `CAP_THICKNESS_IN` outboard), and each open connector's mouth.
 */
function facesOf(snapshot: DuctSnapshot, open: readonly Port[]): Face[] {
  const faces: Face[] = sidesOf(snapshot.segments);
  const byId = new Map(snapshot.segments.map((s) => [s.id, s]));
  for (const cap of snapshot.nodes)
    for (const c of cap.kind === "cap" ? cap.connectors : []) {
      const s = c.connectedTo ? byId.get(c.connectedTo.elementId) : undefined;
      const end = s?.connectors.find((p) => p.index === c.connectedTo!.connector);
      const poly = s?.polyline ?? [];
      if (!s || !end || poly.length < 2) continue;
      const first = dist(end.point, poly[0]!) <= dist(end.point, poly.at(-1)!);
      const [e, f] = first ? [poly[0]!, poly[1]!] : [poly.at(-1)!, poly.at(-2)!];
      const normal = unit(sub(e, f));
      const section = normal && sectionOf(s, normal, rollOf(s));
      if (!normal || !section) continue;
      const at = first ? 0 : s.polyline.slice(1).reduce((t, q, i) => t + dist(poly[i]!, q), 0);
      faces.push({
        label: "capped end",
        owner: s.id,
        cls: segmentClass(s),
        origin: add(e, normal, CAP_THICKNESS_IN / 12),
        normal,
        section,
        onto: { segment: s, at, point: e },
      });
    }
  const elements = new Map<number, Element>(
    [...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]),
  );
  for (const port of open) {
    const c = elements.get(port.id)!.connectors.find((x) => x.index === port.index)!;
    const section = port.axis && sectionOf(c, port.axis, c.widthAxis ?? null);
    if (port.axis && section)
      faces.push({
        label: "connector face",
        owner: port.id,
        cls: port.cls,
        origin: port.point,
        normal: port.axis,
        section,
        onto: { port },
      });
  }
  return faces;
}

/**
 * Where `p` sits against a side: `t` along its piece, `d` out of its surface, ft (negative inside,
 * 0 within a band), and the inward normal it would land along (null inside); null off the piece's
 * run, or beyond a rectangle's corner.
 */
export function depth(face: Side, p: number[]) {
  const { section } = face;
  const t = dot(sub(p, face.a), face.u);
  if (t < 0 || t > face.len) return null;
  const r = add(sub(p, face.a), face.u, -t);
  let d: number, normal: number[] | null;
  if ("inner" in section) {
    const n = Math.hypot(...r);
    d = n > section.outer ? n - section.outer : n < section.inner ? n - section.inner : 0;
    normal = d < 0 ? null : r.map((v) => -v / n);
  } else {
    const [x, y] = [dot(r, section.x), dot(r, section.y)];
    const [dx, dy] = [Math.abs(x) - section.w, Math.abs(y) - section.h];
    if (Math.min(dx, dy) > 0) return null;
    [d, normal] =
      dx >= dy
        ? [dx, section.x.map((v) => -Math.sign(x) * v)]
        : [dy, section.y.map((v) => -Math.sign(y) * v)];
    if (d < 0) normal = null;
  }
  return { t, d, normal };
}

/**
 * How `p` (outward `axis`) lands on `face`: the signed distance out of it, ft (negative is
 * inside), and where it joins; null when it points away or lies outside the face's outline.
 * Inside a duct's body an end lands however deep, so one on the centerline taps too, when it
 * points across the run or along it away from the run's nearer end (an overlap coming in through
 * that end); outside or on the surface its axis must point into the face.
 */
function land(face: Face, p: number[], axis: number[]): { d: number; onto: Onto } | null {
  const { section } = face;
  if (face.label === "side") {
    const at = depth(face, p);
    if (!at) return null;
    const { t, d, normal } = at;
    const along = dot(axis, face.u);
    const outward =
      Math.abs(along) >= ACROSS_COS && Math.sign(along) !== (t < face.len / 2 ? 1 : -1);
    if (normal ? dot(axis, normal) <= AXIS_COS : outward) return null;

    return { d, onto: { segment: face.segment, at: face.run + t, point: add(face.a, face.u, t) } };
  }
  if (dot(axis, face.normal) >= -AXIS_COS) return null;
  const v = sub(p, face.origin);
  const d = dot(v, face.normal);
  const r = add(v, face.normal, -d);
  const within =
    "inner" in section
      ? Math.hypot(...r) <= section.outer
      : Math.abs(dot(r, section.x)) <= section.w && Math.abs(dot(r, section.y)) <= section.h;
  return within ? { d, onto: face.onto } : null;
}

/**
 * The staged verdict on a finding id, if any: `ignore` withholds it, `connect` confirms it (and
 * joins it across classifications). Staged only: a proposal is Pea's and never rules.
 */
export const verdictOf = (work: DuctsRouteDocument | null, id: string) => {
  const value = work?.assumptions[id]?.staged?.value;
  return value?.kind === "verdict" ? value.verdict : null;
};
const differ = (a: string | null, b: string | null) => a != null && b != null && a !== b;

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
 * over that lands on a face within `FACE_TOL_IN` (or anywhere inside a duct's body), nearest face
 * first, joins what owns it: a duct's side or an end a cap closes (the cap counted as the duct's)
 * is tapped where it lands; an open connector's mouth (terminal, equipment, duct, fitting) is
 * joined, off-centre or not, and several ends may land on one face. Either way, ends whose
 * classifications differ do not join without a staged `connect` verdict: each such near miss is a
 * `near-miss-across-classifications` finding, and (b) goes on to the next face whose classes agree.
 * Each inference is a finding; one that joins two elements already in one component is also a
 * `loop-by-inference`.
 */
export function inferJoints(
  snapshot: DuctSnapshot,
  tolIn = 1,
  work: DuctsRouteDocument | null = null,
): Inference {
  const tol = tolIn / 12;
  const elements: Element[] = [...snapshot.nodes, ...snapshot.segments];
  const equipment = new Set(snapshot.nodes.filter((n) => n.kind === "equipment").map((n) => n.id));
  const open: Port[] = elements.flatMap((e) =>
    e.connectors
      .filter((c) => !c.connectedTo && c.point.length === 3)
      .map((c) => ({
        k: key(e.id, c.index),
        id: e.id,
        index: c.index,
        point: c.point,
        axis: axisOf(e, c),
        captured: c.facing?.length === 3 && unit(c.facing) != null,
        cls: classOf(c.classification),
      })),
  );
  const { find, union } = components(elements, equipment);
  const byId = new Map(elements.map((e) => [e.id, e]));
  /** A person's name for an element: family and type (or size) and kind, its id, its system. */
  const named = (id: number) => {
    const e = byId.get(id)!;
    const what =
      "polyline" in e
        ? `${e.size.replaceAll('"', "")} ${e.kind} ${id}`
        : `${[e.family, e.type, e.kind].filter(Boolean).join(" ")} ${id}`;
    return e.systemName ? `${what} (${e.systemName})` : what;
  };
  /**
   * An open-to-open join's grade: `anomalous` across classes (a person's connect) or with both
   * captured facings pointing one way (one connector reversed); `near-miss` when sub-inch, of one
   * classification, opposed and centred; else `stretched`.
   */
  const gradeJoint = (p: Port, q: Port, crossing: boolean): DuctInferenceGrade => {
    if (crossing || (p.captured && q.captured && dot(p.axis!, q.axis!) >= AXIS_COS))
      return "anomalous";
    if (!p.axis || !q.axis || p.cls !== q.cls) return "stretched";
    const r = sub(q.point, p.point);
    const lateral = Math.hypot(...add(r, p.axis, -dot(r, p.axis))) * 12;
    return dist(p.point, q.point) * 12 <= NEAR_MISS_GAP_IN &&
      dot(p.axis, q.axis) < -NEAR_MISS_OPPOSED_COS &&
      lateral <= NEAR_MISS_CENTRED_IN
      ? "near-miss"
      : "stretched";
  };
  /** An anomalous join's sentence: what is wrong, and its repair. */
  const anomaly = (crossing: boolean, a: number, b: number) =>
    crossing
      ? `${named(a)} and ${named(b)} are joined across air classifications by a person's connect verdict. Fix: put both on one system in Revit.`
      : `${named(a)} and ${named(b)} are joined though their connectors face the same way, so one is reversed. Fix: flip the reversed connector (Family Foundry migration) or replace the family.`;
  const joints: InferredJoint[] = [],
    taps: InferredTap[] = [],
    inline: InferredInline[] = [],
    findings: ProximityFinding[] = [];
  const used = new Set<string>();
  const warned = new Set<string>();
  const across = (id: string, elementIds: number[], note: string) => {
    if (warned.has(id)) return;
    warned.add(id);
    findings.push({ id, kind: "near-miss-across-classifications", elementIds, note, grade: null });
  };
  const closes = (id: string, a: number, b: number) => {
    if (!equipment.has(a) && !equipment.has(b) && find(a) === find(b))
      findings.push({
        id: `loop-by-inference:${id.slice("proximity:".length)}`,
        kind: "loop-by-inference",
        elementIds: [a, b],
        note: `inferring ${id} closes a loop: ${a} and ${b} were already connected another way`,
        grade: null,
      });
    union(a, b);
  };
  // (0) A two-port accessory or fitting inside one straight duct's body, its ports open and
  // facing opposite ways along the run, is inline on it. ponytail: one inline part per duct.
  const portOf = new Map(open.map((p) => [p.k, p]));
  const hosted = new Set<number>();
  const straight = sidesOf(
    snapshot.segments.filter((s) => s.kind === "duct" && s.polyline.length === 2),
  );
  for (const n of snapshot.nodes) {
    if ((n.kind !== "accessory" && n.kind !== "fitting") || n.connectors.length !== 2) continue;
    const [p, q] = n.connectors.map((c) => portOf.get(key(n.id, c.index)));
    if (!p?.axis || !q?.axis || dot(p.axis, q.axis) > -ALONG_COS) continue;
    const host = straight.find(
      (f) =>
        !hosted.has(f.owner) &&
        Math.abs(dot(p.axis!, f.u)) >= ALONG_COS &&
        !differ(p.cls ?? q.cls, f.cls) &&
        [p, q].every((x) => (depth(f, x.point)?.d ?? 1) <= 0),
    );
    if (!host) continue;
    const id = `proximity:${n.id}|${host.owner}`;
    if (verdictOf(work, id) === "ignore") continue;
    hosted.add(host.owner);
    used.add(p.k).add(q.k);
    const at = (dot(sub(p.point, host.a), host.u) + dot(sub(q.point, host.a), host.u)) / 2;
    const ports: [string, string] = dot(p.axis, host.u) < 0 ? [p.k, q.k] : [q.k, p.k];
    inline.push({
      id,
      node: n.id,
      segment: host.owner,
      kind: "inline-by-inference",
      ports,
      grade: "stretched",
    });
    findings.push({
      id,
      kind: "inline-by-inference",
      elementIds: [n.id, host.owner],
      note: `${n.kind} ${n.id}${n.family ? ` (${n.family})` : ""} lies inside duct ${host.owner}, ${at.toFixed(2)} ft along it and aligned with it, with neither end connected; counted inline on it`,
      grade: "stretched",
    });
    closes(id, n.id, host.owner);
  }
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
    const verdict = verdictOf(work, id);
    if (verdict === "ignore") continue;
    const gapIn = d * 12;
    const what = `open ends ${a.k} and ${b.k} are ${gapIn.toFixed(2)} in apart`;
    const crossing = differ(a.cls, b.cls);
    if (crossing && verdict !== "connect") {
      across(
        id,
        [a.id, b.id],
        `${what}, but ${a.k} is ${a.cls} and ${b.k} is ${b.cls}; not joined`,
      );
      continue;
    }
    used.add(a.k).add(b.k);
    const grade = gradeJoint(a, b, crossing);
    joints.push({ id, a: a.k, b: b.k, kind: "joined-by-proximity", gapIn, grade });
    findings.push({
      id,
      kind: "joined-by-proximity",
      elementIds: [a.id, b.id],
      note: grade === "anomalous" ? anomaly(crossing, a.id, b.id) : `${what}; joined`,
      grade,
    });
    closes(id, a.id, b.id);
  }
  const faces = facesOf(
    snapshot,
    open.filter((p) => !inline.some((x) => x.ports.includes(p.k))),
  );
  const faceTol = FACE_TOL_IN / 12;
  for (const p of open) {
    if (used.has(p.k) || !p.axis) continue;
    const hits = faces
      .flatMap((face) => {
        const hit = face.owner === p.id ? null : land(face, p.point, p.axis!);
        const near = hit && (face.label === "side" ? hit.d <= faceTol : Math.abs(hit.d) <= faceTol);
        return near ? [{ ...hit, face }] : [];
      })
      .sort((x, y) => Math.abs(x.d) - Math.abs(y.d));
    for (const { d, onto, face } of hits) {
      const gapIn = d * 12;
      const how = `${Math.abs(gapIn).toFixed(2)} in ${gapIn < 0 ? "into" : "short of"} its face`;
      const q = "port" in onto ? onto.port : null;
      const id = q
        ? `proximity:${[p, q]
            .sort((x, y) => x.id - y.id || x.index - y.index)
            .map((x) => x.k)
            .join("|")}`
        : `proximity:${p.k}|${face.owner}`;
      const verdict = verdictOf(work, id);
      const crossing = differ(p.cls, face.cls);
      // An ignored join withholds this end; an ignored near miss only silences its warning.
      if (verdict === "ignore") {
        if (crossing) continue;
        break;
      }
      const lands =
        "port" in onto
          ? `open end ${p.k} lands on open connector ${onto.port.k}'s face, ${how}, ${dist(p.point, onto.port.point) * 12 > 0.005 ? `${(dist(p.point, onto.port.point) * 12).toFixed(2)} in from its centre` : "centred"}`
          : `open end ${p.k} lands on the ${face.label} of duct ${face.owner}, ${how}, ${onto.at.toFixed(2)} ft along it`;
      if (crossing && verdict !== "connect") {
        across(
          id,
          [p.id, face.owner],
          `${lands}, but ${p.k} is ${p.cls} and ${face.owner} is ${face.cls}; not joined`,
        );
        continue;
      }
      used.add(p.k);
      if ("port" in onto) {
        used.add(onto.port.k);
        const grade = gradeJoint(p, onto.port, crossing);
        joints.push({ id, a: p.k, b: onto.port.k, kind: "joined-by-proximity", gapIn, grade });
        findings.push({
          id,
          kind: "joined-by-proximity",
          elementIds: [p.id, onto.port.id],
          note: grade === "anomalous" ? anomaly(crossing, p.id, onto.port.id) : `${lands}; joined`,
          grade,
        });
        closes(id, p.id, onto.port.id);
        break;
      }
      const { segment, at, point } = onto;
      // A part's port deep in a duct's body was placed through it, not at its end.
      const through = !("polyline" in byId.get(p.id)!) && -gapIn > THROUGH_IN;
      const grade: DuctInferenceGrade = crossing || through ? "anomalous" : "stretched";
      taps.push({
        id,
        a: p.k,
        segment: segment.id,
        kind: "tap-by-proximity",
        gapIn,
        at,
        point,
        grade,
      });
      findings.push({
        id,
        kind: "tap-by-proximity",
        elementIds: [p.id, segment.id],
        note: crossing
          ? anomaly(true, p.id, segment.id)
          : through
            ? `${named(p.id)}'s connector sits ${(-gapIn).toFixed(2)} in inside ${named(segment.id)}, ${at.toFixed(2)} ft along it, not at its end; tapped there. Fix: move the part to the duct's end or face, or replace the family.`
            : `${lands}; tapped`,
        grade,
      });
      closes(id, p.id, segment.id);
      break;
    }
  }
  // (c) A terminal whose open connector lies in a duct's body or within `FACE_TOL_IN` of its open
  // end, facing along the duct either way, joins that end even facing the wrong way (Project A
  // grilles 10922066, 10922068 inside their 72x3 plenums): always `anomalous`.
  const ends = open.filter((q) => q.axis && "polyline" in byId.get(q.id)!);
  for (const p of open) {
    const e = byId.get(p.id)!;
    if (used.has(p.k) || !p.axis || "polyline" in e || e.kind !== "terminal") continue;
    const best = ends
      .flatMap((q) => {
        if (used.has(q.k) || Math.abs(dot(p.axis!, q.axis!)) < ALONG_COS) return [];
        const s = byId.get(q.id) as Segment;
        const c = s.connectors.find((x) => x.index === q.index)!;
        const section = sectionOf(c, q.axis!, c.widthAxis ?? null);
        const v = sub(p.point, q.point);
        const plane = dot(v, q.axis!);
        const r = add(v, q.axis!, -plane);
        const within =
          section &&
          ("inner" in section
            ? Math.hypot(...r) <= section.outer
            : Math.abs(dot(r, section.x)) <= section.w && Math.abs(dot(r, section.y)) <= section.h);
        const inside = sidesOf([s]).some((side) => (depth(side, p.point)?.d ?? 1) <= 0);
        return within && (Math.abs(plane) <= faceTol || inside) ? [{ q, s, plane }] : [];
      })
      .sort((x, y) => dist(p.point, x.q.point) - dist(p.point, y.q.point))[0];
    if (!best) continue;
    const { q, s, plane } = best;
    const id = `proximity:${[p, q]
      .sort((x, y) => x.id - y.id || x.index - y.index)
      .map((x) => x.k)
      .join("|")}`;
    const verdict = verdictOf(work, id);
    if (verdict === "ignore") continue;
    const crossing = differ(p.cls, q.cls);
    const where =
      plane < -faceTol
        ? `sits inside ${named(s.id)}, ${(-plane * 12).toFixed(2)} in from its open end, not at its end`
        : `sits at the open end of ${named(s.id)}, ${Math.abs(plane * 12).toFixed(2)} in ${plane < 0 ? "inside" : "beyond"} it`;
    if (crossing && verdict !== "connect") {
      across(
        id,
        [p.id, s.id],
        `${named(p.id)} ${where}, but ${p.k} is ${p.cls} and ${q.k} is ${q.cls}; not joined`,
      );
      continue;
    }
    used.add(p.k).add(q.k);
    const gapIn = plane * 12;
    joints.push({ id, a: p.k, b: q.k, kind: "joined-by-proximity", gapIn, grade: "anomalous" });
    findings.push({
      id,
      kind: "joined-by-proximity",
      elementIds: [p.id, s.id],
      note: `${named(p.id)}'s connector ${p.k} faces ${dot(p.axis, q.axis!) > 0 ? "away from" : "into"} its duct and it ${where}; treated as ${s.systemName ?? `duct ${s.id}`}'s terminal. Fix: replace the stand-in family or flip its connector (Family Foundry migration).`,
      grade: "anomalous",
    });
    closes(id, p.id, s.id);
  }
  return { joints, taps, inline, findings };
}

/**
 * Two element ids in the tolerated snapshot only inference `id` joins: a joint's two elements, a
 * tap's virtual fitting and its branch, or an inline part and either half of its host. A path
 * stepping between them rests on that inference.
 */
export interface InferredLink {
  id: string;
  between: readonly [number, number];
  grade: DuctInferenceGrade;
  /** A person staged `connect` on it: confirmed, so it no longer makes a path provisional. */
  ruled: boolean;
}

/**
 * The snapshot with every inference applied as a real joint: reciprocal `connectedTo` links, one
 * virtual `Tap` fitting (negative id) hung off a new `curve` connector per inferred tap, each
 * inline part spliced into its host (the host cut where the part sits, its far half a virtual
 * segment with a negative id carrying the host's far end, side ports and flow), the consumed
 * `open-end` issues dropped, and the groups it bridged merged into one (the one with equipment,
 * else the lower id). The input is never mutated.
 */
export function tolerate(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null = null,
  tolIn = 1,
): Inference & { snapshot: DuctSnapshot; links: InferredLink[] } {
  const inference = inferJoints(snapshot, tolIn, work);
  const link = (
    x: { id: string; grade: DuctInferenceGrade },
    between: readonly [number, number],
  ) => ({
    id: x.id,
    between,
    grade: x.grade,
    ruled: verdictOf(work, x.id) === "connect",
  });
  const links: InferredLink[] = [
    ...inference.joints.map((j) => link(j, [parse(j.a).elementId, parse(j.b).elementId])),
    ...inference.taps.map((t, i) => link(t, [-(i + 1), parse(t.a).elementId])),
    ...inference.inline.flatMap((x, i) => [
      link(x, [x.segment, x.node]),
      link(x, [x.node, -(inference.taps.length + i + 1)]),
    ]),
  ];
  if (!inference.joints.length && !inference.taps.length && !inference.inline.length)
    return { snapshot, links, ...inference };
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
    let b = j.b;
    if (consumed.has(b)) {
      // Several ends landing on one connector's face: each later one joins a copy of that port.
      const owner = byId.get(parse(b).elementId)!;
      const index = Math.max(-1, ...owner.connectors.map((c) => c.index)) + 1;
      owner.connectors.push({ ...port(b), index, connectedTo: null });
      b = key(owner.id, index);
    }
    port(j.a).connectedTo = parse(b);
    port(b).connectedTo = parse(j.a);
    consumed.add(j.a).add(b);
    bridge(parse(j.a).elementId, parse(b).elementId);
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
  const flows = [...snapshot.flows];
  inference.inline.forEach((x, i) => {
    const id = -(inference.taps.length + i + 1);
    const main = byId.get(x.segment) as Segment;
    const [a, b] = [main.polyline[0]!, main.polyline.at(-1)!];
    const len = dist(a, b);
    const u = unit(sub(b, a))!;
    const along = (p: number[]) => Math.max(0, Math.min(len, dot(sub(p, a), u)));
    const [first, second] = x.ports.map(port);
    const [cut, resume] = [along(first!.point), along(second!.point)];
    // The far half keeps the end nearer `b` and every side port past the cut.
    const far = main.connectors.filter((c) =>
      c.kind === "end" ? dist(c.point, b) < dist(c.point, a) : along(c.point) > cut,
    );
    const moved = new Set(far.map((c) => c.index));
    const template = far.find((c) => c.kind === "end") ?? main.connectors[0]!;
    const index = Math.max(-1, ...main.connectors.map((c) => c.index)) + 1;
    const end = (point: number[], k: string) => ({
      ...template,
      index,
      kind: "end",
      point,
      connectedTo: parse(k),
    });
    const rest: Segment = {
      ...main,
      id,
      uniqueId: null,
      polyline: [add(a, u, resume), b],
      lengthFt: (main.lengthFt * (len - resume)) / len,
      connectors: [...far, end(add(a, u, resume), x.ports[1])],
    };
    for (const e of byId.values())
      for (const c of e.connectors)
        if (c.connectedTo?.elementId === main.id && moved.has(c.connectedTo.connector))
          c.connectedTo = { elementId: id, connector: c.connectedTo.connector };
    main.polyline = [a, add(a, u, cut)];
    main.lengthFt = (main.lengthFt * cut) / len;
    main.connectors = [
      ...main.connectors.filter((c) => !moved.has(c.index)),
      end(add(a, u, cut), x.ports[0]),
    ];
    first!.connectedTo = { elementId: main.id, connector: index };
    second!.connectedTo = { elementId: id, connector: index };
    segments.push(rest);
    byId.set(id, rest);
    const flow = flows.find((f) => f.segmentId === main.id);
    if (flow) flows.push({ ...flow, segmentId: id });
    consumed.add(x.ports[0]).add(x.ports[1]);
    if (main.groupId != null) groups.get(canon(main.groupId))!.elementCount += 1;
    bridge(x.node, main.id);
  });
  const regroup = <T extends { groupId?: string | null }>(e: T): T =>
    e.groupId == null ? e : { ...e, groupId: canon(e.groupId) };
  const openEnd = (issue: DuctSnapshot["issues"][number]) =>
    issue.kind === "open-end" &&
    issue.elementId != null &&
    consumed.has(key(issue.elementId, Number(issue.id.split(":").at(-1))));
  // A group that absorbed others has new roots: the root-count issues the Revit read raised on
  // the pieces (`no-root` on a fragment that now has the fan, `multi-root` on a part) are stale, so
  // they are re-derived from the merged group.
  const absorbers = new Set([...alias.keys()].map(canon));
  const rootCount = (i: DuctSnapshot["issues"][number]) =>
    (i.kind === "no-root" || i.kind === "multi-root") && absorbers.has(canon(i.groupId));
  const rederived = [...absorbers].flatMap((id): DuctSnapshot["issues"] => {
    const g = groups.get(id)!;
    if (g.rootIds.length > 1)
      return [
        {
          id: `multi-root:${id}`,
          kind: "multi-root" as const,
          groupId: id,
          note: `${g.rootIds.length} equipment ports on ${g.rootIds.length} equipment`,
        },
      ];
    if (g.rootIds.length === 0 && g.terminalCount > 0)
      return [
        { id: `no-root:${id}`, kind: "no-root" as const, groupId: id, note: "terminals but no equipment port" },
      ];
    return [];
  });
  const issues = [
    ...snapshot.issues.filter((i) => !openEnd(i) && !rootCount(i)).map(regroup),
    ...rederived,
  ];
  const kept = new Set(issues.map((i) => i.id));
  const merged: Group[] = snapshot.groups.flatMap((g) => {
    const group = groups.get(g.id);
    if (!group) return [];
    const fresh = rederived.filter((i) => i.groupId === g.id).map((i) => i.id);
    const stale = new Set(fresh);
    return [
      { ...group, issueIds: [...group.issueIds.filter((id) => kept.has(id) && !stale.has(id)), ...fresh] },
    ];
  });
  return {
    ...inference,
    links,
    snapshot: {
      ...snapshot,
      groups: merged,
      nodes: nodes.map(regroup),
      segments: segments.map(regroup),
      flows,
      issues,
    },
  };
}
