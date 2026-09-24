/**
 * TABLE — the one grid (the approved reshape, `table-primitive-explainer.md`): rows, columns, the
 * view state (sort, filters, query) and selection. It draws NO chrome: the box, the scope strip,
 * the search input and the filter chips are `TableFrame`, a wrapper, drawn only when a table wants
 * them. A readout without a frame is simply a `Table` with no `TableFrame` — there is no density
 * flag.
 *
 * Its rows are exactly `visibleRows(rows, columns, state)`, the same pure function every wrapper
 * reads, so the grid and its frame's counts can never disagree. Rows are the kit `Row as="tr"`;
 * selection is the one collection (`useTableSelection` over `useCollection`). TanStack keeps what
 * it is good at here: the column tree, pinning, the focused cell, and the header's sort handlers.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTable, type RowData } from "@tanstack/react-table";

import { cellFactsText, cellStateLabel } from "#/components/lang/cell";
import { Tag } from "#/components/lang/chip";
import { useCollection } from "#/components/lang/collection";
import { EmptyState } from "#/components/lang/empty";
import { MasterTableBody } from "#/components/master-table/master-table-body";
import { resolveStateColumn } from "#/components/master-table/master-table-columns";
import { MasterTableHeader } from "#/components/master-table/master-table-header";
import {
  fromSortingState,
  resolveUpdater,
  toSortingState,
} from "#/components/master-table/master-table-state";
import type { Column, TableState } from "#/components/master-table/model";
import { masterTableFeatures, toColumnDefs } from "#/components/master-table/tanstack-adapter";
import { emptyTableState, visibleRows } from "#/components/master-table/view";
import { useScopeKeys } from "#/route/keys";

const GUTTER_PX = 18;

/** Row selection: a set of row keys the route owns. */
export interface TableSelection {
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  /** A row that refuses selection, and why: clicks, ranges and select-all all skip it. */
  refusal?: (key: string) => string | null | undefined;
}

/** The shown keys a selection may hold: select-all's reach. */
export const selectableKeys = (selection: TableSelection, shown: readonly string[]) =>
  selection.refusal ? shown.filter((key) => !selection.refusal!(key)) : shown;

/**
 * The table's selection is the one collection's multi-select over the rows AS SHOWN: click toggles,
 * shift-click extends over the visible order, Escape clears (select-all is the frame's).
 */
function useTableSelection(selection: TableSelection | undefined, shown: readonly string[]) {
  const collection = useCollection<string>({
    items: shown,
    keyOf: (key) => key,
    labelOf: (key) => key,
    select: "multi",
    selected: selection ? [...selection.selected] : [],
    onSelectedChange: (keys) => selection?.onChange(new Set(keys)),
    refusalOf: selection?.refusal,
    // The cells own the keyboard in a table; the collection owns the selection only.
    target: null,
  });
  useScopeKeys([
    {
      hotkey: "Escape",
      callback: () => selection?.onChange(new Set()),
      label: "clear selection",
      says: "drop the selected table rows",
      options: { enabled: (selection?.selected.size ?? 0) > 0 },
    },
  ]);
  if (!selection) return null;
  return { toggle: (key: string, range: boolean) => collection.pick(key, range) };
}

export interface TableProps<Row extends RowData> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  /** The grid's accessible name; a frame's scope label says it visibly. */
  label: string;
  /** Route-owned view state; absent, the table keeps its own. */
  state?: TableState;
  onStateChange?: (state: TableState) => void;
  selection?: TableSelection;
  /** The row a side pane shows. */
  activeKey?: string | null;
  /** Show exactly these rows in this order (a drill-in), instead of the view. */
  visibleKeys?: readonly string[];
  onRowClick?: (row: Row) => void;
  onRowHover?: (row: Row | null) => void;
  rowClassName?: (row: Row) => string | undefined;
  gutter?: (row: Row) => { count: number; title: string; tone?: "alarm" | "caution" } | null;
  /** Nothing in scope (a filtered-to-nothing table says its own, different story). */
  empty?: ReactNode;
  /** A self-bounded scroll height (a readout in a card); absent, the table fills its parent. */
  maxHeight?: string;
  /** A readout's title, said as the grid's native caption. */
  caption?: ReactNode;
  cellEdit?: {
    read: (row: Row, column: string) => string;
    fill: (cells: readonly { row: Row; column: string }[], text: string) => void;
  };
}

