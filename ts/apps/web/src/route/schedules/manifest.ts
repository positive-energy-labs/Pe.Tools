import { z } from "zod";
import {
  canonicalRouteInput,
  rebindScheduleWork,
  scheduleGridRouteState,
  scheduleReadingSchema,
  scheduleReads,
  semanticActions,
  splitScheduleCellKey,
  stagedEntries,
  type ActionStatus,
  type ScheduleGridDocument,
  type WorkKey,
} from "@pe/agent-contracts";

import {
  entityRoute,
  refuse,
  HOST_READ_WAIT_S,
  NATIVE_APPLY_WAIT_S,
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
export type ScheduleGridAction = "refresh" | "push";

/** Route-owned identity discovered by a schedule read. */
export interface ScheduleGridPage {
  workspaceId: string;
  captureId: string;
  /** Cells the last push refused as stale while its readback failed: no C to draw, read again. */
  unread: number;
  /** The last push's refused cells, by key, in the host's words; each draws on its cell. */
  refused: Record<string, string>;
}

const scheduleGridPage = z.object({
  workspaceId: z.string().default(""),
  captureId: z.string().default(""),
  unread: z.number().default(0),
  refused: z.record(z.string(), z.string()).default({}),
});

type Ctx = RouteCtx<ScheduleGridDocument, ScheduleGridReading, ScheduleGridPage>;

const REFUSAL_WORD: Record<string, string> = {
  "stale-staged-cell": "stale",
  "target-evidence-stale": "stale",
};
/** A refused cell's note: its code's word, or the error's first clause when it carries no code. */
const refusalNote = (f: { error: string; code?: string }) =>
  f.code ? (REFUSAL_WORD[f.code] ?? f.code) : f.error.split(": ")[0]!;

/** A cell as the person reads it: its column header and row. */
const cellLabel = (ctx: Ctx, key: string) => {
  const { rowNumber, columnNumber } = splitScheduleCellKey(key);
  const shown = scheduleReadingSchema.safeParse(previousOf(ctx.readings.saved));
  const header = shown.success
    ? shown.data.snapshot.columns.find((c) => c.columnNumber === columnNumber)?.headerText
    : undefined;
  return `${header ?? `col ${columnNumber}`} · row ${rowNumber}`;
};

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("Select an exact available document lifetime");
  return ctx.target.ref;
};

/** The Work's basis reading, when the Page holds it (`live.tsx` pins `captureId` to the basis). */
const basisOf = (ctx: Ctx) => {
  const saved = scheduleReadingSchema.safeParse(previousOf(ctx.readings.saved));
  return saved.success && saved.data.id === ctx.work.doc?.basis?.captureId ? saved.data : null;
};
/** F-H5-1: a Work bound to a closed document lifetime; the way out is a re-read, which rebinds. */
const REOPENED =
  "Re-opened in Revit since this was staged: read the schedule again. Changed cells come back marked stale.";
