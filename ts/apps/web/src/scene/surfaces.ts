import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { paintOf, SYSTEM_LIGHTNESS, type Look } from "./grounds";
import { withLightness } from "./oklch";
import type { Paint, PaintOf, SceneInstance, SceneMeshes } from "./types";

/** Stable in natural system order, independent of opening order: the first system takes rung 0,
 * the most legible. Stubs inherit an opened system's rung but never change the opened systems'. */
export function systemPaint(meshes: SceneMeshes, base: PaintOf): PaintOf {
  const paints = new Map(meshes.instances.map((i) => [i.key, paintOf(i, base)]));
  const classes = new Map<string, Set<string>>();
  const colourClass = (p: Paint) => p.kind;
  for (const p of paints.values()) {
    const key = colourClass(p);
    if (p.tier !== "subject" || !p.key || key === undefined) continue;
    const names = classes.get(key) ?? new Set<string>();
    names.add(p.key);
    classes.set(key, names);
  }
  const variants = new Map<string, Map<string, number>>();
  for (const [key, names] of classes)
    variants.set(
      key,
      new Map(
        [...names]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((name, n) => [name, n]),
      ),
    );
  return (i) => {
    const p = paints.get(i.key) ?? paintOf(i, base);
    const variant = variants.get(colourClass(p) ?? "")?.get(p.key ?? "");
    return variant !== undefined && p.tier !== "context" && p.tier !== "envelope"
      ? { ...p, variant }
      : p;
  };
}

/** The paint's rung is a fixed OKLCH lightness for the theme, so a third system never drifts
 * toward white and no running step exists. Past the last rung systems share it. A kind's base
 * `l` (clamped to the rung band) replaces rung 0 and keeps the rung spacing above it. */
export function routeColour(colour: THREE.Color, paint: Paint, dark: boolean, baseL?: number) {
  const rungs = SYSTEM_LIGHTNESS[dark ? "dark" : "light"];
  const lo = Math.min(...rungs),
    hi = Math.max(...rungs);
  const rung = paint.variant === undefined ? undefined : Math.min(paint.variant, rungs.length - 1);
  if (baseL === undefined)
    return rung === undefined ? colour.clone() : withLightness(colour, rungs[rung]!);
  const l = baseL + (rung === undefined ? 0 : rungs[rung]! - rungs[0]!);
  return withLightness(colour, Math.min(hi, Math.max(lo, l)));
}

/** Batch alpha encodes the pass: zero context, negative stub, >1 envelope, else subject. */
export function surfaceAlpha(paint: Paint, look: Look) {
  if (paint.tier === "context") return 0;
  if (paint.tier === "envelope") return 1 + look.shell.opacity;
  return paint.tier === "stub"
    ? -Math.min(look.subject.stubOpacity, look.subject.opacity)
    : look.subject.opacity;
}

/** Cache only admitted envelopes/routes, never crease-expand the surrounding building. */
export function surfaceEdges(
  meshes: SceneMeshes,
  allocated: (buffers: ArrayBufferLike[]) => void = () => {},
) {
  const cache = new Map<SceneInstance, { angle: number; positions: Float32Array }>();
  return (instance: SceneInstance, angle: number) => {
    const hit = cache.get(instance);
    if (hit?.angle === angle) return hit.positions;
    const geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(
        meshes.positions.slice(
          instance.firstVertex * 3,
          (instance.firstVertex + instance.vertexCount) * 3,
        ),
        3,
      ),
    );
    const edges = new THREE.EdgesGeometry(geometry, angle);
    const positions = new Float32Array(edges.getAttribute("position").array);
    edges.dispose();
    geometry.dispose();
    cache.set(instance, { angle, positions });
    allocated([...cache.values()].map((entry) => entry.positions.buffer));
    return positions;
  };
}

/** Hidden creases are dashed and depth-tested against real subject faces. Context owns no depth. */
export function routeLines(positions: number[], color: THREE.Color, look: Look, hidden: boolean) {
  const line = new LineSegments2(
    new LineSegmentsGeometry().setPositions(positions),
    new LineMaterial({
      color,
      linewidth: hidden ? look.routes.hiddenWidth : look.routes.edgeWidth,
      opacity: hidden ? look.routes.hiddenOpacity : look.routes.edgeOpacity,
      transparent: true,
      depthWrite: false,
      depthFunc: hidden ? THREE.GreaterDepth : THREE.LessEqualDepth,
      dashed: hidden,
      dashSize: look.routes.dashFt,
      gapSize: look.routes.gapFt,
      fog: false,
    }),
  );
  line.computeLineDistances();
  line.renderOrder = 2;
  return line;
}

/** One outline draw, irrespective of the number of equipment instances. */
export function shellLines(positions: number[], color: THREE.Color, look: Look) {
  const line = new LineSegments2(
    new LineSegmentsGeometry().setPositions(positions),
    new LineMaterial({
      color,
      linewidth: look.shell.edgeWidth,
      opacity: look.shell.edgeOpacity,
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  // Duct faces must write depth before an equipment edge is tested against them.
  line.renderOrder = 2;
  return line;
}
