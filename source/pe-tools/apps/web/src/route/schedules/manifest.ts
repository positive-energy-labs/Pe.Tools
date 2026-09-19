import { z } from "zod";
import {
  scheduleGridRouteState,
  scheduleReadingSchema,
  scheduleReads,
  type ActionStatus,
  type ScheduleGridDocument,
  type WorkKey,
} from "@pe/agent-contracts";

import {
  entityRoute,
  refuse,
  HOST_READ_WAIT_S,
  NATIVE_APPLY_WAIT_S,
  semanticActionFacts,
  semanticActionInputSchema,
  type Ctx as RouteCtx,
  type EntityRouteDef,
} from "#/route";
import { previousOf } from "#/readings";
import { DEMO_PODS, DEMO_SPEC_PATH } from "#/route/seeds";
import { readScheduleCapture } from "../../../../../packages/mcps/src/shared/schedule-client";
import {
  actionResult,
  runSemanticAction,
} from "../../../../../packages/mcps/src/shared/takeoff-action-client";

export type ScheduleGridReading = "catalog" | "work" | "saved" | "receipts";
export type ScheduleGridAction = "catalog" | "refresh" | "push";

/** Route-owned identity discovered by a schedule read. */
export interface ScheduleGridPage {
  workspaceId: string;
  captureId: string;
  /** The last push's run, as one line: outcome, where its receipt lives, cells before → after. */
  pushRun: string;
}

const scheduleGridPage = z.object({
  workspaceId: z.string().default(""),
  captureId: z.string().default(""),
  pushRun: z.string().default(""),
});

type Ctx = RouteCtx<ScheduleGridDocument, ScheduleGridReading, ScheduleGridPage>;

type PushReceipt = {
  podId: string | null;
  outcome: string;
  cells: { cell: string; before: string | null; after: string | null; error?: string | null }[];
};
/**
 * The run's word, from its cells: the host's receipt says "Failed" for any refused cell even when
 * others were written (F-S-1, NEEDS-CONTRACT), so a mixed push reads "Partly applied" here.
 */
const pushWord = (receipt: PushReceipt) => {
  const refused = receipt.cells.filter((cell) => cell.error).length;
  if (!refused) return receipt.outcome;
  return refused === receipt.cells.length ? "Refused" : "Partly applied";
};
export const pushRunLine = (receipt: PushReceipt, run?: string | null) =>
  [
    pushWord(receipt),
    receipt.podId && run
      ? `${receipt.podId} · ${run}/receipt.json`
      : "action receipt (no pod bound)",
    receipt.cells.map((c) => `${c.cell} ${c.before ?? "?"} → ${c.after ?? "?"}`).join(", "),
  ].join(" · ");

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("Select an exact available document lifetime");
  return ctx.target.ref;
};

const statuses = (ctx: Ctx): ActionStatus[] =>
  (previousOf(ctx.readings.receipts) as ActionStatus[] | undefined) ?? [];

/** `/schedules`, declared once: the grid is the audit, `push` writes cells, `apply` writes a spec. */
export const scheduleSpec: EntityRouteDef<
  ScheduleGridDocument,
  ScheduleGridReading,
  ScheduleGridPage
> = {
  key: scheduleGridRouteState.route,
  name: "Schedules",
  entity: "schedule",
  target: "document",
  schema: "/schemas/settings/CmdScheduleManager/schedules.json",
  capture: "schedule.capture",
  apply: "schedule.apply",
  applies: ["catalog"],
  captureInput: (ctx) => {
    const reading = previousOf(ctx.readings.work);
    return reading === undefined
      ? "open a schedule in the grid first"
      : { scheduleId: scheduleReadingSchema.parse(reading).snapshot.scheduleId };
  },
  docs: "Audit a project schedule as a grid and push staged cell values, capture its definition into a pod as a spec, or apply a saved spec as a new schedule.",
};

