/**
 * The /ducts scene: the snapshot indexed once per read, and the subject's elements with every fact
 * the encodings read. Both spatial views scope through `sceneOf`; only the level filter and the
 * context they hand it differ.
 */
import type { ReactNode } from "react";

import type { DuctDrawing, NodeFacts, Scene } from "./drawing";
import type { DuctNode, Issue, Segment, SegmentFacts } from "./encoding";
import type { DuctSnapshot } from "./readiness";
import { pressurePoints } from "./pressure";

type Level = DuctSnapshot["levels"][number];

/** The snapshot indexed once per read: every view and every scope reads these maps. */
export interface DuctIndex {
  snapshot: DuctSnapshot;
  levels: readonly Level[];
  flows: ReadonlyMap<number, number>;
  issuesOf: ReadonlyMap<number, Issue[]>;
  segmentsOf: ReadonlyMap<string, Segment[]>;
  nodesOf: ReadonlyMap<string, DuctNode[]>;
  /** The level a model z sits on: the highest at or below it. */
  levelAt: (z: number) => Level | null;
  levelOf: (issue: Issue) => number | null;
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function indexOf(snapshot: DuctSnapshot): DuctIndex {
  const levels = [...snapshot.levels].sort((a, b) => a.elevationFt - b.elevationFt);
  const flows = new Map(snapshot.flows.map((flow) => [flow.segmentId, flow.cfm]));
  const issuesOf = new Map<number, Issue[]>();
  for (const issue of snapshot.issues)
    if (issue.elementId != null) push(issuesOf, issue.elementId, issue);
  const segmentsOf = new Map<string, Segment[]>();
  for (const segment of snapshot.segments) push(segmentsOf, segment.groupId ?? "", segment);
  const nodesOf = new Map<string, DuctNode[]>();
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const node of snapshot.nodes) if (node.groupId) push(nodesOf, node.groupId, node);
  // Equipment is cut out of every group (groupId null); a group draws its roots.
  for (const group of snapshot.groups)
    for (const root of group.rootIds) {
      const node = nodeById.get(root);
      if (node) push(nodesOf, group.id, node);
    }
  const segmentLevel = new Map(snapshot.segments.map((s) => [s.id, s.levelId ?? null]));
  const levelAt = (z: number) =>
    [...levels].reverse().find((level) => level.elevationFt <= z + 0.5) ?? null;
  const levelOf = (issue: Issue) => {
    const id = issue.elementId;
    const own = id == null ? null : (segmentLevel.get(id) ?? nodeById.get(id)?.levelId ?? null);
    return own ?? (issue.point ? (levelAt(issue.point[2]!)?.id ?? null) : null);
  };
  return { snapshot, levels, flows, issuesOf, segmentsOf, nodesOf, levelAt, levelOf };
}

/** The subject's elements, filtered by `keep`, with every fact the encodings read. */
export function sceneOf(
  index: DuctIndex,
  group: string,
  keepLevel: (levelId: number | null) => boolean,
): Scene {
  const pressure = pressurePoints(index.snapshot, group);
  const segments: SegmentFacts[] = (index.segmentsOf.get(group) ?? [])
    .filter((segment) => keepLevel(segment.levelId ?? null))
    .map((segment) => ({
      segment,
      derivedCfm: index.flows.get(segment.id) ?? null,
      issues: index.issuesOf.get(segment.id) ?? [],
      pressure: pressure.get(segment.id),
    }));
  const nodes: NodeFacts[] = (index.nodesOf.get(group) ?? [])
    .filter((node) => keepLevel(node.levelId ?? null))
    .map((node) => ({
      node,
      issues: index.issuesOf.get(node.id) ?? [],
      pressure: pressure.get(node.id),
    }));
  const issues = group
    ? index.snapshot.issues.filter(
        (issue) => issue.groupId === group && issue.point && keepLevel(index.levelOf(issue)),
      )
    : [];
  const context = (index.snapshot.context ?? [])
    .filter((level) => keepLevel(level.levelId ?? null))
    .map((level) => level.polylines.map((polyline) => ({ polyline })));
  return { segments, nodes, issues, context };
}

/** What a view hands the drawing and the band. */
export interface SpatialView {
  label: string;
  project: (point: readonly number[]) => readonly [number, number];
  scene: Scene;
  fitKey: string;
  onDrag?: (dx: number, dy: number, shift: boolean) => boolean;
  underlay?: Parameters<typeof DuctDrawing>[0]["underlay"];
  /** The view's own words and controls, first in the band. */
  band: ReactNode;
}
