import { z } from "zod";
import { pane, split, type RouteGraph } from "@pe/agent-contracts";
import { dataTablesAddress } from "../../../../packages/agent-contracts/src/routes/data-tables";
import { workVerb } from "#/shell/verbs";

const column = z.object({ heading: z.string(), kind: z.enum(["Text", "Number"]) });
const row = z.object({ key: z.string(), values: z.array(z.string().nullable()) });
export const draftSchema = z.object({
  name: z.string(),
  isNew: z.boolean(),
  columns: z.array(column),
  rows: z.array(row),
});
export type Draft = z.output<typeof draftSchema>;
export type ColumnKind = Draft["columns"][number]["kind"];
export const tableSchema = draftSchema.omit({ isNew: true }).extend({
  placements: z.array(z.object({ sheetNumber: z.string() })),
});
export type TableHandle = z.output<typeof tableSchema>;
export const dataTablesWorkSchema = z.object({ draft: draftSchema.nullable().default(null) });
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
    table: { name: draft.name, columns: draft.columns, rows: draft.rows, pruneMissingRows: true },
  };
}

// TODO: Complete data-table command registration and kernel selection/settlement hooks before cutover.
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
    open: workVerb(
      { label: "Open table", input: z.object({ table: tableSchema }) },
      { patches: (_, input) => [{ path: ["draft"], value: draftFrom(input.table) }] },
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
      verbs: ["new"],
      teach:
        "Choose a table or start a new draft. Apply upserts by name and row key and prunes missing rows.",
    },
  },
  pick: false,
};
