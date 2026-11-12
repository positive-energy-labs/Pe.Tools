import * as THREE from "three";
import type { Mark, Vec3 } from "@pe/agent-contracts/slots";
import { inkOf } from "#/scene/ink";
import { markFrame, markLines, markVolume } from "#/scene/marks";
import type { Layer3D } from "#/scene/types";

/** The kernel's drawing of the closed mark set (ADR 0035 rule 2), in model feet. A `label` is DOM, drawn by the pane. */
type Edge = readonly [Vec3, Vec3];
const RING_FT = 1.5;
const HALF_FT = 0.5;
const SEGMENTS = 24;

/** Three great circles: a ring reads as a ring from every orbit angle, never as a line seen edge-on. */
const ring = (c: Vec3): Edge[] =>
  [0, 1, 2].flatMap((axis) => {
    const at = (n: number): Vec3 => {
      const a = (n / SEGMENTS) * 2 * Math.PI;
      const p: [number, number, number] = [c[0], c[1], c[2]];
      p[(axis + 1) % 3]! += RING_FT * Math.cos(a);
      p[(axis + 2) % 3]! += RING_FT * Math.sin(a);
      return p;
    };
    return Array.from({ length: SEGMENTS }, (_, i): Edge => [at(i), at(i + 1)]);
  });
const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
const box = (min: Vec3, max: Vec3): Edge[] => {
  const corner = (n: number): Vec3 => [n & 1 ? max[0] : min[0], n & 2 ? max[1] : min[1], n & 4 ? max[2] : min[2]];
  return BOX_EDGES.map(([a, b]): Edge => [corner(a), corner(b)]);
};
const per = (f: (i: 0 | 1 | 2) => number): Vec3 => [f(0), f(1), f(2)];
/** A design token (`viz-1`) or a six-digit hex. */
const ink = (mark: Mark) => (/^#[0-9a-f]{6}$/i.test(mark.ink ?? "") ? new THREE.Color(mark.ink) : inkOf(mark.ink ?? "viz-3"));

/** One resolved mark as a renderer layer; a mark still on a SubjectRef (nothing captured it) or a label draws none. */
export function markLayer(mark: Mark, id = "mark"): Layer3D | null {
  const at = mark.at;
  if (typeof at === "string" || mark.kind === "label") return null;
  const [a, b] = "point" in at ? [at.point, at.point] : [at.from, at.to];
  const pointed = "point" in at;
  const min = per((i) => Math.min(a[i], b[i]) - (pointed ? HALF_FT : 0));
  const max = per((i) => Math.max(a[i], b[i]) + (pointed ? HALF_FT : 0));
  const middle = per((i) => (a[i] + b[i]) / 2);
  return {
    key: `${id}:${JSON.stringify(mark)}`,
    build: (group) => {
      const colour = ink(mark);
      if (mark.kind === "volume")
        return void group.add(markVolume(new THREE.BoxGeometry(...per((i) => max[i] - min[i])).translate(...middle), colour));
      const edges = mark.kind === "ring" ? ring(middle)
        : mark.kind === "outline" ? box(min, max)
        : [pointed ? ([a, [a[0], a[1], a[2] + 2 * HALF_FT]] as Edge) : ([a, b] as Edge)];
      group.add(markLines(edges, colour, { weight: mark.kind === "bar" ? 2.5 : 1.5 }));
    },
    frame: markFrame,
  };
}
