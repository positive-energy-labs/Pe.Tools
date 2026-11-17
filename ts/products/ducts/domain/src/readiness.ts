import type { DuctSnapshot } from "./types.ts";
type DuctIssue = DuctSnapshot["issues"][number];

interface ById {
  issues: Map<string, DuctIssue>;
  nodes: Map<number, DuctSnapshot["nodes"][number]>;
  segments: Map<number, DuctSnapshot["segments"][number]>;
}

const byIds = new WeakMap<DuctSnapshot, ById>();

/** The snapshot's issues, nodes and segments by id; built once per snapshot, shared by every view. */
export function snapshotById(snapshot: DuctSnapshot): ById {
  let index = byIds.get(snapshot);
  if (!index) {
    index = {
      issues: new Map(snapshot.issues.map((issue) => [issue.id, issue])),
      nodes: new Map(snapshot.nodes.map((node) => [node.id, node])),
      segments: new Map(snapshot.segments.map((segment) => [segment.id, segment])),
    };
    byIds.set(snapshot, index);
  }
  return index;
}
