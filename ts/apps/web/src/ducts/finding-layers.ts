/**
 * The picture's findings in 3D, the way the tutorial illustrations draw them (docs-cases): an
 * orange ring on an open end, an amber outline on a capped end, a red dashed bar across the gap of
 * a join Pe infers with both end faces outlined and the overhung edges bright red, a bar from each
 * tapping end to its landing, and an amber translucent box where a heal adds a piece or a cap.
 * A chosen system draws every finding touching its mesh-capture members. With no system, only
 * `annotated` findings draw. The face maths is `ducts-domain/faces` over the grader's `sectionOf`,
 * so what is painted as overhung is what the proximity rule measured. Points are model feet.
 */
import * as THREE from "three";

import type { DuctsRouteDocument } from "@pe/agent-contracts";
import { edgesOf, outlineOf, overhang, type Edge, type Outline } from "@pe/ducts-domain/faces";
import { healPlan } from "@pe/ducts-domain/heal";
import {
  axisOf,
  CAP_THICKNESS_IN,
  capFacesOf,
  inferJoints,
  rollOf,
  verdictOf,
} from "@pe/ducts-domain/proximity";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { inkOf } from "#/scene/ink";
import { markFrame, markLines, markVolume } from "#/scene/marks";
import type { Layer3D } from "#/scene/types";
import type { NoRunBranch } from "@pe/ducts-domain/no-runs";
import { issueAt, type StageIssue } from "./inbox-rows";

/** The illustrations' inks (the duct cases page): inferred red, open end orange, cap and heal amber. */
const INK = {
  inferred: 0xd32f2f,
  overhang: 0xff1744,
  open: 0xe07a00,
  cap: 0xd9a400,
  missed: "viz-1",
} as const;
type Ink = keyof typeof INK;

type Element = DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number];
type Connector = Element["connectors"][number];

/** An oriented box or cylinder: unit axes and half sizes along each (a cylinder's third axis is its run, the first two its radius). */
export interface OrientedBox {
  finding: string;
  elementId: number;
  shape: "box" | "cylinder";
  center: number[];
  axes: [number[], number[], number[]];
  half: [number, number, number];
}
export interface FindingShapes {
  outlines: { outline: Outline; ink: Ink; finding: string; elementId: number }[];
  /** Dashed bars: the gap of a join, or a tapping end to its landing. */
  bars: FindingEdge[];
  /** Advisory gap bars; never a join in the priced graph. */
  missedBars: FindingEdge[];
  overhang: FindingEdge[];
  /** What a heal adds. */
  boxes: OrientedBox[];
}

type FindingEdge = Edge & { finding: string; elementId: number };
const edgeFor = (finding: string, elementId: number, edge: Edge): FindingEdge =>
  Object.assign(edge, { finding, elementId });

const sub = (p: number[], q: number[]) => p.map((v, k) => v - q[k]!);
const add = (p: number[], q: number[], by = 1) => p.map((v, k) => v + q[k]! * by);
const dot = (p: number[], q: number[]) => p.reduce((s, v, k) => s + v * q[k]!, 0);
const unit = (p: number[]) => {
  const n = Math.hypot(...p);
  return n < 1e-9 ? null : p.map((v) => v / n);
};

// System and diagnostic changes reuse the same model-wide inference, which is the expensive part.
const inferences = new WeakMap<
  DuctSnapshot,
  { work: DuctsRouteDocument | null; value: ReturnType<typeof inferJoints> }
>();

