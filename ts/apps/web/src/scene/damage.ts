import * as THREE from "three";
import type { IssueTarget, Layer3D, SceneInstance, SceneMeshes } from "./types";

/** A blocking issue on real mesh geometry. No route or equipment-kind knowledge belongs here. */
export function damageLayer(
  meshes: SceneMeshes,
  instance: SceneInstance,
  targets: readonly IssueTarget[],
  findings: readonly string[],
): Layer3D {
  return {
    key: `damage:${instance.key}`,
    targets,
    findings,
    build(group) {
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
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0x990600,
          emissive: 0xff0800,
          emissiveIntensity: 1,
          transparent: true,
          opacity: 0.4,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.renderOrder = 8;
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 35),
        new THREE.LineBasicMaterial({
          color: 0xff291a,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      outline.renderOrder = 9;
      group.add(mesh, outline);
    },
    frame(group, seconds, reducedMotion, lit) {
      const pulse = reducedMotion ? 0.7 : (1 - Math.cos(seconds * Math.PI * 2)) / 2;
      const mesh = group.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;
      const outline = group.children[1] as THREE.LineSegments<
        THREE.BufferGeometry,
        THREE.LineBasicMaterial
      >;
      mesh.material.opacity = (lit ? 0.42 : 0.18) + pulse * 0.32;
      mesh.material.emissiveIntensity = (lit ? 1.8 : 1) + pulse;
      outline.material.opacity = (lit ? 0.75 : 0.4) + pulse * 0.25;
      return !reducedMotion;
    },
  };
}
