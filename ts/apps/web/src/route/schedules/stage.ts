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
  // A read is never a verb button: the rail re-lists on focus (ledger 2026-09-22).
};
const grid: PaneDecl<R, A> = {
  draws: ["work", "saved", "receipts"],
  verbs: ["stage", "unstage", "accept", "deny"],
  // ASSUME(kai): the grid's read files a capture, so it is the `refresh` verb run by the pane |
  // alt: a host Reading "latest capture of schedule X" (NEEDS-CONTRACT)
  reads: "refresh",
};
// Revealing this pane moves no focus (ledger 2026-09-22).
const spec: PaneDecl<R, A> = { draws: ["pods"], verbs: ["save"] };

const verbs: readonly A[] = ["push", "capture", "apply"];
// Push binds Mod+Enter — the one chord that writes to Revit (ledger 2026-09-22).
const keys = { push: "Mod+Enter" } as const;
// Push is a stage verb: the stage node binds this chord (`route/keys.tsx` `StageKeys`), so it is
// live only while a stage of this route draws, and the manifest carries no chord for it.

export const SCHEDULE_STAGES: Readonly<Record<EntityStage, StageDecl<R, A, Pane>>> = {
  audit: { verbs, keys, panes: { rail, grid } },
  capture: { verbs, keys, panes: { rail, grid, spec } },
  apply: { verbs, keys, panes: { rail, grid, spec } },
};
