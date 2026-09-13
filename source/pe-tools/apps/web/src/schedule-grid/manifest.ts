/**
 * The Schedule Grid route, declared once. Its three subjects are the one `schedule-grid-reading`
 * kind narrowed by `subject`: the schedule catalogue, the workspace's staged Work, and the saved
 * capture the staged cells are bound to. The three actions are the three the workspace already
 * had (`schedule-grid/workspace.tsx`'s `execute`), and the surface binds them to the live
 * workspace by re-deriving the manifest with `deps`. No seeds: this route reads Revit or nothing.
 */
import { z } from "zod";

import { defineRoute, type RouteManifest } from "#/route";

export type ScheduleGridReading = "catalog" | "work" | "saved";

/** What the Page holds: which workspace is open and which capture it last read. */
export interface ScheduleGridPage {
  workspaceId: string;
  captureId: string;
}

const scheduleGridPage = z.object({
  workspaceId: z.string().default(""),
  captureId: z.string().default(""),
});

/** What the route needs from the live surface to run its actions. */
export interface ScheduleGridRouteDeps {
  workspaceId?: string;
  captureId?: string;
  /** Why a push is refused right now, as the workspace already computes it. */
  blockedBecause?: string | null;
  execute?: (
    kind: "catalog" | "refresh" | "push",
    input?: Record<string, unknown>,
  ) => Promise<unknown>;
}

type ScheduleGridAction = "catalog" | "refresh" | "push";

export const scheduleGridManifest = (
  deps: ScheduleGridRouteDeps = {},
): RouteManifest<never, ScheduleGridReading, ScheduleGridPage, ScheduleGridAction> =>
  defineRoute<never, ScheduleGridReading, ScheduleGridPage, ScheduleGridAction>({
    key: "schedule-grid",
    name: "Schedule Grid",
    // One open project document at a time: a schedule address only exists under a bound document.
    needs: "project",
    readings: {
      /** Every schedule the bound document offers. */
      catalog: { kind: "schedule-grid-reading", subject: "catalog" },
      /** The staged edits for the open workspace. */
      work: {
        kind: "schedule-grid-reading",
        subject: "work",
        ...(deps.workspaceId ? { id: deps.workspaceId } : {}),
      },
      /** The immutable capture the staged cells were read from. */
      saved: {
        kind: "schedule-grid-reading",
        subject: "saved",
        ...(deps.captureId ? { id: deps.captureId } : {}),
      },
    },
    page: scheduleGridPage,
    actions: {
      catalog: {
        label: "list schedules",
        says: "reads the bound document's schedule catalogue again",
        needs: "document",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["catalog"],
        ready: () => (deps.execute ? null : "the schedule grid is not mounted"),
        run: async () => {
          await deps.execute?.("catalog", {});
        },
      },
      refresh: {
        label: "read schedule",
        says: "reads the selected schedule from Revit into a fresh capture",
        needs: "document",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["work", "saved"],
        ready: () => (deps.execute ? null : "the schedule grid is not mounted"),
        run: async () => {
          await deps.execute?.("refresh", {});
        },
      },
      push: {
        label: "push",
        says: "writes the staged cells back to the bound schedule under one action receipt",
        needs: "document",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["work", "saved"],
        ready: () =>
          deps.execute
            ? (deps.blockedBecause ?? null)
            : "the schedule grid is not mounted",
        run: async () => {
          await deps.execute?.("push", {});
        },
      },
    },
  });
