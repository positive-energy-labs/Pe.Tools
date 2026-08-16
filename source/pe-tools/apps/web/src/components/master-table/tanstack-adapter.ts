import {
  cellSelectionFeature,
  columnFilteringFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";

import type { ValueColumn } from "#/components/master-table/model";

/** The complete TanStack surface MasterTable owns. Do not replace this with stockFeatures. */
export const masterTableFeatures = tableFeatures({
  cellSelectionFeature,
  columnFilteringFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
});

export type MasterTableFeatures = typeof masterTableFeatures;
export type MasterColumnDef<Row extends RowData> = ColumnDef<MasterTableFeatures, Row, unknown>;

/** Map Pe's stable public column model to a private TanStack column tree. */
export function toColumnDefs<Row extends RowData>(
  columns: readonly ValueColumn<Row>[],
): MasterColumnDef<Row>[] {
  const entries = columns.map((column) => ({ column, path: groupPath(column) }));
  return buildLevel(entries, 0);
}

function buildLevel<Row extends RowData>(
  entries: readonly { column: ValueColumn<Row>; path: readonly string[] }[],
  depth: number,
): MasterColumnDef<Row>[] {
  const defs: MasterColumnDef<Row>[] = [];
  for (let start = 0; start < entries.length; ) {
    const entry = entries[start]!;
    const label = entry.path[depth];
    if (label === undefined) {
      defs.push(toLeafDef(entry.column));
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < entries.length && entries[end]!.path[depth] === label) end += 1;
    defs.push({
      id: `master-group:${depth}:${start}:${label}`,
      header: label,
      columns: buildLevel(entries.slice(start, end), depth + 1),
    });
    start = end;
  }
  return defs;
}

function groupPath<Row extends RowData>(column: ValueColumn<Row>): readonly string[] {
  if (column.group === undefined) return [];
  return typeof column.group === "string" ? [column.group] : column.group;
}

function toLeafDef<Row extends RowData>(column: ValueColumn<Row>): MasterColumnDef<Row> {
  return {
    id: column.key,
    header: column.label,
    accessorFn: (row) =>
      column.search?.(row) ?? column.facet?.(row) ?? column.sort?.(row) ?? undefined,
    cell: ({ row }) => column.cell(row.original),
    enableCellSelection: true,
    enableColumnFilter: Boolean(column.facet || column.match),
    enableGlobalFilter: Boolean(column.search),
    enablePinning: Boolean(column.lock),
    enableSorting: Boolean(column.sort),
    sortDescFirst: false,
    filterFn: (row, _columnId, value) => {
      const filter = String(value);
      return column.match
        ? column.match(row.original, filter)
        : column.facet?.(row.original) === filter;
    },
    sortFn: (rowA, rowB) => compare(column.sort?.(rowA.original), column.sort?.(rowB.original)),
  };
}

function compare(a: string | number | undefined, b: string | number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}