export function findingShapes(
  snapshot: DuctSnapshot,
  annotated: ReadonlySet<string>,
  work: DuctsRouteDocument | null,
  /** The raw system's mesh-capture scope, not its priced tree's shared equipment and other ports. */
  members?: ReadonlySet<number>,
): FindingShapes {
  work = withStoredRulings(work, snapshot.store);
  let cached = inferences.get(snapshot);
  if (!cached || cached.work !== work) {
    cached = { work, value: inferJoints(snapshot, 1, work) };
    inferences.set(snapshot, cached);
  }
  const inference = cached.value;
  const shown = new Set(
    members
      ? inference.findings
          .filter((f) => f.elementIds.some((id) => members.has(id)))
          .map((f) => f.id)
      : annotated,
  );
  if (members) {
    // Inferred joins replace their raw open-end warnings, as in the survey used by the inbox.
    const closed = new Set([
      ...inference.joints.flatMap((j) => [j.a, j.b]),
      ...inference.taps.map((t) => t.a),
      ...inference.inline.flatMap((i) => i.ports),
    ]);
    for (const issue of snapshot.issues)
      if (
        issue.kind === "open-end" &&
        issue.elementId != null &&
        members.has(issue.elementId) &&
        !closed.has(`${issue.elementId}:${issue.id.split(":").at(-1)}`) &&
        verdictOf(work, issue.id) !== "ignore"
      )
        shown.add(issue.id);
  }
  const shapes: FindingShapes = { outlines: [], bars: [], missedBars: [], overhang: [], boxes: [] };
  const elements = new Map<number, Element>(
    [...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]),
  );
  const end = (k: string) => {
    const [id, index] = k.split(":").map(Number);
    const e = elements.get(id!);
    const c = e?.connectors.find((x) => x.index === index);
    return e && c ? { e, c } : null;
  };
  const faceOf = (e: Element, c: Connector) => {
    const axis = axisOf(e, c);
    return axis && c.point.length === 3 ? outlineOf(c, c.point, axis, c.widthAxis ?? null) : null;
  };
  const drawn = new Set<string>();
  const outline = (k: string, ink: Ink, finding: string) => {
    const at = end(k);
    const o = at && faceOf(at.e, at.c);
    if (o && !drawn.has(`${finding}:${ink}:${k}`)) {
      drawn.add(`${finding}:${ink}:${k}`);
      shapes.outlines.push({ outline: o, ink, finding, elementId: at!.e.id });
    }
    return o;
  };
  const caps = capFacesOf(snapshot);
  const named = new Map<number, string>();
  const capOutline = (cap: (typeof caps)[number], finding: string) => {
    const key = `cap:${finding}:${cap.owner}:${cap.at}`;
    if (drawn.has(key)) return;
    drawn.add(key);
    const o = outlineOf(cap.segment, cap.origin, cap.normal, rollOf(cap.segment));
    if (o) shapes.outlines.push({ outline: o, ink: "cap", finding, elementId: cap.owner });
  };

  for (const issue of snapshot.issues)
    if (issue.kind === "open-end" && issue.elementId != null && shown.has(issue.id)) {
      outline(`${issue.elementId}:${issue.id.split(":").at(-1)}`, "open", issue.id);
      named.set(issue.elementId, issue.id);
    }

  for (const j of inference.joints) {
    if (!shown.has(j.id)) continue;
    const [a, b] = [outline(j.a, "inferred", j.id), outline(j.b, "inferred", j.id)];
    if (!a || !b) continue;
    shapes.bars.push(edgeFor(j.id, Number(j.a.split(":")[0]), [a.center, b.center]));
    shapes.overhang.push(
      ...overhang(a, b).map((e) => edgeFor(j.id, Number(j.a.split(":")[0]), e)),
      ...overhang(b, a).map((e) => edgeFor(j.id, Number(j.b.split(":")[0]), e)),
    );
    named.set(Number(j.a.split(":")[0]), j.id).set(Number(j.b.split(":")[0]), j.id);
  }
  for (const f of inference.findings) {
    if (f.kind !== "missed-join" || !shown.has(f.id) || !f.connectors) continue;
    const [a, b] = f.connectors.map((k) => outline(k, "missed", f.id));
    if (a && b) shapes.missedBars.push(edgeFor(f.id, f.elementIds[0]!, [a.center, b.center]));
  }
  for (const t of inference.taps) {
    if (!shown.has(t.id)) continue;
    const from = outline(t.a, "inferred", t.id);
    if (!from) continue;
    named.set(Number(t.a.split(":")[0]), t.id);
    // Landing on a capped end is the cap's face; on a side, the duct's section at the landing.
    const cap = caps.find(
      (c) => c.owner === t.segment && Math.hypot(...sub(c.end, t.point)) < 0.01,
    );
    if (cap) {
      capOutline(cap, t.id);
      shapes.bars.push(edgeFor(t.id, Number(t.a.split(":")[0]), [from.center, cap.origin]));
      continue;
    }
    const seg = elements.get(t.segment) as DuctSnapshot["segments"][number];
    const run = unit(sub(seg.polyline.at(-1)!, seg.polyline[0]!));
    const land = run && outlineOf(seg, t.point, run, rollOf(seg));
    if (land)
      shapes.outlines.push({ outline: land, ink: "inferred", finding: t.id, elementId: t.segment });
    shapes.bars.push(edgeFor(t.id, Number(t.a.split(":")[0]), [from.center, t.point]));
  }
  // A capped end of an element a drawn finding names is drawn amber, as the illustrations do.
  for (const cap of caps) if (named.has(cap.owner)) capOutline(cap, named.get(cap.owner)!);

  for (const group of healPlan(snapshot, work).groups)
    for (const item of group.items) {
      if (!item.covers.some((id) => shown.has(id))) continue;
      const at = end(item.end);
      const face = at && faceOf(at.e, at.c);
      if (!face) continue;
      const n = face.normal;
      const other = item.other ? end(item.other) : null;
      // A cap adds its own thickness; a union or an extend adds the gap to the partner end.
      const span =
        item.how === "cap"
          ? CAP_THICKNESS_IN / 12
          : other
            ? Math.abs(dot(sub(other.c.point, face.center), n))
            : 0;
      if (span <= 0) continue;
      shapes.boxes.push({
        finding: item.covers.find((id) => shown.has(id))!,
        elementId: at!.e.id,
        shape: face.round ? "cylinder" : "box",
        center: add(face.center, n, span / 2),
        axes: [face.x, face.y, n],
        half: [face.w, face.h, span / 2],
      });
    }
  return shapes;
}

