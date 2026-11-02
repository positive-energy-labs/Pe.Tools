import { defineRouteGraph } from "@pe/agent-contracts";
// TODO: docs/features/routes/LEDGER.md#s6-declaration-data-tables Declaration 75 > 60 after kernel defaults. Draft editing, prune review and revision checks remain distinct.
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { z } from "zod";
import {
  pane,
  split,
  dataTableDraftSchema,
  dataTablesWorkSchema,
  type RouteGraph,
} from "@pe/agent-contracts";
import { dataTablesAddress } from "../../../../packages/agent-contracts/src/routes/data-tables";
import { workVerb, commandVerb, prepareCommand } from "#/shell/verbs";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { openTable, tableSchema } from "./sources";

export const draftSchema = dataTableDraftSchema;
export type Draft = z.output<typeof draftSchema>;
export type ColumnKind = Draft["columns"][number]["kind"];
export { tableSchema };
export type TableHandle = z.output<typeof tableSchema>;
export { dataTablesWorkSchema };
export type DataTablesWork = z.output<typeof dataTablesWorkSchema>;
export type DataTablesPage = { table: string; row: string };
export const rowKey = () => `row-${crypto.randomUUID().slice(0, 8)}`;
export const draftFrom = (table: TableHandle): Draft => draftSchema.parse({
  name: table.name,
  isNew: false,
  columns: table.columns.map((column) => ({ ...column })),
  rows: table.rows.map((row) => ({ ...row, values: [...row.values] })),
});
export const blank = (): Draft => ({
  name: "New Table",
  isNew: true,
  columns: [{ heading: "Column 1", kind: "Text" }],
  rows: [{ key: rowKey(), values: [null] }],
});

/** Prune compares the destination name, including a renamed draft or a new draft that collides. */
export function pruneReview(draft: Draft, tables: readonly TableHandle[]) {
  const keys = new Set(draft.rows.map((row) => row.key));
  const deletedKeys = (tables.find((table) => table.name === draft.name)?.rows ?? [])
    .filter((row) => !keys.has(row.key))
    .map((row) => row.key);
  return {
    summary: `Apply ${draft.name}. Prune deletes ${deletedKeys.length} rows from this table in Revit.`,
    deletedRows: deletedKeys.length,
    deletedKeys,
    table: {
      name: draft.name,
      columns: draft.columns,
      rows: draft.rows,
      pruneMissingRows: true as const,
    },
  };
}

export const dataTablesGraph: RouteGraph<DataTablesPage, DataTablesWork> = defineRouteGraph({
  seeds: {
    edit: {
      title: "edit",
      load: () => import("#/shell/fixture-examples").then((m) => m.routeExamples["data-tables"]),
    },
  },
  directory: {
    path: "/data-tables",
    title: "Data Tables",
    label: "Revit data",
    exposure: "Preview",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    icon: "Table",
    category: "Coordinate model data",
    blurb:
      "Author synthetic data tables — draft columns and keyed rows, then upsert them in one apply; rows deleted here are pruned in Revit.",
    aliases: ["Revit", "data"],
    listed: true,
    satellites: [],
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
  },
  key: "data-tables",
  address: "data-tables",
  name: "Data Tables",
  needs: "project",
  work: dataTablesWorkSchema,
  workFields: { draft: { label: "table draft" } },
  subjectField: {
    field: "table",
    noun: "table",
    keyKind: "name",
    roster: "tables",
    detail: "tables",
    pane: "tables",
  },
  fields: {
    row: { ...field(z.string().default(""), {}), role: "selection" },
    table: dataTablesAddress.fields.table,
  },
  readings: {},
  verbs: {
    new: workVerb(
      { label: "New table", input: z.object({}) },
      { patches: () => [{ path: ["draft"], value: blank() }] },
    ),
    open: workVerb(
      { label: "Open table", input: openTable.input },
      {
        patches: (scope, input) => {
          const table = (scope.readings.tables?.value as TableHandle[] | undefined)?.find(
            (table) => table.name === input.name,
          );
          if (!scope.readings.tables?.current || !table)
            throw Error("Read the current tables before opening one");
          return [{ path: ["draft"], value: draftFrom(table) }];
        },
      },
    ),
    apply: commandVerb(
      "data-table.apply",
      {
        label: "Apply",
        input: z.object({}),
        review: "shown",
        chord: "Mod+Enter",
      },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (scope) => {
          if (scope.snapshot.target.kind !== "document") return "Choose a document first";
          if (!scope.readings.tables?.current)
            return "Read the current tables before reviewing Apply";
          const draft = (scope.snapshot.work?.doc as DataTablesWork | undefined)?.draft;
          return !draft
            ? "Choose a table or start a new one first"
            : !draft.name.trim()
              ? "Name the table first"
              : null;
        },
        prepare: async (scope) => {
          await prepareCommand(scope, "data-table.apply.preview", {});
          return pruneReview(
            (scope.snapshot.work!.doc as DataTablesWork).draft!,
            scope.readings.tables!.value as TableHandle[],
          );
        },
        present: (result) => {
          const review = result as ReturnType<typeof pruneReview>;
          return review.table
            ? {
                sentence: review.summary,
                rows: [
                  `Upsert ${review.table.rows.length} rows and ${review.table.columns.length} columns.`,
                  ...review.deletedKeys.map((key) => `Delete row ${key}`),
                ],
              }
            : { sentence: "Table applied.", rows: [] };
        },
        intent: () => ({}),
        lands: (result) => ({ table: (result as { name: string }).name }),
      },
    ),
    edit: workVerb(
      {
        label: "Edit table",
        input: z.object({ draft: draftSchema, expectedRevision: z.number().int() }),
      },
      {
        ready: (scope, input) =>
          scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; edit the current draft",
        patches: (_, input) => [{ path: ["draft"], value: input.draft }],
      },
    ),
  },
  panes: {
    tables: {
      label: "Tables",
      purpose: "Choose a table from the selected document",
      draws: ["tables"],
      verbs: Object.assign(() => ["open"], { ids: ["open"] }),
    },
    draft: { label: "Draft", purpose: "Edit columns and keyed rows", },
  },
  layout: split("editor", { axis: "h", sized: "start", size: 260 }, pane("tables"), pane("draft")),
  stages: {
    edit: {
      word: "Editing",
      verbs: ["new", "apply"],
      teach:
        "Choose a table or start a new draft. Apply upserts by name and row key and prunes missing rows.",
    },
  },
});
