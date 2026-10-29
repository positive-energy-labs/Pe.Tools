/**
 * Dev only (`?strands=fixture`): strands made from a picture's own centrelines, so the strand
 * drawing can be seen on any fixture route without a surface supplying them. Joins elements whose
 * ends meet, roots the walk at a leaf, and runs one strand to each of the three farthest leaves
 * (the farthest heavy), so they share a trunk; the heavy strand's middle element is `over`.
 * Unjoined lines (the colours demo's loose ducts) get overlapping windows of three instead.
 */
import type { SubjectKey } from "@pe/kit/lang/attention";
import { boundsOfInstances } from "#/scene/orbit";
import type { SceneMeshes } from "#/scene/types";
import type { PictureLine, PictureStrand } from "./model";

const TOUCH_FT = 1.5;

export const strandFixtureOn = () =>
  import.meta.env.DEV &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("strands") === "fixture";

/** A focus mesh's box as a centreline along its longest axis: the fixture's stand-in line. */
const meshLines = (meshes: SceneMeshes | null): PictureLine[] =>
  (meshes?.instances ?? []).flatMap((i) => {
    const b = i.focus && i.revitId != null ? boundsOfInstances(meshes!, (j) => j === i) : null;
    if (!b) return [];
    const min = [b.minX, b.minY, b.minZ],
      max = [b.maxX, b.maxY, b.maxZ];
    const mid = min.map((v, k) => (v + max[k]!) / 2);
    const axis = [0, 1, 2].reduce((a, k) => (max[k]! - min[k]! > max[a]! - min[a]! ? k : a), 0);
    const at = (v: number) => mid.map((m, k) => (k === axis ? v : m));
    return [{ key: `e:${i.revitId}` as SubjectKey, points: [at(min[axis]!), at(max[axis]!)] }];
  });

export function strandFixture(given: readonly PictureLine[], meshes: SceneMeshes | null) {
  const lines = given.length ? given : meshLines(meshes);
  const drawn = lines.filter((line) => line.points.length);
  const ends = drawn.map((line) => [line.points[0]!, line.points.at(-1)!]);
  const near = (p: readonly number[], q: readonly number[]) =>
    Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) < TOUCH_FT;
  const next = drawn.map((_, i) =>
    drawn.flatMap((_, j) =>
      i !== j && ends[i]!.some((p) => ends[j]!.some((q) => near(p, q))) ? [j] : [],
    ),
  );
  const root = next.findIndex((n) => n.length === 1);
  if (root < 0) return windows(drawn, lines);
  const parent = new Map<number, number>([[root, -1]]);
  const depth = new Map<number, number>([[root, 0]]);
  for (const queue = [root]; queue.length; ) {
    const at = queue.shift()!;
    for (const j of next[at]!)
      if (!parent.has(j)) {
        parent.set(j, at);
        depth.set(j, depth.get(at)! + 1);
        queue.push(j);
      }
  }
  const leaves = [...parent.keys()]
    .filter((i) => i !== root && !next[i]!.some((j) => parent.get(j) === i))
    .sort((a, b) => depth.get(b)! - depth.get(a)!)
    .slice(0, 3);
  const strands: PictureStrand[] = leaves.map((leaf, n) => {
    const path: SubjectKey[] = [];
    for (let at = leaf; at >= 0; at = parent.get(at)!) path.unshift(drawn[at]!.key);
    return { key: `run:fixture-${n}`, path, heavy: n === 0 };
  });
  const heavy = strands[0]?.path;
  const over = new Set<SubjectKey>(heavy ? [heavy[Math.floor(heavy.length / 2)]!] : []);
  return strands.length ? { strands, over, lines } : null;
}

function windows(drawn: readonly PictureLine[], lines: readonly PictureLine[]) {
  const keys = drawn.map((line) => line.key);
  const strands: PictureStrand[] = keys.slice(0, -2).map((_, n) => ({
    key: `run:fixture-${n}`,
    path: keys.slice(n, n + 3),
    heavy: n === keys.length - 3,
  }));
  return strands.length ? { strands, over: new Set<SubjectKey>([keys[2]!]), lines } : null;
}
