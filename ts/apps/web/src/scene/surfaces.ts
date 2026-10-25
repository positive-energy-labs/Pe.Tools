import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { paintOf, type Look } from "./grounds";
import type { Paint, PaintOf, SceneInstance, SceneMeshes } from "./types";

/** Stable in natural system order, independent of opening order. Stubs inherit an opened
 * system's variant but never change the opened systems' colour assignments. */
export function systemPaint(meshes: SceneMeshes, base: PaintOf): PaintOf {
  const paints = new Map(meshes.instances.map((i) => [i.key, paintOf(i, base)]));
  const classes = new Map<string, Set<string>>();
  const colourClass = (p: Paint) => p.ink ?? p.key;
  for (const p of paints.values()) {
    const key = colourClass(p);
    if (p.tier !== "subject" || p.surface === "shell" || !p.system || key === undefined) continue;
    const names = classes.get(key) ?? new Set<string>();
    names.add(p.system);
    classes.set(key, names);
  }
  const variants = new Map<string, Map<string, number>>();
  for (const [key, names] of classes)
    variants.set(
      key,
      new Map(
        [...names]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((name, n) => [name, n % 2 ? -(n + 1) / 2 : n / 2]),
      ),
    );
  return (i) => {
    const p = paints.get(i.key) ?? paintOf(i, base);
    const variant = variants.get(colourClass(p) ?? "")?.get(p.system ?? "");
    return variant && p.tier !== "context" && p.surface !== "shell" ? { ...p, variant } : p;
  };
}

/** Approach black/white proportionally, so another same-type system never clamps away its hue. */
export function routeColour(colour: THREE.Color, paint: Paint, look: Look) {
  const variant = paint.variant ?? 0;
  if (!variant) return colour.clone();
  const hsl = colour.getHSL({ h: 0, s: 0, l: 0 });
  const factor = (1 - look.routes.lightnessStep) ** Math.abs(variant);
  const lightness = variant < 0 ? hsl.l * factor : 1 - (1 - hsl.l) * factor;
  return colour.clone().setHSL(hsl.h, hsl.s, lightness);
}

/** Batch alpha encodes the pass: zero context, negative stub, >1 envelope, else subject. */
export function surfaceAlpha(paint: Paint, look: Look) {
  if (paint.tier === "context") return 0;
  if (paint.surface === "shell") return 1 + look.shell.opacity;
  const ceiling = look.depth.everythingTranslucent ? look.depth.translucentOpacity : 1;
  return paint.tier === "stub"
    ? -Math.min(look.subject.stubOpacity, ceiling)
    : look.depth.everythingTranslucent
      ? ceiling
      : look.subject.opacity;
}

/** Cache only admitted envelopes/routes, never crease-expand the surrounding building. */
export function surfaceEdges(meshes: SceneMeshes) {
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
  return new LineSegments2(
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
}
