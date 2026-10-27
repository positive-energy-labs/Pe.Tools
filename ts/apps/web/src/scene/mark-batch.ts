import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

type Stroke = {
  line: LineSegments2;
  positions: Float32Array;
  distances: Float32Array;
  visible: boolean;
};
type Bucket = { members: readonly Stroke[]; line: LineSegments2 };

/** A finding owns its hit target, not its draw call. Only strokes made by markLines participate;
 * other layers may animate geometry or visibility and retain their own drawing contract. */
export function createMarkBatch(
  roots: Iterable<THREE.Group>,
  configure: (material: LineMaterial) => void,
) {
  const group = new THREE.Group();
  const strokes: Stroke[] = [];
  const point = new THREE.Vector3();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!(object instanceof LineSegments2) || !object.userData.markStroke) return;
      const start = object.geometry.getAttribute("instanceStart");
      const end = object.geometry.getAttribute("instanceEnd");
      const d0 = object.geometry.getAttribute("instanceDistanceStart");
      const d1 = object.geometry.getAttribute("instanceDistanceEnd");
      const positions = new Float32Array(start.count * 6);
      const distances = new Float32Array(start.count * 2);
      for (let i = 0; i < start.count; i++) {
        point
          .fromBufferAttribute(start, i)
          .applyMatrix4(object.matrixWorld)
          .toArray(positions, i * 6);
        point
          .fromBufferAttribute(end, i)
          .applyMatrix4(object.matrixWorld)
          .toArray(positions, i * 6 + 3);
        // Preserve each finding's dash phase, rather than continuing it from an unrelated mark.
        distances[i * 2] = d0?.getX(i) ?? 0;
        distances[i * 2 + 1] = d1?.getX(i) ?? 0;
      }
      strokes.push({ line: object, positions, distances, visible: object.visible });
      object.visible = false;
    });
  }
  const buckets = new Map<string, Bucket>();
  const dispose = (bucket: Bucket) => {
    group.remove(bucket.line);
    bucket.line.geometry.dispose();
    bucket.line.material.dispose();
  };
  return {
    group,
    /** True means new materials need the renderer's current pixel resolution. */
    sync() {
      const next = new Map<string, Stroke[]>();
      for (const stroke of strokes) {
        // A fully transparent stroke (a lit mark's occluded twin at rest) costs no draw.
        if (!stroke.visible || stroke.line.material.opacity === 0) continue;
        const { line } = stroke;
        const m = line.material;
        const key = [
          m.color.r,
          m.color.g,
          m.color.b,
          m.linewidth,
          m.opacity,
          m.depthTest,
          m.depthFunc,
          m.dashed,
          m.dashSize,
          m.gapSize,
          m.dashScale,
          m.dashOffset,
          m.worldUnits,
          m.alphaToCoverage,
          m.fog,
          line.renderOrder,
          line.layers.mask,
        ].join("/");
        const members = next.get(key);
        if (members) members.push(stroke);
        else next.set(key, [stroke]);
      }
      let changed = false;
      for (const [key, held] of buckets) {
        const members = next.get(key);
        if (
          members?.length === held.members.length &&
          members.every((s, i) => s === held.members[i])
        )
          continue;
        dispose(held);
        buckets.delete(key);
        changed = true;
      }
      for (const [key, members] of next) {
        if (buckets.has(key)) continue;
        const count = members.reduce((n, s) => n + s.positions.length, 0);
        const positions = new Float32Array(count);
        const distances = new Float32Array(count / 3);
        let at = 0;
        for (const stroke of members) {
          positions.set(stroke.positions, at);
          distances.set(stroke.distances, at / 3);
          at += stroke.positions.length;
        }
        const source = members[0]!.line;
        const geometry = new LineSegmentsGeometry().setPositions(positions);
        const distanceBuffer = new THREE.InstancedInterleavedBuffer(distances, 2, 1);
        geometry.setAttribute(
          "instanceDistanceStart",
          new THREE.InterleavedBufferAttribute(distanceBuffer, 1, 0),
        );
        geometry.setAttribute(
          "instanceDistanceEnd",
          new THREE.InterleavedBufferAttribute(distanceBuffer, 1, 1),
        );
        const material = source.material.clone();
        // Three clones userData but not shader hooks: let the renderer install both hooks afresh.
        delete material.userData.sceneClipped;
        delete material.userData.veiled;
        configure(material);
        const line = new LineSegments2(geometry, material);
        line.renderOrder = source.renderOrder;
        line.layers.mask = source.layers.mask;
        group.add(line);
        buckets.set(key, { members, line });
        changed = true;
      }
      return changed;
    },
    dispose() {
      for (const bucket of buckets.values()) dispose(bucket);
      buckets.clear();
      for (const { line, visible } of strokes) line.visible = visible;
    },
  };
}
