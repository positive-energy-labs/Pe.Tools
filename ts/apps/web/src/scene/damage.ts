import * as THREE from "three";
import { rowDamage } from "@pe/kit/table/model";
import { landing } from "./marks";
import { damageAlpha, WHITE } from "./grounds";
import type {
  IssueState,
  IssueTarget,
  Layer3D,
  LayerFrame,
  SceneInstance,
  SceneMeshes,
} from "./types";

export const damageMark = (row: unknown) => ({ "data-damage": rowDamage(row) || undefined });
export const damageColors = {
  core: new THREE.Color(),
  rim: new THREE.Color(),
  hot: new THREE.Color(),
};
export function setDamageHue(alarm: THREE.Color) {
  damageColors.core.copy(alarm);
  damageColors.rim.copy(alarm).lerp(WHITE, 0.25);
  damageColors.hot.copy(alarm).lerp(WHITE, 0.85);
}
const PERIOD = 1.5;
export function heartbeat(seconds: number) {
  const p = (((seconds % PERIOD) + PERIOD) % PERIOD) / PERIOD;
  const bump = (at: number, width: number) => Math.exp(-(((p - at) / width) ** 2));
  return Math.min(1, bump(0.1, 0.055) + 0.55 * bump(0.27, 0.06));
}
const FLOOR: Record<IssueState, number> = { rest: 0.45, reach: 0.65, hover: 1, focus: 1.05 };
const BEAT: Record<IssueState, number> = { rest: 0.55, reach: 0.55, hover: 0.35, focus: 0.35 };
// Birth belongs to the captured geometry, not a global id map that retains every visited model.
const births = new WeakMap<SceneMeshes, Map<string, number>>();

export function damageAppearance(at: LayerFrame, born: number) {
  const age = at.seconds - born;
  const strike = !at.reducedMotion && age >= 0 && age < 0.9 ? Math.exp(-age / 0.16) : 0;
  const swell = at.reducedMotion ? 0 : landing(at.landed);
  // Damage remains visible at rest; perpetual heartbeat must not keep the entire scene awake.
  const animating = !at.reducedMotion && (age < 0.9 || at.landed < 0.65);
  const beat = animating ? heartbeat(at.seconds) : 0.5;
  const heat = at.state === "hover" || at.state === "focus" ? 0.45 : at.state === "reach" ? 0.2 : 0;
  return {
    energy: FLOOR[at.state] + BEAT[at.state] * beat + 1.6 * strike + 0.8 * swell,
    alpha: damageAlpha(at.look) * (at.selected ? 0.4 : 1),
    heat: Math.min(1, heat + strike * 0.7),
    animating,
  };
}

type DamageRow = {
  key: string;
  ids: readonly number[];
  damage: string | null;
  priority?: number;
  findings: readonly string[];
};
export function damageLayers(meshes: SceneMeshes, rows: readonly DamageRow[]): Layer3D[] {
  const byElement = new Map<number, DamageRow[]>();
  for (const row of rows) {
    if (!rowDamage(row)) continue;
    for (const id of new Set(row.ids)) {
      const held = byElement.get(id);
      if (held) held.push(row);
      else byElement.set(id, [row]);
    }
  }
  for (const held of byElement.values())
    held.sort((a, b) => a.ids.length - b.ids.length || (a.priority ?? 0) - (b.priority ?? 0));
  return meshes.instances.flatMap((instance) => {
    if (!instance.vertexCount || instance.revitId == null || instance.linkInstanceId != null)
      return [];
    const blockers = byElement.get(instance.revitId);
    if (!blockers?.length) return [];
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
  let seen = births.get(meshes);
  if (!seen) births.set(meshes, (seen = new Map()));
  let born = seen.get(instance.key);
  if (born === undefined) seen.set(instance.key, (born = performance.now() / 1000));
  return {
    key: `damage:${instance.key}`,
    targets,
    findings,
    damage: { meshes, instance, born },
    build(group) {
      // Picking keeps element identity independently of draw batches. Invisible proxies share
      // capture bytes and never upload them; Three's raycaster intentionally ignores visibility.
      const geometry = new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.BufferAttribute(
          meshes.positions.subarray(
            instance.firstVertex * 3,
            (instance.firstVertex + instance.vertexCount) * 3,
          ),
          3,
        ),
      );
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const proxy = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
      proxy.visible = false;
      group.add(proxy);
    },
  };
}
