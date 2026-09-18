/**
 * MASTER TABLE — for this wave of the table reshape only: a route's framed table composed from the
 * new pieces (`TableFrame` + `Table`), so every consumer runs on them while it is migrated.
 * Deleted when the last consumer composes the pieces itself.
 */
import type { ReactNode } from "react";
import type { RowData } from "@tanstack/react-table";

import type { Column, TableState } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";

export interface MasterTableProps<Row extends RowData> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  scopeLabel: string;
  searchPlaceholder?: string;
  chips?: { label: string; onClear: () => void }[];
  summary?: ReactNode;
  filters?: ReactNode;
  modes?: ReactNode;
  actions?: ReactNode;
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  rowClassName?: (row: Row) => string | undefined;
  onRowHover?: (row: Row | null) => void;
  selectedKeys?: ReadonlySet<string>;
  onSelectedKeysChange?: (next: ReadonlySet<string>) => void;
  activeKey?: string | null;
  visibleKeys?: readonly string[];
  tableState?: TableState;
  onTableStateChange?: (state: TableState) => void;
  gutter?: (row: Row) => { count: number; title: string; tone?: "alarm" | "caution" } | null;
  density?: "default" | "compact";
}

export function MasterTable<Row extends RowData>(props: MasterTableProps<Row>) {
  const [own, setOwn] = useTableState();
  const state = props.tableState ?? own;
  const onStateChange = (next: TableState) => {
    if (props.tableState === undefined) setOwn(next);
    props.onTableStateChange?.(next);
  };
  const selection =
    props.selectedKeys && props.onSelectedKeysChange
      ? { selected: props.selectedKeys, onChange: props.onSelectedKeysChange }
      : undefined;
  const grid = (
    <Table
      rows={props.rows}
      columns={props.columns}
      rowKey={props.rowKey}
      label={props.scopeLabel}
      state={state}
      onStateChange={onStateChange}
      selection={selection}
      activeKey={props.activeKey}
      visibleKeys={props.visibleKeys}
      onRowClick={props.onRowClick}
      onRowHover={props.onRowHover}
      rowClassName={props.rowClassName}
      gutter={props.gutter}
      empty={props.empty}
    />
  );
  if (props.density === "compact") return grid;
  return (
    <TableFrame
      label={props.scopeLabel}
      rows={props.rows}
      columns={props.columns}
      rowKey={props.rowKey}
      state={state}
      onStateChange={onStateChange}
      summary={props.summary}
      searchPlaceholder={props.searchPlaceholder}
      chips={props.chips}
      filters={props.filters}
      modes={props.modes}
      actions={props.actions}
      selection={selection}
    >
      {grid}
    </TableFrame>
  );
}
