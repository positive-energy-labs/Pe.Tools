import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LOOK, type Look } from "./grounds";
import type { Layer3D, Paint } from "./types";
import { routeColour } from "./surfaces";

/** Facts only: the renderer neither discovers connections nor joins ports inside a shell. */
export type SurfacePort = {
  key: string;
  owner: string;
  route: string;
  at: readonly number[];
  facing: readonly number[];
  widthAxis?: readonly number[] | null;
  shape: string;
  widthFt: number;
  heightFt: number;
  paint: Paint;
};

export function portSegments(port: SurfacePort, look: Look) {
  const normal = new THREE.Vector3().fromArray(port.facing).normalize();
  const u = port.widthAxis
    ? new THREE.Vector3().fromArray(port.widthAxis)
    : new THREE.Vector3(1, 0, 0);
  u.addScaledVector(normal, -u.dot(normal));
  if (u.lengthSq() < 1e-8) {
    const components = normal.toArray().map(Math.abs);
    u.set(0, 0, 0).setComponent(components.indexOf(Math.min(...components)), 1);
    u.addScaledVector(normal, -u.dot(normal));
  }
  u.normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const centre = new THREE.Vector3().fromArray(port.at);
  const w = Math.max(look.ports.minRadiusFt, port.widthFt / 2);
  const h = Math.max(look.ports.minRadiusFt, port.heightFt / 2);
  const ring =
    port.shape === "rectangular"
      ? [
          [-w, -h],
          [w, -h],
          [w, h],
          [-w, h],
        ]
      : Array.from({ length: look.ports.roundSegments }, (_, i) => {
          const a = (i * 2 * Math.PI) / look.ports.roundSegments;
          return [Math.cos(a) * w, Math.sin(a) * h];
        });
  const points = ring.map(([x, y]) =>
    centre.clone().addScaledVector(u, x!).addScaledVector(v, y!).toArray(),
  );
  return [
    ...points.flatMap((p, i) => [...p, ...points[(i + 1) % points.length]!]),
    ...centre.toArray(),
    ...centre.clone().addScaledVector(normal, look.ports.tickFt).toArray(),
  ];
}

export function portLayer(ports: readonly SurfacePort[], look = LOOK.read()): Layer3D {
  let geometryLook = look.ports;
  return {
    key: "surface-ports",
    build(group) {
      for (const port of ports) {
        const line = new LineSegments2(
          new LineSegmentsGeometry().setPositions(portSegments(port, look)),
          new LineMaterial({
            color: port.paint.ink
              ? routeColour(new THREE.Color(port.paint.ink), port.paint, look)
              : undefined,
            linewidth: look.ports.width,
            opacity: port.paint.tier === "stub" ? look.ports.stubOpacity : look.ports.opacity,
            transparent: true,
            depthWrite: false,
            fog: false,
          }),
        );
        line.userData.port = port;
        group.add(line);
      }
    },
    frame(group, at) {
      const next = at.look?.ports ?? look.ports;
      const geometryChanged =
        next.tickFt !== geometryLook.tickFt ||
        next.minRadiusFt !== geometryLook.minRadiusFt ||
        next.roundSegments !== geometryLook.roundSegments;
      for (const child of group.children) {
        const line = child as LineSegments2;
        const port: SurfacePort = child.userData.port;
        if (geometryChanged) {
          line.geometry.dispose();
          line.geometry = new LineSegmentsGeometry().setPositions(
            portSegments(port, at.look ?? look),
          );
        }
        line.material.linewidth = next.width;
        line.material.opacity = port.paint.tier === "stub" ? next.stubOpacity : next.opacity;
        if (port.paint.ink)
          line.material.color.copy(
            routeColour(new THREE.Color(port.paint.ink), port.paint, at.look ?? look),
          );
        if (!port.paint.ink && at.ink) line.material.color.copy(at.ink);
        child.visible =
          (at.contains?.(port.at) ?? true) &&
          (at.shown?.(port.owner) ?? true) &&
          (at.shown?.(port.route) ?? true);
      }
      geometryLook = next;
      return false;
    },
  };
}
