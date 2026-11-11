import { command, sessionCommand } from "../route/typed-actions.ts";
import { bindings } from "./bindings";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import {
  scheduleGridRouteState,
  routeStatePatchSchema,
  splitScheduleCellKey,
  showCellValue,
} from "@pe/agent-contracts";
import { schedulesViewCapability } from "../../../../packages/agent-contracts/src/schedules-read.ts";
import { route, field, subjectSchema, namesOf } from "../route/defaults.ts";
import { subjectCode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
export const fields = {
  workspaceId: field(subjectSchema(1), { kind: "ids", ids: [] }, "subject", "push"),
  table: field(
    z.object({
      query: z.string(),
      sorts: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })),
      hiddenColumns: z.array(z.string()),
    }),
    { query: "", sorts: [], hiddenColumns: [] },
    "pose",
  ),
  cell: field(z.string().regex(/^(\d+::\d+)?$/), "", "pose"),
};
const workspace = (page: { workspaceId: Parameters<typeof namesOf>[0] }) => {
  const ids = namesOf(page.workspaceId);
  if (ids === "all") throw Error("Choose one schedule");
  return ids[0] ?? null;
};
export const view = read(
  hostRead(schedulesViewCapability),
  (page: { workspaceId: Parameters<typeof namesOf>[0] }) => ({
    workspaceId: workspace(page),
  }),
);
const roster = read(hostRead(schedulesViewCapability), () => ({ workspaceId: null }));
export const edit = z
  .array(routeStatePatchSchema)
  .refine(
    (patches) => patches.every((p) => p.path[0] === "cells" && p.path.length > 1),
    "Edit individual schedule cells",
  );
export type { Context as SchedulesDrawContext } from "./context.generated";
export const module = route({
  key: "schedules",
  name: "Schedules",
  needs: "project",
  host: "../../../host/src/reads/schedules.ts",
  directory: {
    group: "Coordinate model data",
    summary: "Inspect document schedules",
    label: "Revit data",
    icon: "LayoutGrid",
    exposure: "Preview",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["Revit", "data"],
    runtimeNeed: "Open project document",
    listed: true,
    satellites: [],
    resume: "document",
  },
  fields,
  core: view,
  reads: { roster },
  subject: {
    field: "workspaceId",
    noun: "schedule",
    multiple: false,
    pane: "grid",
    read: roster,
    options: (data) =>
      (data?.catalog.schedules ?? []).flatMap((row) =>
        row.workspaceId ? [{ id: subjectCode({ keyKind: "workspace", key: row.workspaceId }), label: row.name }] : [],
      ),
  },
  panes: {
    grid: {
      title: "Schedules",
      purpose: "Inspect and edit schedule cells",
      bindings,
      draw: draw(() => import("./grid.tsx"), "SchedulesGrid"),
    },
  },
  edits: {
    work: scheduleGridRouteState,
    seed: () => scheduleGridRouteState.schema.parse({}),
    key: workspace,
    value: "schedulesWork",
    owners: {},
    input: edit,
    patches: (input, data) => {
      if (data.editRefusal) throw Error(data.editRefusal);
      return input;
    },
    history: z.object({ label: z.string() }),
    describe: (detail) => ({ label: detail.label }),
  },
  commands: {
    read: {
      ...sessionCommand("schedule.grid.read"),
      label: "Read schedule",
      input: ({ work, page, value }) => {
        const row = value?.catalog.schedules.find((row) => row.workspaceId === workspace(page));
        if (!row) throw Error("Choose a schedule before reading");
        if (!work) throw Error("Start this schedule Work before reading");
        return { work, scheduleId: row.scheduleId, maxRows: 200 };
      },
    },
    bind: {
      ...sessionCommand("schedule.grid.bind"),
      label: "Bind schedule",
      input: ({ work, value }) => {
        if (!work || !value?.reading) throw Error("Read this schedule before binding");
        return { readingId: value.reading.id, expectedRevision: work.revision };
      },
    },
    push: {
      ...command("schedule.grid.push"),
      label: "Apply cells",
      present: (_result, data, work) => {
        const edits = Object.entries(work.cells).filter(([, cell]) => cell.edit);
        return {
          sentence: `Apply ${edits.length} edited schedule cells`,
          rows: edits.flatMap(([key, cell]) => {
            const { rowNumber, columnNumber } = splitScheduleCellKey(key);
            const row = data.saved?.snapshot.rows.find((row) => row.rowNumber === rowNumber);
            const column = data.saved?.snapshot.columns.find(
              (column) => column.columnNumber === columnNumber,
            );
            const binding = row?.bindings.find(binding => binding.columnNumber === columnNumber);
            const schedule = data.saved?.snapshot.scheduleName ?? "Schedule unavailable";
            const after = showCellValue(cell.edit?.value);
            const stale = work.basis?.stale?.some(cell => cell.key === key);
            const reason = stale ? "Staged value is stale; read and restage it"
              : binding?.blocker !== "None" ? binding?.blocker ?? "Missing binding" : null;
            if (!binding?.targets.length)
              return [`${schedule} · ${column?.headerText ?? `Column ${columnNumber}`}: unavailable → ${after} · refused: ${reason ?? "Missing targets"}`];
            // Root's write-review audit ruling permits ids here; ordinary schedule labels stay id-free.
            // Expand grouped/type bindings by native target, never by the rendered row's first value.
            return binding.targets.map(target => {
              const element = `${target.elementLabel ?? "Element"} · Id ${target.elementId}`;
              const parameter = target.parameterName ?? binding.parameterName ?? "Parameter unavailable";
              const scope = target.scope ?? (binding.isTypeParameter ? "type" : "instance");
              const before = target.hasValue ? target.displayValue ?? target.rawValue : "unset";
              return `${schedule} · ${element} · ${parameter} (${scope}): ${before ?? "unavailable"} → ${after}${reason ? ` · refused: ${reason}` : ""}`;
            });
          }),
        };
      },
    },
  },
  layout: paneLayout("grid"),
});
export const schedulesData = module.data;
export const schedulesHostModule = module.host;
