/**
 * Strands: ordered paths drawn over the picture's centrelines (a terminal run, a home run). Where
 * strands share an element they ride side by side in screen-space lanes (px, perpendicular to the
 * projected line), so a bundle keeps its width at any camera angle. The heavy strand and any
 * hovered or selected one move a dash in flow direction; the rest hold still.
 *
 * Strand lines stay out of the mark batch (no `markStroke`): each strand owns its materials, so a
 * moving dash is one `dashOffset` uniform write per frame, never a batch re-bucket.
 */
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { damageColors } from "./damage";
import { BLACK, LOOK, markAlpha, WHITE } from "./grounds";
import type { IssueState, Layer3D, LayerFrame } from "./types";

type Point = readonly number[];
/** Structurally the picture's `PictureStrand`; kept here so the core needs no picture import. */
export type Strand = { key: SubjectKey; path: readonly SubjectKey[]; heavy?: boolean };
/** One element of a strand, its points oriented in flow order. */
export type Link = { element: SubjectKey; points: readonly Point[]; reversed: boolean };
/** A drawn piece of a strand: one element's, with its lane offset (px) at each end. */
export type Segment = {
  from: Point;
  to: Point;
  element: SubjectKey;
  lane: readonly [number, number];
};

const WIDTH: Record<IssueState, number> = { rest: 2, reach: 2.5, hover: 3, focus: 3 };
const HEAVY = 1.75;
const CASING = 1;
/** A lane's pitch (px): its widest stroke plus its casing, so hovered neighbours never overlap. */
const pitchOf = (heavy: boolean | undefined) => WIDTH.focus * (heavy ? HEAVY : 1) + 2 * CASING;
/** One dash period crosses this many seconds. */
const FLOW_SECONDS = 0.9;

const dist = (a: Point, b: Point) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** A path's elements with points, each oriented to continue the previous one (path order is
 * flow). An element without a centreline is skipped; the chain bridges the gap. */
export function chain(
  path: readonly SubjectKey[],
  pointsOf: (key: SubjectKey) => readonly Point[] | undefined,
): Link[] {
  const present = path.flatMap((element) => {
    const points = pointsOf(element);
    return points?.length ? [{ element, points }] : [];
  });
  const out: Link[] = [];
  present.forEach(({ element, points }, i) => {
    const first = points[0]!,
      last = points.at(-1)!;
    const prev = out.at(-1)?.points.at(-1);
    const next = present[i + 1]?.points;
    const near = (p: Point, q: readonly Point[]) => Math.min(dist(p, q[0]!), dist(p, q.at(-1)!));
    const reversed = prev
      ? dist(last, prev) < dist(first, prev)
      : !!next && near(first, next) < near(last, next);
    out.push({ element, points: reversed ? [...points].reverse() : points, reversed });
  });
  return out;
}

/** Each strand's signed lane offset (px) on every element it passes, right of its own travel.
 * Lanes order by strand order, so two strands never swap along a shared stretch; an element's
 * canonical direction is its first strand's, so a strand crossing it the other way keeps its
 * side. The bundle is centred on the centreline and the heavy lane is wider.
 * ponytail: strand order can cross two strands where they split to opposite sides; ordering lanes
 * by branch side at each split is the upgrade. */
export function lanes(
  strands: readonly Pick<Strand, "heavy">[],
  chains: readonly (readonly Link[])[],
): Map<SubjectKey, number>[] {
  const through = new Map<SubjectKey, { strand: number; reversed: boolean }[]>();
  chains.forEach((links, strand) => {
    for (const { element, reversed } of links) {
      const held = through.get(element) ?? [];
      if (!held.some((h) => h.strand === strand)) held.push({ strand, reversed });
      through.set(element, held);
    }
  });
  const out = chains.map(() => new Map<SubjectKey, number>());
  for (const [element, held] of through) {
    const pitches = held.map((h) => pitchOf(strands[h.strand]?.heavy));
    let at = -pitches.reduce((sum, p) => sum + p, 0) / 2;
    const canonical = held[0]!.reversed;
    held.forEach((h, i) => {
      const centre = at + pitches[i]! / 2;
      at += pitches[i]!;
      out[h.strand]!.set(element, h.reversed === canonical ? centre : -centre);
    });
  }
  return out;
}

/** A chain as drawn segments in flow order. A gap between elements (a fitting's one point) splits
 * at its midpoint, each half its element's, with the lane ramping across it. */
