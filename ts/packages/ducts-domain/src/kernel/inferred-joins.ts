/** Lifted from `proximity.ts` (sectionOf, axisOf, sidesOf, depth, land, the open-pair and face-landing scans, gradeJoint); network-free: ranks join candidates for one open connector against nearby elements, no groups, no snapshot rewrite. */
import type { DuctInferenceGrade } from "@pe/agent-contracts";
import type { DuctSnapshot } from "../types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
export type Element = Node | Segment;
type Connector = Element["connectors"][number];

export const connectorKey = (id: number, index: number) => `${id}:${index}`;
const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));
const sub = (p: number[], q: number[]) => p.map((v, k) => v - q[k]!);
const add = (p: number[], q: number[], by = 1) => p.map((v, k) => v + q[k]! * by);
const dot = (p: number[], q: number[]) => p.reduce((s, v, k) => s + v * q[k]!, 0);
const unit = (p: number[]) => {
  const n = Math.hypot(...p);
  return n < 1e-9 ? null : p.map((v) => v / n);
};
/** An air classification as connectors spell it (`SupplyAir`); null when none or undefined. */
export const classOf = (v: string | null | undefined) => {
  const c = v?.replace(/\s+/g, "");
  return c && !c.startsWith("Undefined") ? c : null;
};
const segmentClass = (s: Segment) =>
  s.connectors.map((c) => classOf(c.classification)).find((c) => c != null) ??
  classOf(s.classification);

/** ponytail: tuned by one case (Project A 14122436 short of cap 14107111). */
export const FACE_TOL_IN = 2;
/** ponytail: one measured cap (Project A 14107111). */
export const CAP_THICKNESS_IN = 1;
/** The least cosine between a landing connector's outward axis and the face's inward normal. */
const AXIS_COS = 0.7;
const ACROSS_COS = Math.sqrt(1 - AXIS_COS ** 2);
export const NEAR_MISS_GAP_IN = 1;
export const NEAR_MISS_CENTRED_IN = 0.5;
export const NEAR_MISS_OPPOSED_COS = 0.9;
export const THROUGH_IN = 1;

export type Section =
  | { w: number; h: number; x: number[]; y: number[] }
  | { inner: number; outer: number };
