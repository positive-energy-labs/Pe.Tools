/** Widths are CSS px: the renderer sets LineMaterial.resolution from the canvas size. */
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { IssueState, LayerFrame } from "./types";
import { BLACK, isLit, LOOK, markAlpha, WHITE } from "./grounds";

type Edge = readonly [readonly number[], readonly number[]];

const WIDTH: Record<IssueState, number> = { rest: 1.75, reach: 2.75, hover: 3.5, focus: 4 };
const LIFT: Record<IssueState, number> = { rest: 0, reach: 0.18, hover: 0.38, focus: 0.3 };
const CASING = 1.5;
/** Every landing on the stage shares this duration, in seconds. */
const LAND = 0.65;

export const landing = (landed: number) => (landed < LAND ? (1 - landed / LAND) ** 3 : 0);

/** Every mark obeys subject depth. A lit mark (hover, focus or selection) also draws its occluded
 * part faint and thin, so it reads as behind and stays findable; reach/rest marks are simply
 * hidden behind a duct. Dash sizes are feet; weight scales pixel width. */
export function markLines(
  edges: readonly Edge[],
  color: THREE.Color,
  { dash, weight = 1 }: { dash?: { size: number; gap: number }; weight?: number } = {},
): THREE.Group {
  const geometry = new LineSegmentsGeometry().setPositions(edges.flatMap(([p, q]) => [...p, ...q]));
  const ink = new LineSegments2(
    geometry,
    new LineMaterial({
      color,
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  const casing = new LineSegments2(geometry, ink.material.clone());
  // Semantic lines remain individually pickable; the renderer batches their visible strokes.
  ink.userData.markStroke = casing.userData.markStroke = true;
  casing.material.color.copy(BLACK);
  casing.userData.casing = true;
  casing.renderOrder = 9;
  if (dash) {
    Object.assign(ink.material, { dashed: true, dashSize: dash.size, gapSize: dash.gap });
    ink.computeLineDistances();
  }
  ink.userData.rest = color.clone();
  ink.renderOrder = 10;
  // The occluded part of a lit mark: same hue, thinner and faint, only where real subject depth
  // is in front (`LOOK.depth.occluded*`). Transparent (opacity 0) at rest; the batch skips it.
  const behind = new LineSegments2(geometry, ink.material.clone());
  behind.material.depthFunc = THREE.GreaterDepth;
  behind.material.opacity = 0;
  behind.userData.markStroke = behind.userData.behind = true;
  behind.userData.rest = ink.userData.rest;
  behind.renderOrder = 10;
  const group = new THREE.Group();
  group.add(casing, ink, behind);
  group.userData.weight = weight;
  markFrame(group, { seconds: 0, reducedMotion: true, state: "rest", landed: Infinity });
  return group;
}

export function markVolume(
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
  // A ghost is a proposal not yet consented: dashed edges and a fainter body than a solid volume.
  { ghost = false }: { ghost?: boolean } = {},
): THREE.Group {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 9;
  mesh.userData.ghost = ghost;
  const position = new THREE.EdgesGeometry(geometry, 30).getAttribute("position");
  const edges: Edge[] = [];
  for (let i = 0; i < position.count; i += 2)
    edges.push([
      [position.getX(i), position.getY(i), position.getZ(i)],
      [position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)],
    ]);
  const group = new THREE.Group();
  group.add(mesh, markLines(edges, color, ghost ? { dash: { size: 0.1, gap: 0.06 } } : {}));
  return group;
}

export function markFrame(group: THREE.Object3D, at: LayerFrame): boolean {
  const swell = at.reducedMotion ? 0 : landing(at.landed);
  const [casingAlpha, volumeAlpha] = markAlpha(at.state, at.look);
  const { depth } = at.look ?? LOOK.read();
  const lit = isLit(at);
  group.traverse((object) => {
    if (object instanceof LineSegments2) {
      const material = object.material as LineMaterial;
      const width = WIDTH[at.state] * (object.parent?.userData.weight ?? 1) + swell * 5;
      if (object.userData.casing) {
        material.linewidth = width + CASING * 2;
        material.opacity = casingAlpha;
      } else if (object.userData.behind) {
        material.linewidth = width * depth.occludedWidth;
        material.opacity = lit ? depth.occludedAlpha : 0;
        material.color.copy(object.userData.rest).lerp(WHITE, LIFT[at.state]);
      } else {
        material.linewidth = width;
        material.color.copy(object.userData.rest).lerp(WHITE, LIFT[at.state] + swell * 0.4);
      }
    } else if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial)
      object.material.opacity = (volumeAlpha + swell * 0.3) * (object.userData.ghost ? 0.45 : 1);
  });
  return swell > 0;
}