export const schedulesManifest = () =>
  entityRoute<ScheduleGridDocument, ScheduleGridReading, ScheduleGridPage, ScheduleGridAction>(
    scheduleSpec,
    {
      work: scheduleGridRouteState,
      readings: {
        catalog: {
          kind: "schedule-reading",
          subject: "catalog",
          target: { session: "", openId: "" },
        },
        work: (page: ScheduleGridPage) =>
          page.workspaceId
            ? { kind: "schedule-reading", subject: "work", id: page.workspaceId }
            : null,
        saved: (page: ScheduleGridPage) =>
          page.captureId
            ? { kind: "schedule-reading", subject: "saved", id: page.captureId }
            : null,
        receipts: (page: ScheduleGridPage) =>
          page.workspaceId
            ? {
                kind: "receipts",
                scope: { kind: "schedules", workspaceId: page.workspaceId },
              }
            : null,
      },
      page: scheduleGridPage,
      actions: {
        catalog: {
          label: "list schedules",
          waitSeconds: HOST_READ_WAIT_S,
          says: "reads the bound document's schedule catalogue again",
          needs: "document",
          actor: "any",
          input: scheduleReads["schedule.grid.catalog"].input as unknown as z.ZodType<never>,
          stage: "audit",
          dirties: ["catalog"],
          ready: () => null,
          run: async () => {},
        },
        refresh: {
          label: "read schedule",
          waitSeconds: HOST_READ_WAIT_S,
          says: "reads the selected schedule from Revit into a fresh capture",
          needs: "document",
          actor: "any",
          input: scheduleReads["schedule.grid.snapshot"].input as unknown as z.ZodType<never>,
          stage: "audit",
          dirties: ["work", "saved"],
          ready: () => null,
          run: async (ctx: Ctx, input: Record<string, unknown>) => {
            const reading = scheduleReadingSchema.parse(
              await readScheduleCapture("schedule.grid.snapshot", input, targetOf(ctx)),
            );
            ctx.setPage({
              workspaceId: reading.workspaceId,
              captureId: reading.id,
            });
          },
        },
        push: {
          label: "push",
          waitSeconds: NATIVE_APPLY_WAIT_S,
          ...semanticActionFacts("schedule.grid.push"),
          input: semanticActionInputSchema("schedule.grid.push") as never,
          stage: "audit",
          dirties: ["work", "saved", "receipts"],
          requires: { work: true, readings: ["saved", "receipts"] },
          ready: (ctx: Ctx) =>
            statuses(ctx).some((row) => ["running", "unknown", "incomplete"].includes(row.state))
              ? "Recover or resume the original receipt before a new apply"
              : !ctx.page.workspaceId || !ctx.work.doc?.basis || ctx.work.revision === null
                ? "Review the exact schedule binding first"
                : null,
          run: async (ctx: Ctx) => {
            // The run lands in the pod the route has bound; with none, in the action receipt.
            const pod = (ctx.page as { pod?: string | null }).pod ?? undefined;
            const result = actionResult(
              await runSemanticAction("schedule.grid.push", pod ? { pod } : {}, targetOf(ctx), {
                work: { key: ctx.work.key as WorkKey, revision: ctx.work.revision! },
              }),
            ) as {
              readback?: unknown;
              applied?: number;
              failures?: { key: string; error: string }[];
              readbackError?: string;
              run?: string | null;
              receipt?: PushReceipt;
            };
            if (result.receipt) ctx.setPage({ pushRun: pushRunLine(result.receipt, result.run) });
            if (result.readback) {
              const reading = scheduleReadingSchema.parse(result.readback);
              ctx.setPage({
                workspaceId: reading.workspaceId,
                captureId: reading.id,
              });
            }
            if (result.readbackError) throw Error(result.readbackError);
            // Some cells landed and some were refused: an outcome, not a failure. Returned, so the
            // verb's dirties re-read the grid and the written cells show what Revit now holds.
            const failures = result.failures ?? [];
            if (!failures.length) return null;
            const first = `${failures[0]!.key}: ${failures[0]!.error}`;
            const written = result.applied ?? 0;
            return written
              ? refuse(
                  "partial",
                  `partly applied: ${written} written, ${failures.length} refused: ${first}`,
                )
              : refuse("not-ready", `refused — nothing ran: ${first}`);
          },
        },
      },
      seeds: SCHEDULE_SEEDS as never,
    },
  );

/* ── demo lane ─────────────────────────────────────────────────────────────── */

const DEMO_CAPTURE = "a".repeat(64);
const DEMO_TARGET = { session: "demo", openId: "demo-project" };
const DEMO_READING = {
  id: DEMO_CAPTURE,
  capturedAt: "2026-09-12T14:00:00Z",
  target: DEMO_TARGET,
  process: { pid: 4242, processStartUtc: "2026-09-12T13:00:00Z", executable: "Revit.exe" },
  document: "C:/Projects/Demo/Mech.rvt",
  workspaceId: "demo-schedule",
  snapshot: {
    scheduleId: 481223,
    scheduleName: "DX Fan Coil Unit Performance Schedule",
    columns: [
      { columnNumber: 0, headerText: "TAG", fieldName: "PE_G___TagInstance" },
      { columnNumber: 1, headerText: "REFRIGERANT", fieldName: "PE_G___RefrigerantType" },
      { columnNumber: 2, headerText: "NOTES", fieldName: "PE_G___NotesInstance" },
    ],
    rows: [
      { rowNumber: 1, values: ["IU-1", "R-410A", ""] },
      { rowNumber: 2, values: ["IU-2", "R-410A", "Ceiling cassette"] },
      { rowNumber: 3, values: ["IU-3", "R-32", ""] },
    ],
    takenAt: "2026-09-12T14:00:00Z",
  },
};
const DEMO_CATALOG = {
  schedules: [
    {
      scheduleId: 481223,
      name: "DX Fan Coil Unit Performance Schedule",
      categoryName: "Mechanical Equipment",
    },
    { scheduleId: 481310, name: "Air Terminal Schedule", categoryName: "Air Terminals" },
  ],
};

const demoSeed = (title: string, page: Record<string, unknown>) => ({
  title,
  target: { kind: "document", ref: DEMO_TARGET },
  work: {
    basis: { captureId: DEMO_CAPTURE },
    cells: { "3::1": { proposal: null, staged: { value: "R-454B" } } },
  },
  readings: { catalog: DEMO_CATALOG, work: DEMO_READING, saved: DEMO_READING, pods: DEMO_PODS },
  page: { workspaceId: "demo-schedule", captureId: DEMO_CAPTURE, target: DEMO_TARGET, ...page },
});

/** `?demo=push` audits the grid; `?demo=apply` opens a saved spec beside it. */
export const SCHEDULE_SEEDS = {
  push: demoSeed("a schedule in the grid with one staged cell", { stage: "audit" }),
  apply: demoSeed("a saved schedule spec beside the grid", {
    stage: "apply",
    pod: "mech-standards",
    path: DEMO_SPEC_PATH,
  }),
};
