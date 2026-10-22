/**
 * What /space draws over the meshes and how it is inked, in the words the legend and the docs
 * print (ported from the `space-viewer` branch's `model.ts` and `scene.ts`). Each answer layer is
 * one `Layer3D` built from one op answer the page holds; nothing here fetches.
 */
import * as THREE from "three";
import { SPACE_LAYERS } from "@pe/agent-contracts";
import type {
  RevitDetailSpaceProbe,
  RevitDetailSpaceRows,
  RevitDetailSpaceSlice,
  RevitDetailSpaceStatus,
  RevitDetailSpaceSweep,
  RevitDetailSpaceTree,
} from "@pe/host-contracts/generated";
import { tokenRef } from "@pe/kit/lib/token";

import type { Bounds, Layer3D } from "#/scene/types";

export type RowsRes = RevitDetailSpaceRows.Res.Response;
export type StatusRes = RevitDetailSpaceStatus.Res.Response;
export type TreeRes = RevitDetailSpaceTree.Res.Response;
export type SliceReq = RevitDetailSpaceSlice.Req.Request;
export type SliceRes = RevitDetailSpaceSlice.Res.Response;
export type ProbeReq = RevitDetailSpaceProbe.Req.Request;
export type ProbeRes = RevitDetailSpaceProbe.Res.Response;
export type SweepReq = RevitDetailSpaceSweep.Req.Request;
export type SweepRes = RevitDetailSpaceSweep.Res.Response;

/** The picture's layers, in strip order: the contract's `space.layers` field owns the list. */
export { SPACE_LAYERS };
export type SpaceLayer = (typeof SPACE_LAYERS)[number];

export const LAYER_SAYS: Record<SpaceLayer, string> = {
  meshes: "the captured scene's real triangles (PSC1), one batch per element",
  context: "the elements around the requested ones; off shows the requested elements alone",
  cuts: "the three axis cuts' lines and grips; the clip they make holds either way",
  boxes: "one translucent box per PrimRow: the element's Aabb as the partition stored it",
  levels: "one dashed rectangle per Level at its ProjectElevation, over the world bounds",
  tree: "the BVH nodes of one source down to a depth, one hue per depth",
  slice: "Verbs.Slice: every triangle clipped to the z band and flattened, as rings",
  probe: "Verbs.Probe: the ray down and up from a point, marked where it hit",
  sweep: "Verbs.Sweep: an oriented box per segment, inked HIT, NEAR or CLEAR",
};

/** What a row's colour means. One hue per value; `category` cycles six hues over many names and says so. */
export const ENCODINGS = ["source", "kind", "heightRole", "category"] as const;
export type Encoding = (typeof ENCODINGS)[number];

export const ENCODING_SAYS: Record<Encoding, string> = {
  source: "which partition: Host, RevitLink or IfcLink",
  kind: "PrimKind: Solid, Mesh, or a Curve2D ribbon",
  heightRole: "HeightRole: what a RoomHeights probe may read as floor or overhead",
  category: "Revit category, six hues cycled over every name; two categories can share one",
};

/** The partition kind of a source index, as the stamp names it. */
const sourceKind = (rows: RowsRes, source: number) =>
  rows.stamp.sources.find((s) => s.source === source)?.kind ?? String(source);

/** The value of one row under an encoding, as the legend names it. */
export function valueOf(rows: RowsRes, encoding: Encoding, i: number): string {
  switch (encoding) {
    case "source":
      return sourceKind(rows, rows.source[i]!);
    case "kind":
      return rows.kinds[rows.kind[i]!]!;
    case "heightRole":
      return rows.heightRoles[rows.heightRole[i]!]!;
    case "category":
      return rows.categories[rows.category[i]!]!;
  }
}

const FIXED_ROLE: Record<string, string> = {
  Host: "viz-1",
  RevitLink: "viz-2",
  IfcLink: "viz-5",
  Solid: "viz-1",
  Mesh: "viz-3",
  Curve2D: "viz-6",
  None: "ink-mute",
  Floor: "viz-4",
  Overhead: "viz-1",
  "Floor, Overhead": "viz-2",
  ByGeometry: "viz-6",
};

export type Legend = { value: string; role: string; count: number }[];

/** The legend for an encoding: every value the rows hold, its token role, its row count. */
export function legendOf(rows: RowsRes, encoding: Encoding): Legend {
  const counts = new Map<string, number>();
  for (let i = 0; i < rows.elementId.length; i++) {
    const v = valueOf(rows, encoding, i);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.keys()].sort().map((value, index) => ({
    value,
    role: FIXED_ROLE[value] ?? `viz-${(index % 6) + 1}`,
    count: counts.get(value)!,
  }));
}