const reopened = (ctx: Ctx) => {
  const basis = basisOf(ctx);
  return (
    basis !== null &&
    ctx.target.kind === "document" &&
    canonicalRouteInput(basis.target) !== canonicalRouteInput(ctx.target.ref)
  );
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
  commit: "push",
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
      // Grouped by column, so the Work sentence says "across 3 columns" (ruling 14).
      cells: {
        segment: "cells",
        groupOf: (key) => [String(splitScheduleCellKey(key).columnNumber)],
        nouns: ["column"],
      },
      // A receipt that needs recovery is a log row; its link opens it where recovery lives.
      inspectables: {
        receipt: {
          label: (id) => `receipt ${id.slice(0, 8)}`,
          open: { kind: "route", to: "/ops", search: (id) => ({ actionId: id }) },
        },
      },
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
        refresh: {
          label: "read schedule",
          waitSeconds: HOST_READ_WAIT_S,
          says: "reads the selected schedule from Revit into a fresh capture",
          needs: "document",
          actor: "human",
          input: scheduleReads["schedule.grid.snapshot"].input.prefault(
            {},
          ) as unknown as z.ZodType<never>,
          dirties: ["work", "saved"],
          rereads: "work",
          ready: () => null,
          run: async (ctx: Ctx, input: Record<string, unknown>) => {
            // No subject named: re-read the open schedule, never whatever view Revit has active.
            const open = scheduleReadingSchema.safeParse(
              previousOf(ctx.readings.work) ?? previousOf(ctx.readings.saved),
            );
            const reading = scheduleReadingSchema.parse(
              await readScheduleCapture(
                "schedule.grid.snapshot",
                input.scheduleId == null && input.scheduleName == null && open.success
                  ? { ...input, scheduleId: open.data.snapshot.scheduleId }
                  : input,
                targetOf(ctx),
              ),
            );
            // Only the person runs route actions; Pea reads through op:schedule.grid.snapshot, which
            // never writes Work. So the rebind below is always the person's (ruling Q4).
            const doc = ctx.work.doc;
            if (doc?.basis && reading.workspaceId === ctx.page.workspaceId) {
              const basis =
                basisOf(ctx) ??
                (await readScheduleCapture("schedule.grid.saved", { id: doc.basis.captureId }).then(
                  (value) => scheduleReadingSchema.parse(value),
                  () => null,
                ));
              const patches = rebindScheduleWork(doc, basis, reading);
              if (patches.length) await ctx.write(patches);
            }
            ctx.setPage({
              workspaceId: reading.workspaceId,
              captureId: reading.id,
              unread: 0,
            });
          },
        },
        push: {
          label: "push",
          waitSeconds: NATIVE_APPLY_WAIT_S,
          does: "schedule.grid.push",
          input: semanticActions["schedule.grid.push"].input as never,
          dirties: ["work", "saved", "receipts"],
          requires: { work: true, readings: ["saved", "receipts"] },
          // The verb carries its operand: how many staged cells it writes.
          count: (ctx: Ctx) => stagedEntries(ctx.work.doc?.cells ?? {}).length || null,
          ready: (ctx: Ctx) =>
            statuses(ctx).some((row) => ["running", "unknown", "incomplete"].includes(row.state))
              ? "Recover or resume the original receipt before a new apply"
              : !ctx.page.workspaceId || !ctx.work.doc?.basis || ctx.work.revision === null
                ? "Review the exact schedule binding first"
                : !stagedEntries(ctx.work.doc.cells).length
                  ? "Stage a cell first: accept a proposal or type into a cell"
                  : reopened(ctx)
                    ? REOPENED
                    : null,
          run: async (ctx: Ctx) => {
            ctx.setPage({ refused: {} });
            // The run lands in the pod the route has bound; with none, in the action receipt.
            const pod = (ctx.page as { pod?: string | null }).pod ?? undefined;
            const row = await runSemanticAction(
              "schedule.grid.push",
              pod ? { pod } : {},
              targetOf(ctx),
              { work: { key: ctx.work.key as WorkKey, revision: ctx.work.revision! } },
            );
            // The host's lifetime refusal, by its code (a race past `ready`).
            if (
              row.state === "failed" &&
              row.issues?.some((issue) => issue.code === "binding-lifetime-closed")
            )
              return refuse("not-ready", REOPENED);
            const result = actionResult(row) as {
              readback?: unknown;
              applied?: number;
              failures?: { key: string; error: string; code?: string }[];
              readbackError?: string;
            };
            if (result.readback) {
              const reading = scheduleReadingSchema.parse(result.readback);
              ctx.setPage({
                workspaceId: reading.workspaceId,
                captureId: reading.id,
              });
            }
            // A stale refusal whose readback failed has no C on screen: the flag reads again first.
            ctx.setPage({
              unread: result.readbackError
                ? (result.failures ?? []).filter((f) => REFUSAL_WORD[f.code ?? ""] === "stale")
                    .length
                : 0,
            });
            if (result.readbackError) throw Error(result.readbackError);
            // Some cells landed and some were refused: an outcome, not a failure. Returned, so the
            // verb's dirties re-read the grid; the readback already rebound the basis to what Revit holds.
            // Each refusal draws on its cell; the log says the count and the first cell.
            const failures = result.failures ?? [];
            if (!failures.length) return null;
            ctx.setPage({
              refused: Object.fromEntries(failures.map((f) => [f.key, refusalNote(f)])),
            });
            return {
              ...refuse(
                result.applied ? "partial" : "not-ready",
                `${failures.length} refused · ${cellLabel(ctx, failures[0]!.key)}`,
              ),
              cells: failures.map((f) => f.key),
            };
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