/** Line marks over pairs of points, drawn over the meshes: a finding is never hidden inside a duct.
 * Dash sizes are feet: a 0.7 in dash reads across a half-inch near miss and a 2 in stub gap. */
function lines(edges: readonly Edge[], ink: Ink, dashed: boolean) {
  const color = ink === "missed" ? inkOf(INK.missed) : new THREE.Color(INK[ink]);
  return markLines(edges, color, {
    dash: dashed ? { size: ink === "missed" ? 0.015 : 0.06, gap: 0.04 } : undefined,
  });
}

/** The drawing as `Layer3D`s; each key carries a hash of its geometry so an unchanged one is not rebuilt. */
export function findingLayers(shapes: FindingShapes, issues?: readonly StageIssue[]): Layer3D[] {
  const parts = [
    ...shapes.outlines,
    ...shapes.bars,
    ...shapes.missedBars,
    ...shapes.overhang,
    ...shapes.boxes,
  ];
  const owners = new Map(parts.map((part) => [`${part.finding}/${part.elementId}`, part]));
  return [...owners.values()].flatMap(({ finding, elementId }) => {
    const issue = issues?.find((i) => i.findings.includes(finding));
    const belongs = (part: { finding: string; elementId: number }) =>
      part.finding === finding && part.elementId === elementId;
    const own: FindingShapes = {
      outlines: shapes.outlines.filter(belongs),
      bars: shapes.bars.filter(belongs),
      missedBars: shapes.missedBars.filter(belongs),
      overhang: shapes.overhang.filter(belongs),
      boxes: shapes.boxes.filter(belongs),
    };
    return geometryLayers(own).map((layer) => ({
      ...layer,
      frame: markFrame,
      key: `${layer.key}:${finding}:${elementId}`,
      findings: [finding],
      targets: issue ? [{ key: issue.key, elementId }] : [],
    }));
  });
}

