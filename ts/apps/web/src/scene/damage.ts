import * as THREE from "three";
import { rowDamage } from "@pe/kit/table/model";

/** Plan marks read the same row model as the table. */
export const damageMark = (row: unknown) => ({ "data-damage": rowDamage(row) || undefined });
import { BEACON_LAYER, GLOW_LAYER } from "./glow";
import { landing } from "./marks";
import type {
  IssueState,
  IssueTarget,
  Layer3D,
  LayerFrame,
  SceneInstance,
  SceneMeshes,
} from "./types";

/** The one critical-damage hue: the only saturated colour on the stage, so it never needs a key. */
const CORE = new THREE.Color();
const RIM = new THREE.Color();
const HOT = new THREE.Color();
/** Renderer init resolves the kit alarm token once, in the page's colour space. */
export function setDamageHue(alarm: THREE.Color) {
  CORE.copy(alarm);
  RIM.copy(alarm).lerp(new THREE.Color(1, 1, 1), 0.25);
  HOT.copy(alarm).lerp(new THREE.Color(1, 1, 1), 0.85);
}
/** Seconds per heartbeat. */
const PERIOD = 1.5;

/** A lub-dub: two eased beats then rest, 0..1. Gaussian bumps, so every edge is smooth. */
export function heartbeat(seconds: number) {
  const p = (((seconds % PERIOD) + PERIOD) % PERIOD) / PERIOD;
  const bump = (at: number, width: number) => Math.exp(-(((p - at) / width) ** 2));
  return Math.min(1, bump(0.1, 0.055) + 0.55 * bump(0.27, 0.06));
}

/** Energy per rung: a resting floor that never goes dark, and how much of the beat rides on it. */
const FLOOR: Record<IssueState, number> = { rest: 0.45, reach: 0.65, hover: 1, focus: 1.05 };
const BEAT: Record<IssueState, number> = { rest: 0.55, reach: 0.55, hover: 0.35, focus: 0.35 };
/** Reduced motion holds the beat at this phase. */
const STEADY = 0.5;

/** When each damage first appeared on this page: the hit flash plays once, not per rebuild. */
const born = new Map<string, number>();
/** The hit flash: a bright strike easing out over about half a second. */
const flash = (age: number) => (age >= 0 && age < 0.9 ? Math.exp(-age / 0.16) : 0);

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const fragmentShader = /* glsl */ `
uniform vec3 core;
uniform vec3 rim;
uniform float energy;
uniform float alpha;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  // Fresnel: grazing faces (the silhouette) burn brightest, so the form reads, not a flat decal.
  float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
  vec3 color = mix(core, rim, f) * (0.55 + energy * 0.75);
  gl_FragColor = vec4(color, alpha * (0.42 + 0.58 * f));
}`;