export function segments(links: readonly Link[], laneOf: ReadonlyMap<SubjectKey, number>) {
  const out: Segment[] = [];
  const push = (from: Point, to: Point, element: SubjectKey, a: number, b: number) => {
    if (dist(from, to) > 1e-9) out.push({ from, to, element, lane: [a, b] });
  };
  links.forEach((link, i) => {
    const lane = laneOf.get(link.element) ?? 0;
    const prev = links[i - 1];
    if (prev) {
      const a = prev.points.at(-1)!,
        b = link.points[0]!;
      const mid = a.map((v, k) => (v + b[k]!) / 2);
      const before = laneOf.get(prev.element) ?? 0,
        half = (before + lane) / 2;
      push(a, mid, prev.element, before, half);
      push(mid, b, link.element, half, lane);
    }
    for (let k = 1; k < link.points.length; k++)
      push(link.points[k - 1]!, link.points[k]!, link.element, lane, lane);
  });
  return out;
}

/** LineMaterial plus a per-segment screen-space lane shift and the alarm ink on over segments.
 * The lane is perpendicular to the projected segment; each end also extends by |lane| along it,
 * closing the outer corner a shifted bend would open (exact to 90°). */
function laneMaterial(params: THREE.ShaderMaterialParameters & Record<string, unknown>) {
  const material = new LineMaterial({ transparent: true, depthWrite: false, fog: true, ...params });
  const overColor = { value: new THREE.Color() };
  material.userData.overColor = overColor.value;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.overColor = overColor;
    shader.vertexShader =
      `attribute vec2 instanceLane;\nattribute float instanceOver;\nvarying float vOver;\n${shader.vertexShader}`.replace(
        "clip.xy += offset;",
        `float lane = ( position.y < 0.5 ) ? instanceLane.x : instanceLane.y;
      vec2 laneShift = vec2( dir.y / aspect, - dir.x * aspect ) * lane
        + dir * abs( lane ) * ( position.y < 0.5 ? - 1.0 : 1.0 );
      clip.xy += laneShift * 2.0 / resolution.y * clip.w;
      clip.xy += offset;
      vOver = instanceOver;`,
      );
    shader.fragmentShader =
      `uniform vec3 overColor;\nvarying float vOver;\n${shader.fragmentShader}`.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, overColor, vOver );",
      );
  };
  material.customProgramCacheKey = () => "strand-lanes-v1";
  return material;
}

const ray = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const start = new THREE.Vector3();
const end = new THREE.Vector3();
/** Picks against the drawn lanes, not the shared centreline: strands bundled on one element all
 * meet the ray at one depth, so the nearer lane on screen breaks the tie (1e-4 of depth per px).
 * ponytail: no near-plane trim; a segment crossing the camera plane is not pickable. */
