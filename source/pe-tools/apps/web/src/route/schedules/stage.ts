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

/**
 * A read older than this is stale: the grid says its age and offers "read again (r)".
 * ASSUME(kai): stale after 60 s | alt: 300 s, as the /families matrix
 * ASSUME(kai): no Revit DocumentChanged mark yet (the C# notifier drops its trailing edge); this
 * visible age is the guard | alt: the host marks the drawn Reading stale on DocumentChanged
 */
export const STALE_S = 60;

const rail: PaneDecl<R, A> = {
  draws: ["catalog"],
  verbs: [],
  // ASSUME(kai): a read is not a verb button (Q1); the rail re-lists on focus | alt: a "re-list" button
  onFocus: "fresh",
};
const grid: PaneDecl<R, A> = {
  draws: ["work", "saved", "receipts"],
  verbs: ["stage", "unstage", "accept", "deny"],
  // ASSUME(kai): focus re-reads a grid older than STALE_S | alt: "fresh", every focus. "fresh"
  // crashed the route after ~24 reads: each read is a new `saved` subject and the page's Reading
  // subscriptions leak past READING_MAX_KEYS (32); the base's re-read button leaks the same way.
  // ASSUME(kai): a focused grid is marked stale by age, never re-read under the hands (Q5) | alt: a
  // silent re-read that moves cells while you type
  onFocus: { maxAgeS: STALE_S },
  // ASSUME(kai): the grid's read files a capture, so it is the `refresh` verb run by the pane |
  // alt: a host Reading "latest capture of schedule X" (NEEDS-CONTRACT)
  reads: "refresh",
  keys: { r: "refresh" },
};
// ASSUME(kai): focus jumps to a revealed sheet (Q3) | alt: focus stays on the verb row
const spec: PaneDecl<R, A> = { draws: ["pods"], verbs: ["save"], onFocus: "as-is" };

/** ASSUME(kai): push is a stage verb (Q6) | alt: a grid pane verb */
const verbs: readonly A[] = ["push", "capture", "apply"];
// ASSUME(kai): push binds Mod+Enter | alt: no chord for a write to Revit
const keys = { push: "Mod+Enter" } as const;

export const SCHEDULE_STAGES: Readonly<Record<EntityStage, StageDecl<R, A, Pane>>> = {
  audit: { verbs, keys, panes: { rail, grid } },
  capture: { verbs, keys, panes: { rail, grid, spec } },
  apply: { verbs, keys, panes: { rail, grid, spec } },
};