export type Sized = Pick<Segment, "shape" | "widthIn" | "heightIn" | "diameterIn">;
/** A cross-section on axis `u`, ft, from a size and (for a rectangle) its roll `widthAxis`. */
export function sectionOf(s: Sized, u: number[], roll: number[] | null = null): Section | null {
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

/** An open connector's outward axis: the snapshot's `facing`, else derived from geometry. */
export function axisOf(e: Element, c: Connector): number[] | null {
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

/** An open connector with its frame. */
export interface OpenPort {
  k: string;
  id: number;
  index: number;
  point: number[];
  axis: number[] | null;
  captured: boolean;
  cls: string | null;
  element: Element;
}
export const openPort = (e: Element, c: Connector): OpenPort => ({
  k: connectorKey(e.id, c.index),
  id: e.id,
  index: c.index,
  point: c.point,
  axis: axisOf(e, c),
  captured: c.facing?.length === 3 && unit(c.facing) != null,
  cls: classOf(c.classification),
  element: e,
});
/** Every open connector of `e` with a 3-D point. */
export const openPortsOf = (e: Element): OpenPort[] =>
  e.connectors.filter((c) => !c.connectedTo && c.point.length === 3).map((c) => openPort(e, c));

type Onto = { segment: Segment; at: number; point: number[] } | { port: OpenPort };
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

export const rollOf = (s: Segment) =>
  s.connectors.find((c) => c.widthAxis?.length === 3)?.widthAxis ?? null;

/** Each segment's sides: one per polyline piece, swept by its section (the duct body). */
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

/** Where `p` sits against a side: `t` along, `d` out of its surface (negative inside), inward normal. */
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

/** How `p` (outward `axis`) lands on `face`: signed distance out of it (negative inside) and where it joins. */
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

/** Every face the nearby elements offer: duct sides, ends their caps close, and open connector mouths. */
function facesOf(nearby: readonly Element[], open: readonly OpenPort[]): Face[] {
  const segments = nearby.filter((e): e is Segment => "polyline" in e);
  const byId = new Map(segments.map((s) => [s.id, s]));
  const faces: Face[] = sidesOf(segments);
  for (const cap of nearby)
    for (const c of !("polyline" in cap) && cap.kind === "cap" ? cap.connectors : []) {
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
  for (const port of open) {
    const c = port.element.connectors.find((x) => x.index === port.index)!;
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

const differ = (a: string | null, b: string | null) => a != null && b != null && a !== b;

/** An open-to-open join's grade (proximity.ts gradeJoint). */
export function gradeJoint(p: OpenPort, q: OpenPort, crossing: boolean): DuctInferenceGrade {
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
}

/**
 * One way an open connector could join. `end-to-end`: another open connector within the
 * tolerance. `collar`: landing on another open connector's mouth (off-centre or not). `tap`:
 * landing on a duct's side or an end a cap closes, at `atFt` along it. `pair` is the stable
 * identity a ruling keys on: both connector keys for end-to-end and collar, the connector key
 * and the duct id for a tap.
 */
export interface JoinCandidate {
  from: string;
  toElement: number;
  /** The connector landed on; null for a tap into a duct body. */
  toConnector: number | null;
  kind: "end-to-end" | "collar" | "tap";
  pair: [string, string];
  gapIn: number;
  /** cos between the two outward axes (end-to-end, collar) or the axis and the face's inward normal sign (tap); null without an axis. */
  facingDot: number | null;
  /** Whether the two sides state different air classifications; such a join needs an accept ruling. */
  crossing: boolean;
  grade: DuctInferenceGrade;
  atFt?: number;
  point?: number[];
  /** Set by `applyConnectorPairRulings`: a person accepted it. */
  ruled?: boolean;
}

const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const byPort = (x: OpenPort, y: OpenPort) => x.id - y.id || x.index - y.index;

/**
 * Join candidates for one open connector against nearby elements, ranked nearest first:
 * open-to-open pairs within `tolIn`, then face landings within `FACE_TOL_IN` (or anywhere inside
 * a duct's body). Pure geometry; nothing is joined and no group is touched.
 */
export function candidates(open: OpenPort, nearby: readonly Element[], tolIn = 1): JoinCandidate[] {
  const tol = tolIn / 12;
  const others = nearby.filter((e) => e.id !== open.id).flatMap(openPortsOf);
  const out: JoinCandidate[] = [];
  for (const q of others) {
    const d = dist(open.point, q.point);
    if (d > tol) continue;
    const [a, b] = [open, q].sort(byPort);
    const crossing = differ(open.cls, q.cls);
    out.push({
      from: open.k,
      toElement: q.id,
      toConnector: q.index,
      kind: "end-to-end",
      pair: [a!.k, b!.k],
      gapIn: d * 12,
      facingDot: open.axis && q.axis ? dot(open.axis, q.axis) : null,
      crossing,
      grade: gradeJoint(open, q, crossing),
    });
  }
  if (open.axis) {
    const faceTol = FACE_TOL_IN / 12;
    const taken = new Set(out.map((c) => `${c.toElement}:${c.toConnector}`));
    for (const face of facesOf(
      nearby.filter((e) => e.id !== open.id),
      others,
    )) {
      const hit = land(face, open.point, open.axis);
      if (!hit) continue;
      const near = face.label === "side" ? hit.d <= faceTol : Math.abs(hit.d) <= faceTol;
      if (!near) continue;
      const crossing = differ(open.cls, face.cls);
      if ("port" in hit.onto) {
        const q = hit.onto.port;
        if (taken.has(`${q.id}:${q.index}`)) continue;
        out.push({
          from: open.k,
          toElement: q.id,
          toConnector: q.index,
          kind: "collar",
          pair: pairOf(open.k, q.k),
          gapIn: hit.d * 12,
          facingDot: q.axis ? dot(open.axis, q.axis) : null,
          crossing,
          grade: gradeJoint(open, q, crossing),
        });
        continue;
      }
      const { segment, at, point } = hit.onto;
      const gapIn = hit.d * 12;
      const through = !("polyline" in open.element) && -gapIn > THROUGH_IN;
      out.push({
        from: open.k,
        toElement: segment.id,
        toConnector: null,
        kind: "tap",
        pair: [open.k, String(segment.id)],
        gapIn,
        facingDot: face.label === "side" ? null : dot(open.axis, face.normal),
        crossing,
        grade: crossing || through ? "anomalous" : "stretched",
        atFt: at,
        point,
      });
    }
  }
  return out.sort(
    (x, y) =>
      Math.abs(x.gapIn) - Math.abs(y.gapIn) || x.pair.join("|").localeCompare(y.pair.join("|")),
  );
}

/** A person's ruling on a connector pair (end-to-end, collar) or a connector-and-duct pair (tap). */
export interface ConnectorPairRuling {
  pair: readonly [string, string];
  verdict: "accept" | "reject";
}

/**
 * Rulings over candidates: a rejected pair is dropped; an accepted pair is `ruled` and moves to
 * the front (an accept also joins across classifications); an unruled crossing candidate is
 * dropped, since ends of different classifications never join silently.
 */
export function applyConnectorPairRulings(
  cands: readonly JoinCandidate[],
  rulings: readonly ConnectorPairRuling[],
): JoinCandidate[] {
  const verdict = new Map(rulings.map((r) => [pairOf(r.pair[0], r.pair[1]).join("|"), r.verdict]));
  const kept = cands.flatMap((c) => {
    const v = verdict.get(pairOf(c.pair[0], c.pair[1]).join("|"));
    if (v === "reject") return [];
    if (v === "accept") return [{ ...c, ruled: true }];
    return c.crossing ? [] : [c];
  });
  return [...kept.filter((c) => c.ruled), ...kept.filter((c) => !c.ruled)];
}