type Uniforms = {
  core: { value: THREE.Color };
  rim: { value: THREE.Color };
  energy: { value: number };
  alpha: { value: number };
};
const skin = (alpha: number, xray: boolean) =>
  new THREE.ShaderMaterial({
    uniforms: {
      core: { value: CORE.clone() },
      rim: { value: RIM.clone() },
      energy: { value: 0 },
      alpha: { value: alpha },
    } satisfies Uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // The visible pass sits on the element's own faces; the x-ray pass shows it through others.
    depthTest: !xray,
    polygonOffset: !xray,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

/** Match damage row identities to native meshes; linked instances need their own captured references. */
export function damageLayers(
  meshes: SceneMeshes,
  rows: readonly {
    key: string;
    ids: readonly number[];
    damage: string | null;
    priority?: number;
    findings: readonly string[];
  }[],
): Layer3D[] {
  return meshes.instances.flatMap((instance) => {
    if (!instance.vertexCount || instance.revitId == null || instance.linkInstanceId != null)
      return [];
    const blockers = rows
      .filter((row) => rowDamage(row) && row.ids.includes(instance.revitId!))
      .sort((a, b) => a.ids.length - b.ids.length || (a.priority ?? 0) - (b.priority ?? 0));
    return blockers.length
      ? [
          damageLayer(
            meshes,
            instance,
            blockers.map((row) => ({ key: row.key, elementId: instance.revitId! })),
            blockers.flatMap((row) => row.findings),
          ),
        ]
      : [];
  });
}

/** A blocking issue on real mesh geometry: a burning skin, a screen-space halo (the renderer's
 * glow pass), a heartbeat, and a hit flash when it first appears. Steady under reduced motion. No
 * route or equipment-kind knowledge belongs here. */
export function damageLayer(
  meshes: SceneMeshes,
  instance: SceneInstance,
  targets: readonly IssueTarget[],
  findings: readonly string[],
): Layer3D {
  const key = `damage:${instance.key}`;
  return {
    key,
    targets,
    findings,
    build(group) {
      if (!born.has(key)) born.set(key, performance.now() / 1000);
      const positions = meshes.positions.slice(
        instance.firstVertex * 3,
        (instance.firstVertex + instance.vertexCount) * 3,
      );
      const geometry = new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      geometry.computeBoundingBox();
      const origin = geometry.boundingBox!.getCenter(new THREE.Vector3());
      geometry.translate(-origin.x, -origin.y, -origin.z);
      geometry.computeVertexNormals();
      group.position.copy(origin);
      const xray = new THREE.Mesh(geometry, skin(0.45, true));
      xray.renderOrder = 7;
      const face = new THREE.Mesh(geometry, skin(0.85, false));
      face.renderOrder = 8;
      // The halo's source: drawn only into the glow pass, never into the picture itself. Its edges
      // ride along so a sub-pixel element at a system-wide fit still lights its halo.
      const halo = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: RIM, depthTest: false, side: THREE.DoubleSide }),
      );
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 35),
        new THREE.LineBasicMaterial({ color: RIM, depthTest: false }),
      );
      // A fixed-pixel beacon at the centre: at a system-wide fit the element is a few pixels, and
      // the halo must still be found at a glance.
      const beacon = new THREE.Points(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute([0, 0, 0], 3),
        ),
        new THREE.PointsMaterial({ color: RIM, size: 9, sizeAttenuation: false, depthTest: false }),
      );
      for (const glow of [halo, rim]) glow.layers.set(GLOW_LAYER);
      beacon.layers.set(BEACON_LAYER);
      group.add(xray, face, halo, rim, beacon);
    },
    frame(group, at: LayerFrame) {
      const [xray, face, halo, rim, beacon] = group.children as [
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
        THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
        THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
        THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>,
      ];
      const still = at.reducedMotion;
      const age = at.seconds - (born.get(key) ?? -Infinity);
      const strike = still ? 0 : flash(age);
      const swell = still ? 0 : landing(at.landed);
      const beat = still ? STEADY : heartbeat(at.seconds);
      const energy = FLOOR[at.state] + BEAT[at.state] * beat + 1.6 * strike + 0.8 * swell;
      // Pointing at it heats the rim toward white: the same hue, hotter.
      const heat =
        at.state === "hover" || at.state === "focus" ? 0.45 : at.state === "reach" ? 0.2 : 0;
      for (const [skin, alpha] of [
        [xray, 0.45],
        [face, 0.85],
      ] as const) {
        const u = skin.material.uniforms as Uniforms;
        u.energy.value = energy;
        // Selected: the skin thins to its rim so the selection's fill and outline read through;
        // the halo and heartbeat stay (selection never hides damage, and is never red itself).
        u.alpha.value = at.selected ? alpha * 0.4 : alpha;
        u.rim.value.copy(RIM).lerp(HOT, Math.min(1, heat + strike * 0.7));
      }
      // The glow mask is half-float: a source above 1 spreads a stronger halo.
      halo.material.color.copy(RIM).multiplyScalar(0.5 + 0.9 * energy);
      rim.material.color.copy(halo.material.color);
      beacon.material.color.copy(RIM).multiplyScalar(1.2 + 1.6 * energy);
      return !still;
    },
  };
}
