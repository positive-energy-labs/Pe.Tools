import type { Ref } from "../lang/attention";
import type { Tone } from "../../lib/token";
/** visibleRows owns the view; TableFrame owns chrome. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTable, type RowData } from "@tanstack/react-table";

import { cellFactsText, cellStateLabel } from "../lang/cell";
import { Tag } from "../lang/chip";
import { useCollection } from "../lang/collection";
import type { ListReading } from "../lang/collection";
import { StatusLine } from "../lang/list-popup";
import { EmptyState } from "../lang/empty";
import { Scroll } from "../lang/scroll";
import { MasterTableBody } from "./master-table-body";
import { resolveStateColumn } from "./master-table-columns";
import { MasterTableHeader } from "./master-table-header";
import { fromSortingState, resolveUpdater, toSortingState } from "./master-table-state";
import { rowDamage, type Column, type TableState } from "./model";
import { masterTableFeatures, toColumnDefs } from "./tanstack-adapter";
import { emptyTableState, visibleRows } from "./view";
import { useScopeKeys } from "../../keys";

const GUTTER_PX = 18;

export interface TableSelection {
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  /** A row that refuses selection, and why: clicks, ranges and select-all all skip it. */
  refusal?: (key: string) => string | null | undefined;
}

export const selectableKeys = (selection: TableSelection, shown: readonly string[]) =>
  selection.refusal ? shown.filter((key) => !selection.refusal!(key)) : shown;

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
      available: () => (selection?.selected.size ?? 0) > 0,
    },
  ]);
  if (!selection) return null;
  return { toggle: (key: string, range: boolean) => collection.pick(key, range) };
}

export interface TableProps<Row extends RowData> {
  rows: readonly Row[];
  status?: ListReading;
  failure?: string;
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
  /** With `activeKey`: the exact cell named from elsewhere, which the grid focuses (its verbs on the keyboard). */
  activeColumn?: string | null;
  /** The named row or column exists but the view hides it (the query, a hidden column): why, once per naming. */
  onActiveHidden?: (refusal: string) => void;
  /** Show exactly these rows in this order (a drill-in), instead of the view. */
  visibleKeys?: readonly string[];
  onRowClick?: (row: Row) => void;
  onRowHover?: (row: Row | null) => void;
  rowClassName?: (row: Row) => string | undefined;
  /** The Revit elements represented by each row, served by the root element menu. */
  subject?: (row: Row) => Ref;
  revit?: (row: Row) => readonly number[];
  /** Retain offscreen rows that anchor another surface, such as a connector's end. */
  keep?: (row: Row) => boolean;
  gutter?: (row: Row) => { count: number; title: string; tone?: Tone } | null;
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

/** Why a named target is not drawn: the query filtered its row out, or its column is hidden. */
export const ACTIVE_ROW_HIDDEN = "its row is hidden by the query";
export const ACTIVE_COLUMN_HIDDEN = "its column is hidden";

export function Table<Row extends RowData>({
  rows,
  status = "ready",
  failure,
  columns: rawColumns,
  rowKey,
  label,
  state: controlled,
  onStateChange,
  selection,
  activeKey,
  activeColumn,
  onActiveHidden,
  visibleKeys,
  onRowClick,
  onRowHover,
  rowClassName,
  subject,
  revit,
  keep,
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
  const viewed = useMemo(() => {
    if (visibleKeys === undefined) return visibleRows(rows, columns, state);
    const byKey = new Map(rows.map((row) => [rowKey(row), row]));
    return visibleKeys.map((key) => byKey.get(key)).filter((row) => row !== undefined);
  }, [rows, columns, state, visibleKeys, rowKey]);
  // A target named from elsewhere that the view hides is said, never silently dropped (house 9).
  useEffect(() => {
    if (!activeKey || !onActiveHidden || !rows.some((row) => rowKey(row) === activeKey)) return;
    if (!viewed.some((row) => rowKey(row) === activeKey)) onActiveHidden(ACTIVE_ROW_HIDDEN);
    else if (activeColumn && state.hiddenColumns?.includes(activeColumn))
      onActiveHidden(ACTIVE_COLUMN_HIDDEN);
  }, [activeKey, activeColumn]); // eslint-disable-line react-hooks/exhaustive-deps -- the naming edge
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

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  return (
    <>
      <Scroll
        ref={setScroller}
        data-table-scroll=""
        axis="both"
        className={maxHeight ? undefined : "min-h-0 flex-1"}
        maxHeight={maxHeight}
        // Scrolled sideways, the locked column floats over the rows and casts its shade.
        onScroll={({ currentTarget }) =>
          currentTarget.toggleAttribute("data-scrolled-x", currentTarget.scrollLeft > 0)
        }
      >
        <table
          data-table=""
          role="grid"
          aria-label={label}
          aria-rowcount={shownRows.length}
          aria-colcount={columns.length + (gutter ? 1 : 0)}
          // Separate borders travel with sticky cells; collapsed borders leave seams behind them.
          className="w-full border-separate border-spacing-0 t-small"
        >
          {caption != null && <caption className="px-2 py-1">{caption}</caption>}
          <MasterTableHeader
            table={table}
            columnByKey={columnByKey}
            sortCount={table.state.sorting.length}
            gutter={Boolean(gutter)}
            gutterWidth={GUTTER_PX}
          />
          <MasterTableBody
            table={table}
            visibleRows={shownRows}
            columnByKey={columnByKey}
            activeKey={activeKey}
            activeColumn={activeColumn}
            rowClassName={rowClassName}
            subject={subject}
            revit={revit}
            damage={(row) => rowDamage(row, rawColumns)}
            keep={keep}
            onRowClick={onRowClick}
            selectedKeys={selection?.selected}
            refusalOf={selection?.refusal}
            onSelect={select?.toggle}
            onRowHover={onRowHover}
            gutter={gutter}
            gutterWidth={GUTTER_PX}
            cellEdit={cellEdit}
            scroller={scroller}
          />
        </table>
        {status !== "ready" && (
          <StatusLine tone={status === "failed" ? "alarm" : undefined}>
            {status === "failed" ? (failure ?? "Reading failed") : "Reading…"}
          </StatusLine>
        )}
        {shownRows.length === 0 && status === "ready" && (
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
      </Scroll>

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
