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
  type Batch = {
    line: LineSegments2;
    ports: readonly SurfacePort[];
    segments: number[][];
    shown: boolean[];
    geometryStamp: string;
    colourStamp: string;
  };
  const batches = new WeakMap<THREE.Group, Batch[]>();
  const geometryStamp = (look: Look) =>
    [look.ports.tickFt, look.ports.minRadiusFt, look.ports.roundSegments].join("/");
  const colourStamp = (look: Look, ink?: THREE.Color) =>
    [look.routes.lightnessStep, ink?.r ?? 1, ink?.g ?? 1, ink?.b ?? 1].join("/");
  const geometry = (batch: Omit<Batch, "line">, look: Look, ink?: THREE.Color) => {
    const positions: number[] = [];
    const colours: number[] = [];
    batch.ports.forEach((port, i) => {
      if (!batch.shown[i]) return;
      const segments = batch.segments[i]!;
      positions.push(...segments);
      const colour = port.paint.ink
        ? routeColour(new THREE.Color(port.paint.ink), port.paint, look)
        : (ink ?? new THREE.Color());
      for (let n = 0; n < segments.length; n += 3) colours.push(colour.r, colour.g, colour.b);
    });
    return new LineSegmentsGeometry().setPositions(positions).setColors(colours);
  };
  return {
    key: "surface-ports",
    build(group) {
      const built: Batch[] = [];
      // Port identity controls membership; stroke colour belongs in the vertex buffer, not a draw.
      // Keep two materials stable so renderer clipping and pixel-resolution hooks survive updates.
      for (const stub of [false, true]) {
        const members = ports.filter((port) => (port.paint.tier === "stub") === stub);
        if (!members.length) continue;
        const batch = {
          ports: members,
          segments: members.map((port) => portSegments(port, look)),
          shown: members.map(() => true),
          geometryStamp: geometryStamp(look),
          colourStamp: colourStamp(look),
        };
        const line = new LineSegments2(
          geometry(batch, look),
          new LineMaterial({
            vertexColors: true,
            linewidth: look.ports.width,
            opacity: stub ? look.ports.stubOpacity : look.ports.opacity,
            transparent: true,
            depthWrite: false,
            fog: false,
          }),
        );
        built.push({ ...batch, line });
        group.add(line);
      }
      batches.set(group, built);
    },
    frame(group, at) {
      const current = at.look ?? look;
      const next = current.ports;
      const shape = geometryStamp(current);
      const colour = colourStamp(current, at.ink);
      for (const batch of batches.get(group) ?? []) {
        const { line } = batch;
        let changed = batch.geometryStamp !== shape || batch.colourStamp !== colour;
        if (batch.geometryStamp !== shape)
          batch.segments = batch.ports.map((port) => portSegments(port, current));
        batch.ports.forEach((port, i) => {
          const shown =
            (at.contains?.(port.at) ?? true) &&
            (at.shown?.(port.owner) ?? true) &&
            (at.shown?.(port.route) ?? true);
          changed ||= shown !== batch.shown[i];
          batch.shown[i] = shown;
        });
        if (changed) {
          line.geometry.dispose();
          line.geometry = geometry(batch, current, at.ink);
          batch.geometryStamp = shape;
          batch.colourStamp = colour;
        }
        line.material.linewidth = next.width;
        line.material.opacity =
          batch.ports[0]!.paint.tier === "stub" ? next.stubOpacity : next.opacity;
        line.visible = batch.shown.some(Boolean);
      }
      return false;
    },
  };
}
