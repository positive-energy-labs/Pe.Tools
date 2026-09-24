/**
 * `/schedules`' stages, declared once: which verbs each stage's row draws, the chords they bind,
 * and which panes it shows. The workspace and the entity view draw from this, never beside it.
 */
import type { ScheduleCatalog } from "@pe/agent-contracts";
import type { Rung } from "#/route/ladder";
import type { EntityAction, EntityReading, EntityStage } from "#/route/manifest";
import type { PaneDecl, StageDecl } from "#/route/stage";
import type { ScheduleGridAction, ScheduleGridReading } from "./manifest";
import type { ScheduleGridState } from "./workspace";

type R = ScheduleGridReading | EntityReading;
type A = ScheduleGridAction | EntityAction;
type Pane = "list" | "grid" | "spec";

// The schedule list is the Situation ladder's last rung, not a pane; it re-lists as it opens.
const list: PaneDecl<R, A> = { draws: ["catalog"], verbs: [] };
const grid: PaneDecl<R, A> = {
  draws: ["work", "saved", "receipts"],
  verbs: ["stage", "unstage", "accept", "deny"],
  // The grid's read files a capture, so it is the hidden `read` verb the pane runs (ruled 2026-09-22).
  reads: "read",
};
// Revealing this pane moves no focus (ledger 2026-09-22).
const spec: PaneDecl<R, A> = { draws: ["pods"], verbs: ["save"] };

// Apply binds Mod+Enter, the one chord that writes to Revit (ledger 2026-09-22), in the stage node
// (`route/keys.tsx` `stageChords`), so it is live only while a stage of this route draws.
const keys = { apply: "Mod+Enter" } as const;

export const SCHEDULE_STAGES: Readonly<Record<EntityStage, StageDecl<R, A, Pane>>> = {
  audit: { verbs: ["capture"], keys, panes: { list, grid }, meter: false },
  apply: { verbs: ["apply"], keys, panes: { list, grid, spec }, meter: false },
  archived: { verbs: [], keys: {}, panes: {}, meter: false },
};

/**
 * The sentence ladder's last rung: every schedule in the document, by category. A pick runs the
 * hidden `read`: a schedule's workspace id is minted by its first read, and the Readings follow it.
 */
export const scheduleRung = (
  catalog: ScheduleCatalog | null,
  open: { scheduleId: number; scheduleName: string } | null,
  failure: string | undefined,
  execute: ScheduleGridState["execute"],
): Rung => ({
  key: "schedule",
  label: open?.scheduleName ?? null,
  placeholder: "choose a schedule",
  options:
    catalog?.schedules.map((entry) => ({
      id: String(entry.scheduleId),
      label: entry.name,
      group: entry.categoryName ?? "Other",
      // ponytail: Summary projection reports 0 rows for every schedule — show counts only when computed
      sub:
        [
          entry.rowCount > 0 ? `${entry.rowCount} rows` : null,
          entry.isPlacedOnSheet ? "on sheet" : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    })) ?? null,
  note: catalog ? "no schedules in the document" : (failure ?? "reading schedules…"),
  picked: (id) => id === String(open?.scheduleId),
  pick: (id) => {
    const entry = catalog?.schedules.find((row) => String(row.scheduleId) === id);
    if (entry) void execute("read", { scheduleId: entry.scheduleId });
  },
});
