import type { SetStateAction } from "react";
import { EmptyState } from "@pe/kit/lang/empty";
import { Table } from "@pe/kit/table/table";
import { routeFromGraph, type RouteAdapters, type MountBody } from "#/shell/mount";
import { DraftEditor } from "./draft-editor";
import {
  dataTablesGraph,
  type DataTablesPage,
  type DataTablesWork,
  type Draft,
  type TableHandle,
} from "./graph";
import { dataTablesSources } from "./sources";

type Body = MountBody<DataTablesPage, DataTablesWork>;
function Tables({ owner, verbs }: Body) {
  const reading = owner.readings.get("tables");
  const tables = (reading.value ?? []) as TableHandle[];
  if (reading.error) return <p role="alert">{reading.error}</p>;
  if (!reading.current) return <p role="status">Reading data tables…</p>;
  if (!tables.length)
    return (
      <EmptyState story="scope" exit="start a new table">
        No data tables in this document
      </EmptyState>
    );
  return (
    <Table<TableHandle>
      label="Data tables"
      rows={tables}
      rowKey={(table) => table.name}
      columns={[
        { key: "name", label: "Table", cell: (table) => table.name },
        {
          key: "size",
          label: "Size",
          cell: (table) => `${table.columns.length}×${table.rows.length}`,
        },
        {
          key: "sheets",
          label: "Sheets",
          cell: (table) => table.placements.map((p) => p.sheetNumber).join(", "),
        },
        { key: "verbs", label: "Open", cell: (table) => verbs(table) },
      ]}
    />
  );
}

function Editor({ owner }: Body) {
  const work = owner.snapshot().work;
  const draft = work?.doc.draft;
  if (!draft)
    return (
      <EmptyState story="scope" exit="choose a table or start a new table">
        No table open
      </EmptyState>
    );
  const setDraft = (next: SetStateAction<Draft | null>) => {
    const value = typeof next === "function" ? next(draft) : next;
    if (value)
      void owner.control("edit", { draft: value, expectedRevision: work.handle.revision }).run();
  };
  return <DraftEditor draft={draft} setDraft={setDraft} />;
}

export const dataTablesAdapters: RouteAdapters<DataTablesPage, DataTablesWork> = {
  sources: dataTablesSources(),
  binding: (id, row) => ({
    subject: null,
    args: id === "open" ? { table: row } : id === "edit" ? row : {},
  }),
  bodies: { tables: (body) => <Tables {...body} />, draft: (body) => <Editor {...body} /> },
};

/** Not registered until the kernel can preserve selection, reset and required Apply review. */
export const dataTablesRoute = routeFromGraph(dataTablesGraph, dataTablesAdapters);