export function laneRaycast(
  this: LineSegments2,
  raycaster: THREE.Raycaster,
  hits: THREE.Intersection[],
) {
  const camera = raycaster.camera;
  if (!camera) return;
  const { resolution, linewidth } = this.material;
  const half = linewidth / 2 + (raycaster.params.Line2?.threshold ?? 0);
  const w = resolution.x / 2,
    h = resolution.y / 2;
  raycaster.ray.at(1, ray).project(camera);
  const px = ray.x * w,
    py = ray.y * h;
  const geometry = this.geometry;
  const from = geometry.getAttribute("instanceStart");
  const to = geometry.getAttribute("instanceEnd");
  const lane = geometry.getAttribute("instanceLane");
  for (let i = 0; i < from.count; i++) {
    start.fromBufferAttribute(from, i).applyMatrix4(this.matrixWorld);
    end.fromBufferAttribute(to, i).applyMatrix4(this.matrixWorld);
    a.copy(start).project(camera);
    b.copy(end).project(camera);
    if (Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue;
    let dx = (b.x - a.x) * w,
      dy = (b.y - a.y) * h;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    dx /= length;
    dy /= length;
    const la = lane?.getX(i) ?? 0,
      lb = lane?.getY(i) ?? 0;
    const ax = a.x * w + dy * la,
      ay = a.y * h - dx * la;
    const bx = b.x * w + dy * lb,
      by = b.y * h - dx * lb;
    const ex = bx - ax,
      ey = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
    const off = Math.hypot(px - ax - t * ex, py - ay - t * ey);
    if (off > half) continue;
    const point = start.clone().lerp(end, t);
    hits.push({
      point,
      distance: raycaster.ray.origin.distanceTo(point) * (1 + off * 1e-4),
      object: this,
      faceIndex: i,
    });
  }
}

const noRaycast = () => {};
const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** One layer per strand: casing, ink and its occluded twin (strands live inside their ducts, so
 * the twin is always drawn), plus a dashed flow stroke on top while it flows. `over` element
 * segments take the one alarm ink (`damageColors.core`, the scene's damage hue). Each target is
 * the strand's own subject, so a pick selects `run:<id>` and a hover lights it. */
export function strandLayers(
  strands: readonly Strand[],
  lines: readonly { key: SubjectKey; points: readonly Point[] }[],
  over: ReadonlySet<SubjectKey>,
): Layer3D[] {
  const byKey = new Map(lines.map((line) => [line.key, line.points]));
  const chains = strands.map((strand) => chain(strand.path, (key) => byKey.get(key)));
  const laneOf = lanes(strands, chains);
  const drawn = chains.map((links, i) => segments(links, laneOf[i]!));
  const box = new THREE.Box3();
  for (const s of drawn.flat())
    box.expandByPoint(a.fromArray(s.from)).expandByPoint(b.fromArray(s.to));
  // ponytail: dashes are feet scaled to the strands' extent (house dash rule); a pixel dash needs
  // a cumulative screen length the shader does not have.
  const dash = Math.max(0.05, (box.isEmpty() ? 0 : box.getSize(a).length()) / 90);
  const period = dash * 2.2;
  return strands.flatMap((strand, i): Layer3D[] => {
    const parts = drawn[i]!;
    if (!parts.length) return [];
    const weight = strand.heavy ? HEAVY : 1;
    const elementId = Number(strand.path[0]?.slice(2));
    return [
      {
        key: `strand:${strand.key}`,
        targets: [{ key: strand.key, elementId, subject: true }],
        findings: [],
        build(group) {
          const geometry = new LineSegmentsGeometry().setPositions(
            parts.flatMap((s) => [...s.from, ...s.to]),
          );
          geometry.setAttribute(
            "instanceLane",
            new THREE.InstancedBufferAttribute(new Float32Array(parts.flatMap((s) => s.lane)), 2),
          );
          geometry.setAttribute(
            "instanceOver",
            new THREE.InstancedBufferAttribute(
              new Float32Array(parts.map((s) => (over.has(s.element) ? 1 : 0))),
              1,
            ),
          );
          const casing = new LineSegments2(geometry, laneMaterial({}));
          casing.renderOrder = 9;
          casing.userData.casing = true;
          const ink = new LineSegments2(geometry, laneMaterial({}));
          ink.renderOrder = 10;
          ink.computeLineDistances();
          ink.raycast = laneRaycast;
          const behind = new LineSegments2(
            geometry,
            laneMaterial({ depthFunc: THREE.GreaterDepth }),
          );
          behind.renderOrder = 10;
          behind.userData.behind = true;
          const flow = new LineSegments2(
            geometry,
            laneMaterial({
              dashed: true,
              dashSize: dash,
              gapSize: period - dash,
              depthTest: false,
            }),
          );
          flow.renderOrder = 11;
          flow.userData.flow = true;
          for (const line of [casing, behind, flow]) line.raycast = noRaycast;
          group.add(casing, ink, behind, flow);
          group.userData.weight = weight;
        },
        frame(group, at: LayerFrame) {
          const lit = at.state === "hover" || at.state === "focus";
          const flowing = !!strand.heavy || lit;
          const moving = flowing && !at.reducedMotion;
          const look = at.look ?? LOOK.read();
          const [casingAlpha] = markAlpha(at.state, look);
          const inkColour = at.ink ?? BLACK;
          // The flow dash reads against the ink in either theme: dark ink, light dash; and back.
          const dashColour = luminance(inkColour) > 0.5 ? BLACK : WHITE;
          const width = WIDTH[at.state] * weight;
          for (const object of group.children) {
            if (!(object instanceof LineSegments2)) continue;
            const material = object.material as LineMaterial;
            const overColor = material.userData.overColor as THREE.Color;
            if (object.userData.casing) {
              material.linewidth = width + CASING * 2;
              material.opacity = casingAlpha;
              material.color.copy(BLACK);
              overColor.copy(BLACK);
            } else if (object.userData.flow) {
              object.visible = flowing;
              material.linewidth = width * 0.5;
              material.opacity = 0.9;
              material.color.copy(inkColour).lerp(dashColour, 0.7);
              overColor.copy(damageColors.core).lerp(dashColour, 0.7);
              material.dashOffset = moving ? -(((at.seconds / FLOW_SECONDS) * period) % period) : 0;
            } else {
              material.linewidth = width;
              material.color.copy(inkColour);
              overColor.copy(damageColors.core);
              if (object.userData.behind)
                material.opacity = Math.max(look.depth.occludedAlpha, lit ? 0.85 : 0.6);
            }
          }
          return moving;
        },
      },
    ];
  });
}
