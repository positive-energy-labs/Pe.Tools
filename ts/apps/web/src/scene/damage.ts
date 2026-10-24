import * as THREE from "three";
import { rowDamage } from "@pe/kit/table/model";

export const damageMark = (row: unknown) => ({ "data-damage": rowDamage(row) || undefined });
import { GLOW_LAYER } from "./glow";
import { landing } from "./marks";
import { DAMAGE_ALPHA, isLit, WHITE } from "./grounds";
import type {
  IssueState,
  IssueTarget,
  Layer3D,
  LayerFrame,
  SceneInstance,
  SceneMeshes,
} from "./types";

const CORE = new THREE.Color();
const RIM = new THREE.Color();
const HOT = new THREE.Color();
export function setDamageHue(alarm: THREE.Color) {
  CORE.copy(alarm);
  RIM.copy(alarm).lerp(WHITE, 0.25);
  HOT.copy(alarm).lerp(WHITE, 0.85);
}
const PERIOD = 1.5;

export function heartbeat(seconds: number) {
  const p = (((seconds % PERIOD) + PERIOD) % PERIOD) / PERIOD;
  const bump = (at: number, width: number) => Math.exp(-(((p - at) / width) ** 2));
  return Math.min(1, bump(0.1, 0.055) + 0.55 * bump(0.27, 0.06));
}

const FLOOR: Record<IssueState, number> = { rest: 0.45, reach: 0.65, hover: 1, focus: 1.05 };
const BEAT: Record<IssueState, number> = { rest: 0.55, reach: 0.55, hover: 0.35, focus: 0.35 };
const STEADY = 0.5;

/** When each damage first appeared on this page: the hit flash plays once, not per rebuild. */
const born = new Map<string, number>();
const flash = (age: number) => (age >= 0 && age < 0.9 ? Math.exp(-age / 0.16) : 0);

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const fragmentShader = /* glsl */ `
uniform vec3 core;
uniform vec3 rim;
uniform float energy;
uniform float alpha;
varying vec3 vNormal;
varying vec3 vView;
#include <fog_pars_fragment>
void main() {
  float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
  vec3 color = mix(core, rim, f) * (0.55 + energy * 0.75);
  gl_FragColor = vec4(color, alpha * (0.42 + 0.58 * f));
  #include <fog_fragment>
}`;

type Uniforms = Record<"core" | "rim", { value: THREE.Color }> &
  Record<"energy" | "alpha", { value: number }>;
// Skin and coverage mask must both clear base depth; mask holes otherwise leak glow across faces.
const SURFACE_DEPTH = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };
const skin = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      core: { value: CORE.clone() },
      rim: { value: RIM.clone() },
      energy: { value: 0 },
      alpha: { value: DAMAGE_ALPHA },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    } satisfies Uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: true,
    ...SURFACE_DEPTH,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

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
    if (!blockers.length) return [];
    return [
      damageLayer(
        meshes,
        instance,
        blockers.map((row) => ({ key: row.key, elementId: instance.revitId! })),
        blockers.flatMap((row) => row.findings),
      ),
    ];
  });
}

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
      const face = new THREE.Mesh(geometry, skin());
      face.renderOrder = 8;
      const halo = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: RIM, side: THREE.DoubleSide, ...SURFACE_DEPTH }),
      );
      halo.layers.set(GLOW_LAYER);
      group.add(face, halo);
    },
    frame(group, at: LayerFrame) {
      const [face, halo] = group.children as [
        THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
        THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
      ];
      const still = at.reducedMotion;
      const strike = still ? 0 : flash(at.seconds - (born.get(key) ?? -Infinity));
      const swell = still ? 0 : landing(at.landed);
      const beat = still ? STEADY : heartbeat(at.seconds);
      const energy = FLOOR[at.state] + BEAT[at.state] * beat + 1.6 * strike + 0.8 * swell;
      const heat =
        at.state === "hover" || at.state === "focus" ? 0.45 : at.state === "reach" ? 0.2 : 0;
      for (const object of [face, halo]) object.material.depthTest = !isLit(at);
      const u = face.material.uniforms as Uniforms;
      u.core.value.copy(CORE);
      u.energy.value = energy;
      // Selection yields the skin's interior to the neutral selection fill.
      u.alpha.value = at.selected ? DAMAGE_ALPHA * 0.4 : DAMAGE_ALPHA;
      u.rim.value.copy(RIM).lerp(HOT, Math.min(1, heat + strike * 0.7));
      halo.material.color.copy(RIM).multiplyScalar(0.5 + 0.9 * energy);
      return !still;
    },
  };
}
