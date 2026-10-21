/**
 * The /ducts scene: the snapshot indexed once per read, and the subject's elements with every fact
 * the encodings read. Both spatial views scope through `sceneOf`; only the level filter and the
 * context they hand it differ.
 */
import type { ReactNode } from "react";

import type { DuctDrawing, NodeFacts, Scene } from "./drawing";
import type { DuctNode, Issue, Segment, SegmentFacts } from "./encoding";
import type { Claim, Leg, Place, SubjectCut } from "./legs";
import type { LossResult } from "@pe/ducts-domain/losses";
import type { Priced } from "@pe/ducts-domain/pricing";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

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
  /** Pe's loss per element, in-wg, from `lossesOf`; empty until the tables are read. */
  loss: ReadonlyMap<number, number>;
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * Pe's loss per element from a priced result. Every terminal path repeats the rows it shares, so
 * rows are counted once by (element, kind, leg, desc): a duct's friction intervals add, while a
 * fitting's or terminal's legs are alternatives and show the largest.
 */
export function lossesOf(result: LossResult): Map<number, number> {
  const unique = new Map<string, LossResult["paths"][number]["rows"][number]>();
  for (const path of Object.values(result.paths))
    for (const row of path.rows)
      unique.set(`${row.id}|${row.kind}|${row.leg ?? ""}|${row.desc}`, row);
  const losses = new Map<number, number>();
  for (const row of unique.values()) {
    if (row.dp == null) continue;
    const was = losses.get(row.id);
    losses.set(row.id, row.kind === "friction" ? (was ?? 0) + row.dp : Math.max(was ?? 0, row.dp));
  }
  return losses;
}

export function indexOf(snapshot: DuctSnapshot, priced: Priced | null = null): DuctIndex {
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
  const loss = priced ? lossesOf(priced.next) : new Map<number, number>();
  return { snapshot, levels, flows, issuesOf, segmentsOf, nodesOf, levelAt, levelOf, loss };
}

export interface ContextLevel {
  levelId: number | null;
  polylines: readonly Pick<Segment, "polyline">[];
}

/**
 * The faint rest of the document, per level: every segment outside `groups` of 2 ft or more that
 * `keep` allows, cut to at most eight points (evenly along it, 0.01 ft). With no group chosen and
 * no `keep`, all of it.
 */
export function contextOf(
  index: DuctIndex,
  groups: readonly string[],
  keep: (segment: Segment) => boolean = () => true,
): ContextLevel[] {
  const byLevel = new Map<number | null, Pick<Segment, "polyline">[]>();
  const drawn = new Set(groups);
  for (const segment of index.snapshot.segments) {
    if (drawn.has(segment.groupId ?? "") || segment.lengthFt < 2 || !keep(segment)) continue;
    const last = segment.polyline.length - 1;
    const count = Math.min(segment.polyline.length, 8);
    const polyline = Array.from({ length: count }, (_, i) =>
      segment.polyline[count < 2 ? 0 : Math.floor((i * last) / (count - 1))]!.map(
        (v) => Math.round(v * 100) / 100,
      ),
    );
    push(byLevel, segment.levelId ?? null, { polyline });
  }
  return [...byLevel].map(([levelId, polylines]) => ({ levelId, polylines }));
}

const pointOf = (index: DuctIndex, id: number) =>
  index.loss.has(id) ? { drop: index.loss.get(id)! } : undefined;

/** The groups' elements (a system's: every group it is in), filtered by `keep`, with every fact the encodings read. */
export function sceneOf(
  index: DuctIndex,
  groups: readonly string[],
  keepLevel: (levelId: number | null) => boolean,
): Scene {
  const segments: SegmentFacts[] = groups
    .flatMap((group) => index.segmentsOf.get(group) ?? [])
    .filter((segment) => keepLevel(segment.levelId ?? null))
    .map((segment) => ({
      segment,
      derivedCfm: index.flows.get(segment.id) ?? null,
      issues: index.issuesOf.get(segment.id) ?? [],
      pressure: pointOf(index, segment.id),
    }));
  // A unit roots every group its ports reach: drawn once.
  const nodes: NodeFacts[] = [
    ...new Map(
      groups.flatMap((group) => index.nodesOf.get(group) ?? []).map((node) => [node.id, node]),
    ).values(),
  ]
    .filter((node) => keepLevel(node.levelId ?? null))
    .map((node) => ({
      node,
      issues: index.issuesOf.get(node.id) ?? [],
      pressure: pointOf(index, node.id),
    }));
  const drawn = new Set(groups);
  const issues = index.snapshot.issues.filter(
    (issue) =>
      issue.groupId != null &&
      drawn.has(issue.groupId) &&
      issue.point &&
      keepLevel(index.levelOf(issue)),
  );
  const context = contextOf(index, groups)
    .filter((level) => keepLevel(level.levelId))
    .map((level) => level.polylines);
  return { segments, nodes, issues, context };
}

