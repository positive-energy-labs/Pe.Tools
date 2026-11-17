import { snapshotById } from "./readiness.ts";
import type { DuctSnapshot } from "./types.ts";

export type DuctGraph = Pick<DuctSnapshot, "nodes" | "segments">;

/** Exact retained owners, including stub equipment. References keep their collected identities;
 * this projection neither walks beyond the drawn set nor invents internal equipment paths. */
export function drawnGraph(snapshot: DuctSnapshot, ids: Iterable<number>): DuctGraph {
  const index = snapshotById(snapshot);
  const nodes: DuctGraph["nodes"] = [],
    segments: DuctGraph["segments"] = [];
  for (const id of new Set(ids)) {
    const node = index.nodes.get(id);
    const segment = index.segments.get(id);
    if (node) nodes.push(node);
    if (segment) segments.push(segment);
  }
  return { nodes, segments };
}