export function Table<Row extends RowData>({
  rows,
  columns: rawColumns,
  rowKey,
  label,
  state: controlled,
  onStateChange,
  selection,
  activeKey,
  visibleKeys,
  onRowClick,
  onRowHover,
  rowClassName,
  gutter,
  empty,
  maxHeight,
  caption,
  cellEdit,
}: TableProps<Row>) {
  const [own, setOwn] = useState(emptyTableState);
  const state = controlled ?? own;
  const columns = useMemo(
    () =>
      rawColumns
        .filter((column) => !state.hiddenColumns?.includes(column.key))
        .map(resolveStateColumn),
    [rawColumns, state.hiddenColumns],
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const update = (change: (state: TableState) => TableState) => {
    const next = change(stateRef.current);
    stateRef.current = next;
    if (controlled === undefined) setOwn(next);
    onStateChange?.(next);
  };
  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns],
  );
  // THE VIEW: the one pure function; the grid draws its answer and nothing else.
  const viewed = useMemo(() => {
    if (visibleKeys === undefined) return visibleRows(rows, columns, state);
    const byKey = new Map(rows.map((row) => [rowKey(row), row]));
    return visibleKeys.map((key) => byKey.get(key)).filter((row) => row !== undefined);
  }, [rows, columns, state, visibleKeys, rowKey]);
  const tableColumns = useMemo(() => toColumnDefs(columns), [columns]);
  const sorting = useMemo(() => toSortingState(state.sorts), [state.sorts]);
  const columnPinning = useMemo(
    () => ({ start: columns.filter((column) => column.lock).map((column) => column.key), end: [] }),
    [columns],
  );
  const table = useTable(
    {
      features: masterTableFeatures,
      data: viewed,
      columns: tableColumns,
      getRowId: rowKey,
      state: { sorting, columnPinning },
      onSortingChange: (updater) =>
        update((current) => ({
          ...current,
          sorts: fromSortingState(resolveUpdater(updater, toSortingState(current.sorts))),
        })),
      enableCellSelection: true,
      enableColumnPinning: true,
      enableMultiSort: true,
      enableSortingRemoval: false,
      isMultiSortEvent: (event) => Boolean((event as { shiftKey?: boolean } | undefined)?.shiftKey),
    },
    (s) => ({ columnPinning: s.columnPinning, sorting: s.sorting }),
  );
  const shownRows = table.getRowModel().rows;
  const select = useTableSelection(
    selection,
    shownRows.map((row) => row.id),
  );

  const theadRef = useRef<HTMLTableSectionElement | null>(null);
  const [rowTops, setRowTops] = useState<number[]>([]);
  useLayoutEffect(() => {
    const thead = theadRef.current;
    if (!thead) return;
    const measure = () => {
      const headerRows = Array.from(thead.rows);
      if (headerRows.length === 0) return;
      const base = headerRows[0]!.getBoundingClientRect().top;
      const next = headerRows.map((row) => row.getBoundingClientRect().top - base);
      // FOOTGUN: a caller that rebuilds `columns` every render re-runs this effect every render;
      // setting a fresh array each time is "Maximum update depth exceeded". Set only on change.
      setRowTops((previous) =>
        previous.length === next.length && previous.every((top, i) => top === next[i])
          ? previous
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(thead);
    return () => observer.disconnect();
  }, [columns]);

  const setFilter = (key: string, value: string | null) =>
    update((current) => {
      const filters = { ...current.filters };
      if (value === null) delete filters[key];
      else filters[key] = value;
      return { ...current, filters };
    });

  return (
    <>
      <div
        className={maxHeight ? "overflow-auto" : "min-h-0 flex-1 overflow-auto"}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table
          role="grid"
          aria-label={label}
          aria-rowcount={shownRows.length}
          aria-colcount={columns.length + (gutter ? 1 : 0)}
          // SEPARATE, not collapsed: a collapsed border belongs to the TABLE, so it does not travel
          // with a sticky cell — it scrolls out from under the locked column and the header and
          // leaves the page ground showing as a white seam. Every cell already draws its own
          // `border-b border-l` with `first:border-l-0`, so nothing doubles (annotation, 2026-08-31).
          className="w-full border-separate border-spacing-0 t-small"
        >
          {caption != null && <caption className="px-2 py-1">{caption}</caption>}
          <MasterTableHeader
            table={table}
            columnByKey={columnByKey}
            rows={rows}
            filters={state.filters}
            setFilter={setFilter}
            query={state.query}
            stickyTop={(rowIndex) => rowTops[rowIndex] ?? 0}
            sortCount={table.state.sorting.length}
            gutter={Boolean(gutter)}
            gutterWidth={GUTTER_PX}
            theadRef={theadRef}
          />
          <MasterTableBody
            table={table}
            visibleRows={shownRows}
            columnByKey={columnByKey}
            activeKey={activeKey}
            rowClassName={rowClassName}
            onRowClick={onRowClick}
            selectedKeys={selection?.selected}
            refusalOf={selection?.refusal}
            onSelect={select?.toggle}
            onRowHover={onRowHover}
            gutter={gutter}
            gutterWidth={GUTTER_PX}
            cellEdit={cellEdit}
          />
        </table>
        {shownRows.length === 0 && (
          <div className="mx-auto max-w-md p-6 text-center">
            {rows.length > 0 ? (
              <EmptyState
                story="filter"
                exit="clear a chip or search word above to bring them back"
              >
                {`all ${rows.length} rows in scope are filtered out`}
              </EmptyState>
            ) : (
              (empty ?? (
                <EmptyState story="scope" exit="widen the scope above to fill the table">
                  nothing in scope yet
                </EmptyState>
              ))
            )}
          </div>
        )}
      </div>

      {columns.some((column) => column.readState) && (
        <table.Subscribe
          source={table.atoms.cellSelection}
          selector={() => {
            const focused = table.getFocusedCell();
            return focused ? `${focused.row.id} ${focused.column.id}` : "";
          }}
        >
          {() => {
            const focused = table.getFocusedCell();
            const column = focused ? columnByKey.get(focused.column.id) : undefined;
            const cellState =
              focused && column?.readState ? column.readState(focused.row.original) : undefined;
            if (!focused || !cellState) return null;
            return (
              <div className="t-small t-upper flex h-6 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-t border-line px-2 whitespace-nowrap on-recess">
                <Tag>{column?.readWord?.(focused.row.original) ?? cellStateLabel(cellState)}</Tag>
                <span className="truncate text-ink-2">
                  {cellFactsText(cellState) ??
                    "nothing further — the marks on the cell are the whole story"}
                </span>
              </div>
            );
          }}
        </table.Subscribe>
      )}
    </>
  );
}