/** The subject scene's authored layers, resolved against the facts, as the drawing reads them. */
export interface SubjectDrawn {
  cut: SubjectCut;
  claims: readonly Claim[];
  /** The leg each subject element lies on. */
  legOf: ReadonlyMap<number, Leg>;
  /** The place at an element id (the first, where a level crossing and a node share one). */
  placeOf: ReadonlyMap<number, Place>;
  /** A model point for any subject id: a node's point or a segment's middle vertex; null if unknown. */
  pointOf: (id: number) => number[] | null;
  /** Each gap with the model points it spans: the end of `after`, the start of `before`. */
  gaps: readonly { after: number; before: number; from: number[]; to: number[] }[];
  /** Each break a proximity inference bridges, spanning the same points a gap would. */
  inferred: readonly (SubjectCut["inferred"][number] & { from: number[]; to: number[] })[];
  /** Each omission with one model polyline from `after` through the skipped elements to `before`. */
  omissions: readonly { after: number; before: number; skipped: number[]; line: number[][] }[];
  /** The levels the subject touches, lowest first. */
  levels: readonly Level[];
  /** Each subject element's level id (null when the snapshot names none). */
  levelAt: ReadonlyMap<number, number | null>;
}

/** Faint context stays this far (ft) around the subject's bounding box. */
export const CONTEXT_PAD_FT = 20;

const within = (box: readonly [number[], number[]], point: readonly number[]) =>
  point[0]! >= box[0][0]! &&
  point[0]! <= box[1][0]! &&
  point[1]! >= box[0][1]! &&
  point[1]! <= box[1][1]!;

/**
 * The subject scene: the ordered ids' elements from `snapshotById`, no group, with the cut and
 * claims the drawing pins. Context is never the whole document (a 9 MB draw on Chadds): only
 * segments on the levels the subject touches, within its bounding box padded `CONTEXT_PAD_FT`.
 */
export function subjectScene(
  index: DuctIndex,
  ids: readonly number[],
  cut: SubjectCut,
  claims: readonly Claim[] = [],
): Scene {
  const { nodes: nodeById, segments: segmentById } = snapshotById(index.snapshot);
  const own = new Set(ids);
  const legOf = new Map<number, Leg>();
  for (const leg of cut.legs) for (const id of leg.ids) legOf.set(id, leg);
  const placeOf = new Map<number, Place>();
  for (const place of cut.nodes) if (!placeOf.has(place.id)) placeOf.set(place.id, place);
  const facts = (id: number) => ({
    issues: index.issuesOf.get(id) ?? [],
    pressure: pointOf(index, id),
    leg: legOf.get(id) ?? null,
  });
  const segments: SegmentFacts[] = ids.flatMap((id) => {
    const segment = segmentById.get(id);
    return segment
      ? [{ segment, derivedCfm: index.flows.get(segment.id) ?? null, ...facts(id) }]
      : [];
  });
  const nodes: NodeFacts[] = ids.flatMap((id) => {
    const node = nodeById.get(id);
    return node ? [{ node, ...facts(id) }] : [];
  });
  const point = (id: number): number[] | null => {
    const node = nodeById.get(id);
    if (node) return node.point;
    const line = segmentById.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };
  const points = [
    ...segments.flatMap((f) => f.segment.polyline),
    ...nodes.map((f) => f.node.point),
  ];
  const levelAt = new Map<number, number | null>([
    ...segments.map((f) => [f.segment.id, f.segment.levelId ?? null] as const),
    ...nodes.map((f) => [f.node.id, f.node.levelId ?? null] as const),
  ]);
  const levels = new Set(levelAt.values());
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const p of points)
    for (let i = 0; i < 2; i++) {
      lo[i] = Math.min(lo[i]!, p[i]!);
      hi[i] = Math.max(hi[i]!, p[i]!);
    }
  const box = [lo.map((v) => v - CONTEXT_PAD_FT), hi.map((v) => v + CONTEXT_PAD_FT)] as const;
  const context = points.length
    ? contextOf(
        index,
        [],
        (segment) =>
          !own.has(segment.id) &&
          levels.has(segment.levelId ?? null) &&
          segment.polyline.some((p) => within(box, p)),
      ).map((level) => level.polylines)
    : [];
  const span = <T extends { after: number; before: number }>(item: T) => {
    const from = segmentById.get(item.after)?.polyline.at(-1) ?? nodeById.get(item.after)?.point;
    const to = segmentById.get(item.before)?.polyline[0] ?? nodeById.get(item.before)?.point;
    return from && to ? [{ ...item, from, to }] : [];
  };
  const gaps = cut.gaps.flatMap(span);
  const inferred = cut.inferred.flatMap(span);
  // Each skipped segment runs from whichever end is nearer the point before it.
  const omissions = cut.omissions.map(({ after, before, skipped }) => {
    const line: number[][] = [];
    const near = (p: number[]) => {
      const last = line.at(-1);
      return last ? Math.hypot(...p.map((v, i) => v - last[i]!)) : 0;
    };
    for (const id of [after, ...skipped, before]) {
      const poly = segmentById.get(id)?.polyline;
      const node = nodeById.get(id)?.point;
      if (poly?.length)
        line.push(...(near(poly.at(-1)!) < near(poly[0]!) ? [...poly].reverse() : poly));
      else if (node) line.push(node);
    }
    return { after, before, skipped, line };
  });
  return {
    segments,
    nodes,
    issues: [],
    context,
    subject: {
      cut,
      claims,
      legOf,
      placeOf,
      pointOf: point,
      gaps,
      inferred,
      omissions,
      levels: index.levels.filter((level) => levels.has(level.id)),
      levelAt,
    },
  };
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