function geometryLayers(shapes: FindingShapes): Layer3D[] {
  const out: Layer3D[] = [];
  const key = (name: string, geometry: unknown) => {
    let h = 0;
    for (const c of JSON.stringify(geometry)) h = (h * 31 + c.charCodeAt(0)) | 0;
    return `finding:${name}:${h}`;
  };
  for (const ink of ["open", "cap", "inferred", "missed"] as const) {
    const edges = shapes.outlines.filter((o) => o.ink === ink).flatMap((o) => edgesOf(o.outline));
    if (edges.length)
      out.push({
        key: key(ink, edges),
        build: (group) => void group.add(lines(edges, ink, false)),
      });
  }
  if (shapes.bars.length)
    out.push({
      key: key("bars", shapes.bars),
      build: (group) => void group.add(lines(shapes.bars, "inferred", true)),
    });
  if (shapes.missedBars.length)
    out.push({
      key: key("missed-bars", shapes.missedBars),
      build: (group) => void group.add(lines(shapes.missedBars, "missed", true)),
    });
  if (shapes.overhang.length)
    out.push({
      key: key("overhang", shapes.overhang),
      build: (group) => void group.add(lines(shapes.overhang, "overhang", false)),
    });
  if (shapes.boxes.length)
    out.push({
      key: key("heal", shapes.boxes),
      build(group) {
        for (const b of shapes.boxes) {
          // A cylinder's axis is Y in three; turn it onto Z so the basis (x, y, normal) carries it.
          const geometry =
            b.shape === "cylinder"
              ? new THREE.CylinderGeometry(b.half[0], b.half[0], b.half[2] * 2, 32).rotateX(
                  Math.PI / 2,
                )
              : new THREE.BoxGeometry(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2);
          const volume = markVolume(geometry, new THREE.Color(INK.cap));
          const [x, y, z] = b.axes.map((a) => new THREE.Vector3(a[0], a[1], a[2]));
          volume.setRotationFromMatrix(new THREE.Matrix4().makeBasis(x!, y!, z!));
          volume.position.set(b.center[0]!, b.center[1]!, b.center[2]!);
          group.add(volume);
        }
      },
    });
  return out;
}

/** Half the arms of the cross a fitting or terminal with no run draws, in feet. */
const CROSS = 0.25;

/** Branches no fan-to-terminal run reaches: a heavy line along each duct's centreline and a cross
 * at each fitting or terminal, one layer per element so each answers its own issue row (the row
 * naming the reason's element first, as the inbox orders it). */
export function noRunLayers(
  noRuns: ReadonlyMap<number, NoRunBranch>,
  snapshot: DuctSnapshot,
  issues: readonly StageIssue[],
): Layer3D[] {
  if (!noRuns.size) return [];
  // Resolved on first build (the DOM's), once for every element.
  let color: THREE.Color | undefined;
  const segments = new Map(snapshot.segments.map((s) => [s.id, s.polyline]));
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n.point]));
  return [...noRuns].flatMap(([id, branch]): Layer3D[] => {
    const line = segments.get(id);
    const point = nodes.get(id);
    const edges: Edge[] = line
      ? line.slice(1).map((q, i) => [line[i]!, q])
      : point
        ? [0, 1, 2].map((axis) => [
            point.map((v, k) => (k === axis ? v - CROSS : v)),
            point.map((v, k) => (k === axis ? v + CROSS : v)),
          ])
        : [];
    if (!edges.length) return [];
    const ats = branch.reasons.map((r) => r.at);
    const touching = (ids: readonly number[]) =>
      issues.filter((issue) => issue.ids.some((x) => ids.includes(x)));
    const primary = issueAt(issues, ats) ?? issueAt(issues, branch.elements);
    const rows = [...new Set([primary, ...touching(ats), ...touching(branch.elements)])];
    const targets = rows.flatMap((row) => (row ? [{ key: row.key, elementId: id }] : []));
    return [
      {
        key: `no-run:${id}:${targets.map((t) => t.key).join(",")}`,
        targets,
        findings: [],
        build: (group) =>
          void group.add(markLines(edges, (color ??= inkOf("viz-3")), { weight: 1.8 })),
        frame: markFrame,
      },
    ];
  });
}
