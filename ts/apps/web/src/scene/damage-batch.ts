import * as THREE from "three";
import { damageAppearance, damageColors } from "./damage";
import { GLOW_LAYER } from "./glow";
import { isLit } from "./grounds";
import type { Layer3D, LayerFrame } from "./types";

const vertexShader = /* glsl */ `
#include <batching_pars_vertex>
#include <fog_pars_vertex>
varying vec3 vNormal;
varying vec3 vView;
varying vec4 vDamage;
void main() {
  #include <batching_vertex>
  vDamage = getBatchingColor(getIndirectIndex(gl_DrawID));
  vec4 mvPosition = modelViewMatrix * batchingMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const fragmentShader = /* glsl */ `
uniform vec3 core;
uniform vec3 rim;
uniform vec3 hot;
varying vec3 vNormal;
varying vec3 vView;
varying vec4 vDamage;
#include <fog_pars_fragment>
void main() {
  #ifdef DAMAGE_GLOW
    gl_FragColor = vec4(rim * (0.5 + 0.9 * vDamage.x), 1.0);
  #else
    float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
    vec3 edge = mix(rim, hot, vDamage.z);
    vec3 color = mix(core, edge, f) * (0.55 + vDamage.x * 0.75);
    gl_FragColor = vec4(color, vDamage.y * (0.42 + 0.58 * f));
  #endif
  #include <fog_fragment>
}`;

/** Semantic issue identities do not require separate draw objects or materials. */
export function createDamageBatch(layers: readonly Layer3D[]) {
  const damage = layers.filter((layer) => layer.damage !== undefined);
  const group = new THREE.Group();
  group.name = "damage-batches";
  const ids = new Map(damage.map((layer, id) => [layer, id]));
  const count = damage.reduce((sum, layer) => sum + layer.damage!.instance.vertexCount, 0);
  const batches = [false, true].flatMap((lifted) =>
    [false, true].map((glow) => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          core: { value: damageColors.core },
          rim: { value: damageColors.rim },
          hot: { value: damageColors.hot },
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        },
        defines: glow ? { DAMAGE_GLOW: 1 } : {},
        vertexShader,
        fragmentShader,
        transparent: !glow,
        depthWrite: glow,
        depthTest: !lifted,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const batch = new THREE.BatchedMesh(
        Math.max(1, damage.length),
        Math.max(3, count),
        0,
        material,
      );
      batch.renderOrder = glow ? 0 : 8;
      if (glow) batch.layers.set(GLOW_LAYER);
      group.add(batch);
      return batch;
    }),
  );
  // Every batch has the same immutable ranges and transform. Only its visibility and appearance
  // differ; sharing the packed geometry avoids four retained copies of the same triangles.
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const layer of damage) {
    const { meshes, instance } = layer.damage!;
    const p = meshes.positions;
    for (
      let n = instance.firstVertex * 3;
      n < (instance.firstVertex + instance.vertexCount) * 3;
      n += 3
    )
      bounds.expandByPoint(point.fromArray(p, n));
  }
  const origin = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  group.position.copy(origin);
  const packed = new THREE.Vector4(0, 0, 0, 1);
  for (const layer of damage) {
    const { meshes, instance } = layer.damage!;
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
    geometry.translate(-origin.x, -origin.y, -origin.z);
    geometry.computeVertexNormals();
    for (const batch of batches) {
      const id = batch.addInstance(batch.addGeometry(geometry));
      batch.setColorAt(id, packed);
      batch.setVisibleAt(id, false);
    }
    geometry.dispose();
  }
  if (damage.length) {
    for (const batch of batches.slice(1)) {
      batch.geometry.dispose();
      batch.geometry = batches[0]!.geometry;
    }
  }
  const previous = damage.map(() => new THREE.Vector4(NaN, NaN, NaN, NaN));
  return {
    group,
    update(layer: Layer3D, at: LayerFrame) {
      const id = ids.get(layer);
      if (id === undefined) return false;
      const surface = layer.damage!;
      const appearance = damageAppearance(at, surface.born);
      packed.set(appearance.energy, appearance.alpha, appearance.heat, 1);
      const changed = !previous[id]!.equals(packed);
      const shown = at.shown?.(surface.instance.key) ?? true;
      const lifted = isLit(at);
      batches.forEach((batch, index) => {
        batch.setVisibleAt(id, shown && index >= 2 === lifted);
        if (changed) batch.setColorAt(id, packed);
      });
      if (changed) previous[id]!.copy(packed);
      return shown && appearance.animating;
    },
    dispose() {
      // All four are co-owned and retire together; repeated shared geometry disposal is harmless.
      for (const batch of batches) {
        batch.dispose();
        batch.material.dispose();
      }
      group.clear();
    },
  };
}
