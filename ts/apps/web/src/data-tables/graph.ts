import { z } from "zod";
import {
  pane,
  split,
  dataTableDraftSchema,
  dataTablesWorkSchema,
  type RouteGraph,
} from "@pe/agent-contracts";
import { dataTablesAddress } from "../../../../packages/agent-contracts/src/routes/data-tables";
import { workVerb, queryVerb, commandVerb } from "#/shell/verbs";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { openTable, tableSchema } from "./sources";

export const draftSchema = dataTableDraftSchema;
export type Draft = z.output<typeof draftSchema>;
export type ColumnKind = Draft["columns"][number]["kind"];
export { tableSchema };
export type TableHandle = z.output<typeof tableSchema>;
export { dataTablesWorkSchema };
export type DataTablesWork = z.output<typeof dataTablesWorkSchema>;
export type DataTablesPage = { table: string };
export const rowKey = () => `row-${crypto.randomUUID().slice(0, 8)}`;
export const draftFrom = (table: TableHandle): Draft => ({
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

export const dataTablesGraph: RouteGraph<DataTablesPage, DataTablesWork> = {
  key: "data-tables",
  address: "data-tables",
  name: "Data Tables",
  needs: "project",
  work: dataTablesWorkSchema,
  fields: { table: { ...dataTablesAddress.fields.table, role: "subject" } },
  readings: { tables: { kind: "use", source: "data-tables.tables", retire: "target" } },
  verbs: {
    new: workVerb(
      { label: "New table", input: z.object({}) },
      { patches: () => [{ path: ["draft"], value: blank() }] },
    ),
    open: queryVerb(
      openTable,
      { label: "Open table", input: openTable.input, review: "none" },
      {
        patches: (_, result) => [{ path: ["draft"], value: draftFrom(tableSchema.parse(result)) }],
      },
    ),
    apply: commandVerb(
      "data-table.apply",
      {
        label: "Apply",
        input: z.object({}),
        review: "required",
        answers: z.object({}),
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
        prepare: (scope) =>
          pruneReview(
            (scope.snapshot.work!.doc as DataTablesWork).draft!,
            scope.readings.tables!.value as TableHandle[],
          ),
        intent: (_, __, ___, ticket) => ({
          table: (ticket!.evidence as ReturnType<typeof pruneReview>).table,
        }),
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
    draft: { label: "Draft", purpose: "Edit columns and keyed rows", draws: [], verbs: [] },
  },
  layout: split("editor", { axis: "h", sized: "start", size: 260 }, pane("tables"), pane("draft")),
  stages: {
    edit: {
      word: "Editing",
      panes: ["tables", "draft"],
      verbs: ["new", "apply"],
      teach:
        "Choose a table or start a new draft. Apply upserts by name and row key and prunes missing rows.",
    },
  },
  pick: false,
};
