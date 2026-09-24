import {
  applyPatches,
  scheduleGridRouteState,
  type RouteStatePatch,
  type ScheduleGridDocument,
} from "@pe/agent-contracts";

export interface ScheduleHistoryStep {
  before: ScheduleGridDocument;
  after: ScheduleGridDocument;
  forward: RouteStatePatch[];
  inverse: RouteStatePatch[];
}

export interface ScheduleHistory {
  scope: string;
  revision: number | null;
  undo: ScheduleHistoryStep[];
  redo: ScheduleHistoryStep[];
  pending: ScheduleHistoryStep[];
  replay: { step: ScheduleHistoryStep; direction: "undo" | "redo" } | null;
}

/** Restore only the cells and basis metadata this batch touched. */
export function scheduleHistoryStep(
  before: ScheduleGridDocument,
  patches: RouteStatePatch[],
): ScheduleHistoryStep | null {
  const projected = applyPatches(
    scheduleGridRouteState,
    { version: 1, revision: 0, doc: before },
    "human",
    patches,
    0,
  );
  if (!projected.ok) return null;
  const paths = new Map<string, (string | number)[]>();
  for (const patch of patches) {
    const path =
      patch.path[0] === "cells" && patch.path.length > 1
        ? patch.path.slice(0, 2)
        : patch.path.slice(0, 1);
    paths.set(JSON.stringify(path), path);
  }
  const inverse = [...paths.values()].map((path) => {
    let value: unknown = before;
    for (const part of path) value = (value as Record<string, unknown> | null)?.[part];
    return value === undefined ? { path } : { path, value };
  });
  return { before, after: projected.envelope.doc, forward: patches, inverse };
}

export const sameScheduleDoc = (a: ScheduleGridDocument | null, b: ScheduleGridDocument) =>
  a != null && JSON.stringify(a) === JSON.stringify(b);

/** False means another writer or basis change moved Work; discard local history. */
export function advanceScheduleHistory(
  history: ScheduleHistory,
  doc: ScheduleGridDocument | null,
  revision: number | null,
): boolean {
  if (revision === history.revision) return true;
  const replay = history.replay;
  if (
    replay &&
    history.revision != null &&
    revision === history.revision + 1 &&
    sameScheduleDoc(doc, replay.direction === "undo" ? replay.step.before : replay.step.after)
  ) {
    if (replay.direction === "undo") {
      history.undo.pop();
      history.redo.push(replay.step);
    } else {
      history.redo.pop();
      history.undo.push(replay.step);
    }
    history.replay = null;
    history.revision = revision;
    return true;
  }
  const landed = history.pending.findIndex((step) => sameScheduleDoc(doc, step.after));
  if (landed < 0 || revision !== (history.revision ?? 0) + landed + 1) return false;
  history.undo.push(...history.pending.splice(0, landed + 1));
  if (history.undo.length > 30) history.undo.splice(0, history.undo.length - 30);
  history.redo = [];
  history.revision = revision;
  return true;
}
