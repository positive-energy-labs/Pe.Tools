import { z } from "zod";
import {
  scheduleGridRouteState,
  scheduleReadingSchema,
  scheduleReads,
  documentRefSchema,
  type ActionStatus,
  type ScheduleGridDocument,
  type WorkKey,
} from "@pe/agent-contracts";

import {
  defineRoute,
  semanticActionFacts,
  semanticActionInputSchema,
  type Ctx as RouteCtx,
} from "#/route";
import { previousOf } from "#/readings";
import { readScheduleCapture } from "../../../../packages/mcps/src/shared/schedule-client";
import {
  actionResult,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

export type ScheduleGridReading = "catalog" | "work" | "saved" | "receipts";
export type ScheduleGridAction = "catalog" | "refresh" | "push";

/** Route-owned identity discovered by a schedule read. */
export interface ScheduleGridPage {
  workspaceId: string;
  captureId: string;
  target: z.infer<typeof documentRefSchema> | null;
}

const scheduleGridPage = z.object({
  workspaceId: z.string().default(""),
  captureId: z.string().default(""),
  target: documentRefSchema.nullable().default(null),
});

type Ctx = RouteCtx<ScheduleGridDocument, ScheduleGridReading, ScheduleGridPage>;

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("Select an exact available document lifetime");
  return ctx.target.ref;
};

const statuses = (ctx: Ctx): ActionStatus[] =>
  (previousOf(ctx.readings.receipts) as ActionStatus[] | undefined) ?? [];

export const scheduleGridManifest = () =>
  defineRoute<ScheduleGridDocument, ScheduleGridReading, ScheduleGridPage, ScheduleGridAction>({
    key: "schedule-grid",
    name: "Schedule Grid",
    docs: "Read the project schedule catalog, select a schedule to stage its grid, then review and push the approved edits to Revit.",
    work: scheduleGridRouteState,
    needs: "project",
    readings: {
      catalog: {
        kind: "schedule-grid-reading",
        subject: "catalog",
        target: { session: "", openId: "" },
      },
      work: (page: ScheduleGridPage) =>
        page.workspaceId
          ? { kind: "schedule-grid-reading", subject: "work", id: page.workspaceId }
          : null,
      saved: (page: ScheduleGridPage) =>
        page.captureId
          ? { kind: "schedule-grid-reading", subject: "saved", id: page.captureId }
          : null,
      receipts: (page: ScheduleGridPage) =>
        page.workspaceId
          ? {
              kind: "receipts",
              scope: { kind: "schedule-grid", workspaceId: page.workspaceId },
            }
          : null,
    },
    page: scheduleGridPage,
    actions: {
      catalog: {
        label: "list schedules",
        says: "reads the bound document's schedule catalogue again",
        needs: "document",
        actor: "any",
        input: scheduleReads["schedule-grid.catalog"].input as unknown as z.ZodType<never>,
        dirties: ["catalog"],
        ready: () => null,
        run: async () => {},
      },
      refresh: {
        label: "read schedule",
        says: "reads the selected schedule from Revit into a fresh capture",
        needs: "document",
        actor: "any",
        input: scheduleReads["schedule-grid.snapshot"].input as unknown as z.ZodType<never>,
        dirties: ["work", "saved"],
        ready: () => null,
        run: async (ctx: Ctx, input: Record<string, unknown>) => {
          const reading = scheduleReadingSchema.parse(
            await readScheduleCapture("schedule-grid.snapshot", input, targetOf(ctx)),
          );
          ctx.setPage({
            workspaceId: reading.workspaceId,
            captureId: reading.id,
            target: reading.target,
          });
        },
      },
      push: {
        label: "push",
        ...semanticActionFacts("schedule-grid.apply"),
        input: semanticActionInputSchema("schedule-grid.apply") as never,
        dirties: ["work", "saved", "receipts"],
        requires: { work: true, readings: ["saved", "receipts"] },
        ready: (ctx: Ctx) =>
          statuses(ctx).some((row) => ["running", "unknown", "incomplete"].includes(row.state))
            ? "Recover or resume the original receipt before a new apply"
            : !ctx.page.workspaceId || !ctx.work.doc?.basis || ctx.work.revision === null
              ? "Review the exact schedule binding first"
              : null,
        run: async (ctx: Ctx) => {
          const result = actionResult(
            await runSemanticAction("schedule-grid.apply", {}, targetOf(ctx), {
              work: { key: ctx.work.key as WorkKey, revision: ctx.work.revision! },
            }),
          ) as {
            readback?: unknown;
            failures?: { key: string; error: string }[];
            readbackError?: string;
          };
          if (result.readback) {
            const reading = scheduleReadingSchema.parse(result.readback);
            ctx.setPage({
              workspaceId: reading.workspaceId,
              captureId: reading.id,
              target: reading.target,
            });
          }
          if (result.failures?.length || result.readbackError)
            throw Error(
              [
                ...(result.failures ?? []).map((failure) => `${failure.key}: ${failure.error}`),
                result.readbackError,
              ]
                .filter(Boolean)
                .join("; "),
            );
        },
      },
    },
  });
