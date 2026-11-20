import * as THREE from "three";
import { axisBounds, CUT_AXES, cutPolygon, type Cuts } from "@pe/web-kernel/scene/cuts";
import { datumMaterial, markMaterial } from "@pe/web-kernel/scene/grounds";
import { frameRect, fromFrame } from "@pe/web-kernel/scene/plane";
import type { Bounds, Layer3D } from "@pe/web-kernel/scene/types";

/** An open curtain is drawing furniture, never a cap or captured geometry. */
export function cutCurtain(cuts: Cuts, bounds: Bounds): Layer3D {
  const positions: number[] = [],
    lines: number[] = [];
  for (const axis of CUT_AXES) {
    const p = cutPolygon(cuts[axis], axisBounds(bounds, axis));
    const { w0, w1 } = frameRect(axis, bounds);
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length];
      const corners = [
        fromFrame(axis, ...a, w0),
        fromFrame(axis, ...b, w0),
        fromFrame(axis, ...b, w1),
        fromFrame(axis, ...a, w1),
      ];
      // Both windings keep a curtain visible from either side without asserting a closed solid.
      for (const index of [0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]) positions.push(...corners[index]);
      lines.push(...corners[0], ...corners[1], ...corners[3], ...corners[2]);
    });
  }
  const materials = new WeakMap<THREE.Group, THREE.Material[]>();
  return {
    key: "section-editor-curtain",
    build(group) {
      const line = datumMaterial(),
        fill = markMaterial(line.color);
      fill.opacity = line.opacity;
      const geometry = (data: number[]) =>
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(data, 3),
        );
      group.add(
        new THREE.LineSegments(geometry(lines), line),
        new THREE.Mesh(geometry(positions), fill),
      );
      materials.set(group, [line, fill]);
    },
    frame(group, at) {
      if (at.ink)
        for (const material of materials.get(group) ?? [])
          if (
            material instanceof THREE.LineBasicMaterial ||
            material instanceof THREE.MeshBasicMaterial
          )
            material.color.copy(at.ink);
      return false;
    },
  };
}