/** A row as one object, for the facts panel. Index i on every wire array. */
export function rowAt(rows: RowsRes, i: number) {
  return {
    sourceKind: sourceKind(rows, rows.source[i]!),
    source: rows.stamp.sources.find((s) => s.source === rows.source[i]),
    elementId: rows.elementId[i]!,
    category: rows.categories[rows.category[i]!]!,
    kind: rows.kinds[rows.kind[i]!]!,
    layer: rows.layer[i]! >= 0 ? rows.layers[rows.layer[i]!]! : null,
    heightRole: rows.heightRoles[rows.heightRole[i]!]!,
    triangles: rows.triangles[i]!,
    extrusionFt: rows.extrusionFt[i]!,
  };
}

/**
 * A design token as a WebGL colour. Tokens are `light-dark(oklch(), oklch())` strings, which three
 * cannot parse; the page's own style engine resolves them, read back as rgb.
 */
const colours = new Map<string, THREE.Color>();
function tokenColor(role: string): THREE.Color {
  const hit = colours.get(role);
  if (hit) return hit;
  const probe = document.createElement("span");
  probe.style.color = tokenRef(role);
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe)
    .color.match(/[\d.]+/g)
    ?.map(Number) ?? [0, 0, 0];
  probe.remove();
  const colour = new THREE.Color(rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255);
  colours.set(role, colour);
  return colour;
}

/** Twelve edges of an axis-aligned box `[x0, y0, z0, x1, y1, z1]` appended to a flat list. */
function pushBoxEdges(out: number[], b: ArrayLike<number>, at = 0) {
  const [x0, y0, z0, x1, y1, z1] = Array.from({ length: 6 }, (_, k) => b[at + k]!);
  const c = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  for (const i of [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7])
    out.push(...c[i]!);
}

/** Line segments over pairs of points; every layer's geometry is its own (the renderer disposes it). */
function lines(points: number[], colour: THREE.Color, dashed = false) {
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(points), 3),
  );
  const material = dashed
    ? new THREE.LineDashedMaterial({ color: colour, dashSize: 2, gapSize: 1 })
    : new THREE.LineBasicMaterial({ color: colour });
  const segments = new THREE.LineSegments(geometry, material);
  if (dashed) segments.computeLineDistances();
  return segments;
}

/** One translucent instance per row, coloured by the encoding's legend; the picked row outlined. */
export const boxesLayer = (
  rows: RowsRes,
  encoding: Encoding,
  legend: Legend,
  picked: number | null,
): Layer3D => ({
  key: `boxes:${encoding}:${picked}`,
  build(group) {
    const role = new Map(legend.map((entry) => [entry.value, entry.role]));
    const n = rows.elementId.length;
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, n);
    const m = new THREE.Matrix4();
    const b = rows.box;
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      m.makeScale(
        Math.max(b[o + 3]! - b[o]!, 0.05),
        Math.max(b[o + 4]! - b[o + 1]!, 0.05),
        Math.max(b[o + 5]! - b[o + 2]!, 0.05),
      );
      m.setPosition(
        (b[o]! + b[o + 3]!) / 2,
        (b[o + 1]! + b[o + 4]!) / 2,
        (b[o + 2]! + b[o + 5]!) / 2,
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tokenColor(role.get(valueOf(rows, encoding, i)) ?? "ink-mute"));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    if (picked === null || picked >= n) return;
    const outline: number[] = [];
    pushBoxEdges(outline, b, picked * 6);
    group.add(lines(outline, tokenColor("ink")));
  },
});

/** The nearest row box a ray enters (slab test), or null. */
export function rowUnder(rows: RowsRes, origin: number[], direction: number[]): number | null {
  let best: number | null = null,
    nearest = Infinity;
  for (let i = 0; i < rows.elementId.length; i++) {
    let t0 = 0,
      t1 = Infinity;
    for (let d = 0; d < 3 && t0 <= t1; d++) {
      const lo = rows.box[i * 6 + d]!,
        hi = rows.box[i * 6 + d + 3]!;
      if (Math.abs(direction[d]!) < 1e-12) {
        if (origin[d]! < lo || origin[d]! > hi) t0 = Infinity;
        continue;
      }
      const a = (lo - origin[d]!) / direction[d]!,
        c = (hi - origin[d]!) / direction[d]!;
      t0 = Math.max(t0, Math.min(a, c));
      t1 = Math.min(t1, Math.max(a, c));
    }
    if (t0 <= t1 && t0 < nearest) [best, nearest] = [i, t0];
  }
  return best;
}

