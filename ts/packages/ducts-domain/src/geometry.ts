import type { DuctSnapshot } from "./types.ts";

/** Physical transition inputs, independent of rooted graph traversal. Historical root-relative
 * inlet/area facts and type labels cannot establish these observations. */
export function transitionGeometry(node: DuctSnapshot["nodes"][number]) {
  const ports = node.connectors;
  const pair =
    ports.length === 2 &&
    ports.filter((c) => c.direction === "in").length === 1 &&
    ports.filter((c) => c.direction === "out").length === 1;
  const angles = node.facts.filter((f) => f.key === "angle");
  const observed = angles.length === 1 && angles[0]!.unit === "deg" ? angles[0]!.value : null;
  const angleDeg =
    observed != null && Number.isFinite(observed) && observed > 0 && observed <= 180
      ? observed
      : null;
  return {
    inlet: pair ? ports.find((c) => c.direction === "in") : undefined,
    outlet: pair ? ports.find((c) => c.direction === "out") : undefined,
    angleDeg,
    error:
      angleDeg == null ? "transition has no valid measured included angle in degrees" : undefined,
  };
}

/**
 * A uniform grid of `size` ft cells over boxes `[lo, hi]`: `at(p)` lists, ascending, the indices
 * of the boxes covering `p`'s cell. A box inflated by a search radius makes `at(p)` a superset of
 * everything within that radius of `p`, in index order, so a scan over it finds what an all-pairs
 * scan finds, in the same order.
 */
export function cells(boxes: readonly (readonly [number[], number[]])[], size: number) {
  const cell = (v: number) => Math.floor(v / size);
  const grid = new Map<string, number[]>();
  boxes.forEach(([lo, hi], i) => {
    for (let x = cell(lo[0]!); x <= cell(hi[0]!); x++)
      for (let y = cell(lo[1]!); y <= cell(hi[1]!); y++)
        for (let z = cell(lo[2]!); z <= cell(hi[2]!); z++) {
          const k = `${x},${y},${z}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
        }
  });
  return (p: readonly number[]) => grid.get(p.map(cell).join()) ?? [];
}
