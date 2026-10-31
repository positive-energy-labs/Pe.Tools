import { scheduleQueries } from "../../../../packages/mcps/src/shared/query-client";
import { z } from "zod";
import {
  canonicalRouteInput,
  gate,
  pane,
  routeAddress,
  routeStatePatchSchema,
  scheduleGridRouteState,
  scheduleReads,
  split,
  splitScheduleCellKey,
  showCellValue,
  type RouteGraph,
  type ScheduleGridDocument,
  type ScheduleReading,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { schedulesAddress } from "../../../../packages/agent-contracts/src/routes/schedules";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { commandVerb, queryVerb, workVerb } from "#/shell/verbs";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";

export const SCHEDULE_SPEC_SCHEMA = "/schemas/settings/CmdScheduleManager/schedules.json";
const fields = { ...threadListFields, ...schedulesAddress.fields };
export const schedulesPageSchema = routeAddress("schedules").schema.extend({
  captureId: z.string().default(""),
});
export type SchedulesPage = z.output<typeof schedulesPageSchema>;

const capture = z.strictObject({
  pod: z.string(),
  scheduleId: z.number().int().optional(),
  refusal: z.string().nullable().default(null),
});
const source = z.strictObject({
  source: z.object({ pod: z.string(), path: z.string(), sha256: z.string() }).optional(),
  refusal: z.string().nullable().default(null),
});
const push = z.strictObject({
  pod: z.string().optional(),
  refusal: z.string().nullable().default(null),
});

export const schedulesGraph: RouteGraph<SchedulesPage, ScheduleGridDocument> = {
  key: scheduleGridRouteState.route,
  address: "schedules",
  name: "Schedules",
  seeds: {
    read: {
      title: "Mechanical equipment",
      load: () => import("./graph-seeds").then((m) => m.schedulesSeeds["read"]!),
    },
    apply: {
      title: "Mechanical equipment",
      load: () => import("./graph-seeds").then((m) => m.schedulesSeeds["apply"]!),
    },
  },
  needs: "project",
  work: scheduleGridRouteState.schema,
  // A schedule's Work is its subject's: picking a schedule or reading one moves this field.
  workSubject: "workspaceId",
  fields: {
    threadSearch: { ...fields.threadSearch, role: "query" },
    threadSort: { ...fields.threadSort, role: "query" },
    stage: { ...fields.stage, role: "stage" },
    pod: { ...fields.pod, role: "subject" },
    path: { ...fields.path, role: "subject" },
    pane: { ...fields.pane, role: "pose", url: false },
    workspaceId: { ...fields.workspaceId, role: "subject" },
    query: { ...fields.query, role: "query" },
    sort: { ...fields.sort, role: "query" },
    hidden: { ...fields.hidden, role: "pose" },
    lines: { ...fields.lines, role: "selection" },
    cell: { ...fields.cell, role: "selection" },
    captureId: {
      ...field(z.string().default(""), {}, { encode: String, decode: String }),
      role: "selection",
      url: false,
    },
  },
  cells: [
    {
      segment: "cells",
      groupOf: (key) => [String(splitScheduleCellKey(key).columnNumber)],
      nouns: ["column"],
    },
  ],
  readings: {
    catalog: { kind: "use", source: "schedules.catalog", retire: "target" },
    retained: {
      kind: "use",
      source: "schedules.retained",
      retire: "page",
      args: (page) => page.workspaceId,
    },
    saved: {
      kind: "use",
      source: "schedules.saved",
      retire: "page",
      args: (page) => [page.stage, page.captureId],
    },
    history: {
      kind: "use",
      source: "schedules.history",
      retire: "page",
      args: (page) => page.workspaceId,
    },
    receipts: {
      kind: "use",
      source: "schedules.receipts",
      retire: "target",
    },
    outcome: { kind: "derive", source: "schedules.outcome", retire: "target", deps: ["receipts"] },
    pods: { kind: "use", source: "schedules.pods", retire: "never" },
  },
  verbs: {
    edit: workVerb(
      {
        label: "Edit schedule cells",
        input: z.strictObject({
          patches: z.array(routeStatePatchSchema),
          expectedRevision: z.number().int(),
          refusal: z.string().nullable().default(null),
        }),
      },
      {
        ready: (scope, input) =>
          input.refusal ??
          (scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; edit the current schedule cells"),
        patches: (_, input) => input.patches,
      },
    ),
    push: commandVerb(
      "schedule.grid.push",
      {
        label: "Apply cells",
        review: "shown",
        chord: "Mod+Enter",
        input: push,
        says: "Review these exact cell edits and their native bindings, then push them to Revit",
      },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: (scope) => {
          const doc = scope.snapshot.work!.doc as ScheduleGridDocument;
          return { basis: doc.basis, cells: doc.cells };
        },
        present: (result, scope) => {
          const prepared = result as Pick<ScheduleGridDocument, "basis" | "cells">;
          if (!prepared.cells) return { sentence: "Schedule cells applied.", rows: [] };
          const edits = Object.entries(prepared.cells).filter(
            ([, cell]) => cell.edit && !cell.edit.delete,
          );
          const readings = [scope.readings.retained?.value, scope.readings.saved?.value] as (
            | ScheduleReading
            | undefined
          )[];
          const shown = readings.find((reading) => reading?.id === prepared.basis?.captureId);
          return {
            sentence: `Apply ${edits.length} edited schedule ${edits.length === 1 ? "cell" : "cells"}.`,
            rows: edits.map(([key, cell]) => {
              const { rowNumber, columnNumber } = splitScheduleCellKey(key);
              const row = shown?.snapshot.rows.find((row) => row.rowNumber === rowNumber);
              const column = shown?.snapshot.columns.find(
                (column) => column.columnNumber === columnNumber,
              );
              return `${row?.values[0] ?? `Row ${rowNumber}`} · ${column?.headerText ?? `Column ${columnNumber}`}: ${showCellValue(row?.values[columnNumber])} → ${showCellValue(cell.edit?.value)}`;
            }),
          };
        },
        intent: (_, input) => (input.pod ? { pod: input.pod } : {}),
      },
    ),
    capture: commandVerb(
      "schedule.capture",
      {
        label: "Capture schedule",
        review: "none",
        input: capture,
      },
      {
        ready: (_, input) => input.refusal,
        intent: (_, input) => ({ pod: input.pod, scheduleId: input.scheduleId! }),
      },
    ),
    apply: commandVerb(
      "schedule.apply",
      {
        label: "Apply spec",
        review: "none",
        input: source,
      },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        intent: (_, input) => ({ source: input.source! }),
      },
    ),
    // Host reads, never a fake authored Work edit (ADR 0026); a read selects its subject's Work.
    read: queryVerb(
      scheduleQueries["schedule.grid.snapshot"],
      {
        label: "Read schedule",
        review: "none",
        input: scheduleReads["schedule.grid.snapshot"].input,
      },
      { subject: (value) => (value as ScheduleReading).workspaceId },
    ),
    bind: queryVerb(scheduleQueries["schedule.grid.bind"], {
      label: "Bind schedule reading",
      review: "none",
      input: scheduleReads["schedule.grid.bind"].input,
    }),
  },
  panes: {
    list: {
      label: "Schedules",
      purpose: "Choose a schedule in this document",
      draws: ["catalog", "retained", "history"],
      verbs: ["read"],
    },
    grid: {
      label: "Schedule grid",
      purpose: "Inspect and edit schedule cells",
      draws: ["retained", "saved", "receipts", "outcome"],
      verbs: [],
    },
    work: {
      label: "Schedule Work",
      purpose: "Review proposed and edited cells",
      draws: ["retained", "saved", "receipts", "outcome"],
      verbs: ["bind"],
    },
    spec: {
      label: "Schedule spec",
      purpose: "Choose a saved schedule definition",
      draws: ["pods"],
      verbs: [],
    },
  },
  layout: split(
    "schedule-body",
    { axis: "h", sized: "start", size: 240 },
    pane("list"),
    split(
      "schedule-main",
      { axis: "v", sized: "end", size: 160 },
      split(
        "schedule-spec",
        { axis: "h", sized: "end", size: 420 },
        pane("grid"),
        gate("apply", pane("spec")),
      ),
      gate("editing", pane("work")),
    ),
  ),
  predicates: { editing: (page) => page.stage !== "history" },
  stages: {
    audit: { word: "Auditing", panes: ["list", "grid", "work"], verbs: ["capture"] },
    apply: { word: "Applying", panes: ["list", "grid", "work", "spec"], verbs: ["push", "apply"] },
    history: { word: "History", panes: ["list", "grid"], verbs: [] },
  },
  stageOrder: ["audit", "apply", "history"],
};

export const sameScheduleRows = (
  a: import("@pe/agent-contracts").ScheduleReading,
  b: import("@pe/agent-contracts").ScheduleReading,
) =>
  a.snapshot.scheduleUniqueId === b.snapshot.scheduleUniqueId &&
  a.snapshot.rows.length === b.snapshot.rows.length &&
  a.snapshot.rows.every(
    (row, index) =>
      row.rowNumber === b.snapshot.rows[index]!.rowNumber &&
      canonicalRouteInput(row.subjectIds) ===
        canonicalRouteInput(b.snapshot.rows[index]!.subjectIds),
  );
