/**
 * The picture's findings in 3D, the way the tutorial illustrations draw them (docs-cases): an
 * orange ring on an open end, an amber outline on a capped end, a red dashed bar across the gap of
 * a join Pe infers with both end faces outlined and the overhung edges bright red, a bar from each
 * tapping end to its landing, and an amber translucent box where a heal adds a piece or a cap.
 * Only the findings the picture already annotates (`annotated`, the same ids the 2D pins use) are
 * drawn. The face maths is `ducts-domain/faces` over the grader's own `sectionOf`, so what is
 * painted as overhung is what the proximity rule measured. Points are model feet.
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
} from "@pe/ducts-domain/proximity";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Layer3D } from "#/scene/types";

/** The illustrations' inks (the duct cases page): inferred red, open end orange, cap and heal amber. */
const INK = { inferred: 0xd32f2f, overhang: 0xff1744, open: 0xe07a00, cap: 0xd9a400 } as const;
type Ink = keyof typeof INK;

type Element = DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number];
type Connector = Element["connectors"][number];

/** An oriented box or cylinder: unit axes and half sizes along each (a cylinder's third axis is its run, the first two its radius). */
export interface OrientedBox {
  shape: "box" | "cylinder";
  center: number[];
  axes: [number[], number[], number[]];
  half: [number, number, number];
}
export interface FindingShapes {
  outlines: { outline: Outline; ink: Ink }[];
  /** Dashed bars: the gap of a join, or a tapping end to its landing. */
  bars: Edge[];
  overhang: Edge[];
  /** What a heal adds. */
  boxes: OrientedBox[];
}

const sub = (p: number[], q: number[]) => p.map((v, k) => v - q[k]!);
const add = (p: number[], q: number[], by = 1) => p.map((v, k) => v + q[k]! * by);
const dot = (p: number[], q: number[]) => p.reduce((s, v, k) => s + v * q[k]!, 0);
const unit = (p: number[]) => {
  const n = Math.hypot(...p);
  return n < 1e-9 ? null : p.map((v) => v / n);
};

export function findingShapes(
  snapshot: DuctSnapshot,
  annotated: ReadonlySet<string>,
  work: DuctsRouteDocument | null,
): FindingShapes {
  const shapes: FindingShapes = { outlines: [], bars: [], overhang: [], boxes: [] };
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
  const outline = (k: string, ink: Ink) => {
    const at = end(k);
    const o = at && faceOf(at.e, at.c);
    if (o && !drawn.has(`${ink}:${k}`)) {
      drawn.add(`${ink}:${k}`);
      shapes.outlines.push({ outline: o, ink });
    }
    return o;
  };
  const caps = capFacesOf(snapshot);
  const named = new Set<number>();
  const capOutline = (cap: (typeof caps)[number]) => {
    const key = `cap:${cap.owner}:${cap.at}`;
    if (drawn.has(key)) return;
    drawn.add(key);
    const o = outlineOf(cap.segment, cap.origin, cap.normal, rollOf(cap.segment));
    if (o) shapes.outlines.push({ outline: o, ink: "cap" });
  };

  for (const issue of snapshot.issues)
    if (issue.kind === "open-end" && issue.elementId != null && annotated.has(issue.id)) {
      outline(`${issue.elementId}:${issue.id.split(":").at(-1)}`, "open");
      named.add(issue.elementId);
    }

  const inference = inferJoints(snapshot, 1, work);
  for (const j of inference.joints) {
    if (!annotated.has(j.id)) continue;
    const [a, b] = [outline(j.a, "inferred"), outline(j.b, "inferred")];
    if (!a || !b) continue;
    shapes.bars.push([a.center, b.center]);
    shapes.overhang.push(...overhang(a, b), ...overhang(b, a));
    named.add(Number(j.a.split(":")[0])).add(Number(j.b.split(":")[0]));
  }
  for (const t of inference.taps) {
    if (!annotated.has(t.id)) continue;
    const from = outline(t.a, "inferred");
    if (!from) continue;
    named.add(Number(t.a.split(":")[0]));
    // Landing on a capped end is the cap's face; on a side, the duct's section at the landing.
    const cap = caps.find(
      (c) => c.owner === t.segment && Math.hypot(...sub(c.end, t.point)) < 0.01,
    );
    if (cap) {
      capOutline(cap);
      shapes.bars.push([from.center, cap.origin]);
      continue;
    }
    const seg = elements.get(t.segment) as DuctSnapshot["segments"][number];
    const run = unit(sub(seg.polyline.at(-1)!, seg.polyline[0]!));
    const land = run && outlineOf(seg, t.point, run, rollOf(seg));
    if (land) shapes.outlines.push({ outline: land, ink: "inferred" });
    shapes.bars.push([from.center, t.point]);
  }
  // A capped end of an element a drawn finding names is drawn amber, as the illustrations do.
  for (const cap of caps) if (named.has(cap.owner)) capOutline(cap);

  for (const group of healPlan(snapshot, work).groups)
    for (const item of group.items) {
      if (!item.covers.some((id) => annotated.has(id))) continue;
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
        shape: face.round ? "cylinder" : "box",
        center: add(face.center, n, span / 2),
        axes: [face.x, face.y, n],
        half: [face.w, face.h, span / 2],
      });
    }
  return shapes;
}

/** Line segments over pairs of points, drawn over the meshes: a finding is never hidden inside a duct. */
function lines(edges: readonly Edge[], ink: Ink, dashed: boolean) {
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(edges.flatMap(([p, q]) => [...p, ...q])), 3),
  );
  const color = new THREE.Color(INK[ink]);
  // Dash sizes are feet: a 0.7 in dash reads across a half-inch near miss and a 2 in stub gap.
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.06, gapSize: 0.04, depthTest: false })
    : new THREE.LineBasicMaterial({ color, depthTest: false });
  const segments = new THREE.LineSegments(geometry, material);
  segments.renderOrder = 10;
  if (dashed) segments.computeLineDistances();
  return segments;
}

/** The drawing as `Layer3D`s; each key carries a hash of its geometry so an unchanged one is not rebuilt. */
export function findingLayers(shapes: FindingShapes): Layer3D[] {
  const out: Layer3D[] = [];
  const key = (name: string, geometry: unknown) => {
    let h = 0;
    for (const c of JSON.stringify(geometry)) h = (h * 31 + c.charCodeAt(0)) | 0;
    return `finding:${name}:${h}`;
  };
  for (const ink of ["open", "cap", "inferred"] as const) {
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
          const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              color: INK.cap,
              transparent: true,
              opacity: 0.35,
              depthWrite: false,
            }),
          );
          const [x, y, z] = b.axes.map((a) => new THREE.Vector3(a[0], a[1], a[2]));
          mesh.setRotationFromMatrix(new THREE.Matrix4().makeBasis(x!, y!, z!));
          mesh.position.set(b.center[0]!, b.center[1]!, b.center[2]!);
          mesh.renderOrder = 9;
          group.add(mesh);
        }
      },
    });
  return out;
}