/** One dashed rectangle per level at its elevation over the world's xy bounds, and the bounds. */
export const levelsLayer = (status: StatusRes, fallback: Bounds): Layer3D => ({
  key: "levels",
  build(group) {
    const b = status.bounds ?? fallback;
    const pts: number[] = [];
    for (const level of status.levels) {
      const z = level.elevationFt;
      const c = [
        [b.minX, b.minY, z],
        [b.maxX, b.minY, z],
        [b.maxX, b.maxY, z],
        [b.minX, b.maxY, z],
      ];
      for (let i = 0; i < 4; i++) pts.push(...c[i]!, ...c[(i + 1) % 4]!);
    }
    group.add(lines(pts, tokenColor("ink-mute"), true));
    const world: number[] = [];
    pushBoxEdges(world, [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ]);
    group.add(lines(world, tokenColor("ink-2")));
  },
});

/** BVH node boxes as edges, one hue per depth so the split order reads. */
export const treeLayer = (tree: TreeRes): Layer3D => ({
  key: "tree",
  build(group) {
    const byDepth = new Map<number, number[]>();
    for (const node of tree.nodes) {
      const list = byDepth.get(node.depth) ?? [];
      pushBoxEdges(list, node.box);
      byDepth.set(node.depth, list);
    }
    for (const [depth, pts] of byDepth) group.add(lines(pts, tokenColor(`viz-${(depth % 6) + 1}`)));
  },
});

/** The band's footprint: each convex piece as a closed ring at the band's top. */
export const sliceLayer = (request: SliceReq, slice: SliceRes): Layer3D => ({
  key: "slice",
  build(group) {
    const z = request.z1;
    const pts: number[] = [];
    for (const element of slice.elements)
      for (const ring of element.pieces) {
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          pts.push(ring[i * 2]!, ring[i * 2 + 1]!, z, ring[j * 2]!, ring[j * 2 + 1]!, z);
        }
      }
    group.add(lines(pts, tokenColor("viz-5")));
  },
});

/** The two rays from a point: a line to each hit, or to the search distance when nothing hit. */
export const probeLayer = (request: ProbeReq, probe: ProbeRes): Layer3D => ({
  key: "probe",
  build(group) {
    const [x, y, z] = [request.at[0]!, request.at[1]!, request.at[2]!];
    const down = probe.floor?.z ?? z - probe.maxDistanceFt;
    const up = probe.ceiling?.z ?? z + probe.maxDistanceFt;
    group.add(lines([x, y, z, x, y, down], tokenColor(probe.floor ? "done" : "caution")));
    group.add(lines([x, y, z, x, y, up], tokenColor(probe.ceiling ? "done" : "caution")));
    const marks: number[] = [];
    const r = 0.5;
    for (const hz of [probe.floor?.z, probe.ceiling?.z])
      if (hz != null) marks.push(x - r, y, hz, x + r, y, hz, x, y - r, hz, x, y + r, hz);
    if (marks.length) group.add(lines(marks, tokenColor("ink")));
  },
});

const VERDICT_ROLE: Record<string, string> = { HIT: "alarm", NEAR: "caution", CLEAR: "done" };

/** The swept profile, one oriented box per segment inked by its verdict, plus its closest point. */
export const sweepLayer = (request: SweepReq, sweep: SweepRes): Layer3D => ({
  key: "sweep",
  build(group) {
    const path = request.polyline;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = new THREE.Vector3(...(path[i] as [number, number, number]));
      const b = new THREE.Vector3(...(path[i + 1] as [number, number, number]));
      const along = b.clone().sub(a);
      const verdict = sweep.segments[i]?.verdict;
      const colour = tokenColor(verdict ? (VERDICT_ROLE[verdict] ?? "ink-mute") : "ink-mute");
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color: colour }),
      );
      box.scale.set(along.length(), request.widthFt, request.heightFt);
      box.position.copy(a).add(b).multiplyScalar(0.5);
      box.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.atan2(along.y, along.x)));
      group.add(box);
      const at = sweep.segments[i]?.closestPoint;
      if (!at) continue;
      const [x, y, z] = [at[0]!, at[1]!, at[2]!];
      const r = 0.35;
      group.add(
        lines(
          [x - r, y, z, x + r, y, z, x, y - r, z, x, y + r, z, x, y, z - r, x, y, z + r],
          colour,
        ),
      );
    }
  },
});
