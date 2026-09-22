/**
 * `/schedules`' stages, declared once: which verbs each stage's row draws, the chords they bind,
 * and which panes it shows. The workspace and the entity view draw from this, never beside it.
 */
import type { EntityAction, EntityReading, EntityStage } from "#/route/manifest";
import type { PaneDecl, StageDecl } from "#/route/stage";
import type { ScheduleGridAction, ScheduleGridReading } from "./manifest";

type R = ScheduleGridReading | EntityReading;
type A = ScheduleGridAction | EntityAction;
type Pane = "rail" | "grid" | "spec";

const rail: PaneDecl<R, A> = {
  draws: ["catalog"],
  verbs: [],
};
const grid: PaneDecl<R, A> = {
  draws: ["work", "saved", "receipts"],
  verbs: ["stage", "unstage", "accept", "deny"],
  // ASSUME(kai): the grid's read files a capture, so it is the `refresh` verb run by the pane |
  // alt: a host Reading "latest capture of schedule X" (NEEDS-CONTRACT)
  reads: "refresh",
  keys: { r: "refresh" },
};
// ASSUME(kai): focus jumps to a revealed sheet (Q3) | alt: focus stays on the verb row
const spec: PaneDecl<R, A> = { draws: ["pods"], verbs: ["save"] };

/** ASSUME(kai): push is a stage verb (Q6) | alt: a grid pane verb */
const verbs: readonly A[] = ["push", "capture", "apply"];
// ASSUME(kai): push binds Mod+Enter | alt: no chord for a write to Revit
const keys = { push: "Mod+Enter" } as const;

export const SCHEDULE_STAGES: Readonly<Record<EntityStage, StageDecl<R, A, Pane>>> = {
  audit: { verbs, keys, panes: { rail, grid } },
  capture: { verbs, keys, panes: { rail, grid, spec } },
  apply: { verbs, keys, panes: { rail, grid, spec } },
};
