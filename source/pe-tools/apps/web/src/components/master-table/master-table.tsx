import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTable, type RowData } from "@tanstack/react-table";

import { cellFactsText, cellStateLabel } from "#/components/lang/cell";
import { NarrowChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Input } from "#/components/lang/input";
import { Press } from "#/components/lang/press";
import { MasterTableBody } from "#/components/master-table/master-table-body";
import { resolveStateColumn } from "#/components/master-table/master-table-columns";
import { MasterTableHeader, labelOf } from "#/components/master-table/master-table-header";
import {
  emptyTableState,
  fromColumnFiltersState,
  fromSortingState,
  resolveUpdater,
  toColumnFiltersState,
  toSortingState,
} from "#/components/master-table/master-table-state";
import type { Column, MasterTableState } from "#/components/master-table/model";
import { masterTableFeatures, toColumnDefs } from "#/components/master-table/tanstack-adapter";

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
  activeKey?: string | null;
  visibleKeys?: readonly string[];
  tableState?: MasterTableState;
  onTableStateChange?: (state: MasterTableState) => void;
  gutter?: (row: Row) => { count: number; title: string; tone?: "alarm" | "caution" } | null;
}

const GUTTER_PX = 18;

export function MasterTable<Row extends RowData>({
  rows,
  columns: rawColumns,
  rowKey,
  scopeLabel,
  searchPlaceholder,
  chips = [],
  summary,
  filters,
  modes,
  actions,
  empty,
  onRowClick,
  rowClassName,
  onRowHover,
  activeKey,
  visibleKeys,
  tableState,
  onTableStateChange,
  gutter,
}: MasterTableProps<Row>) {
  const columns = useMemo(() => rawColumns.map(resolveStateColumn), [rawColumns]);
  const [internalState, setInternalState] = useState(emptyTableState);
  const resolvedState = tableState ?? internalState;
  const stateRef = useRef(resolvedState);
  stateRef.current = resolvedState;

  const updateState = (update: (state: MasterTableState) => MasterTableState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    if (tableState === undefined) setInternalState(next);
    onTableStateChange?.(next);
  };
  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns],
  );
  const tableColumns = useMemo(() => toColumnDefs(columns), [columns]);
  const sorting = useMemo(() => toSortingState(resolvedState.sorts), [resolvedState.sorts]);
  const columnFilters = useMemo(
    () => toColumnFiltersState(resolvedState.filters),
    [resolvedState.filters],
  );
  const columnPinning = useMemo(
    () => ({ start: columns.filter((column) => column.lock).map((column) => column.key), end: [] }),
    [columns],
  );
  const table = useTable(
    {
      features: masterTableFeatures,
      data: rows,
      columns: tableColumns,
      getRowId: rowKey,
      state: { sorting, columnFilters, globalFilter: resolvedState.query, columnPinning },
      onSortingChange: (updater) =>
        updateState((state) => ({
          ...state,
          sorts: fromSortingState(resolveUpdater(updater, toSortingState(state.sorts))),
        })),
      onColumnFiltersChange: (updater) =>
        updateState((state) => ({
          ...state,
          filters: fromColumnFiltersState(
            resolveUpdater(updater, toColumnFiltersState(state.filters)),
          ),
        })),
      onGlobalFilterChange: (updater) =>
        updateState((state) => ({
          ...state,
          query: String(resolveUpdater(updater, state.query) ?? ""),
        })),
      enableCellSelection: true,
      enableColumnPinning: true,
      enableMultiSort: true,
      enableSortingRemoval: false,
      isMultiSortEvent: (event) => Boolean((event as { shiftKey?: boolean } | undefined)?.shiftKey),
      globalFilterFn: (row, columnId, value) => {
        const query = String(value).trim().toLowerCase();
        return (
          !query ||
          (columnByKey.get(columnId)?.search?.(row.original).toLowerCase().includes(query) ?? false)
        );
      },
    },
    (state) => ({
      columnFilters: state.columnFilters,
      columnPinning: state.columnPinning,
      globalFilter: state.globalFilter,
      sorting: state.sorting,
    }),
  );

  const tableRows =
    visibleKeys === undefined ? table.getRowModel().rows : table.getCoreRowModel().rows;
  const visibleRows = useMemo(() => {
    if (visibleKeys === undefined) return tableRows;
    const byId = new Map(tableRows.map((row) => [row.id, row]));
    return visibleKeys.map((key) => byId.get(key)).filter((row) => row !== undefined);
  }, [tableRows, visibleKeys]);

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

  const activeFilters = columns.filter((column) => resolvedState.filters[column.key]);
  const setFilter = (key: string, value: string | null) =>
    updateState((state) => {
      const filters = { ...state.filters };
      if (value === null) delete filters[key];
      else filters[key] = value;
      return { ...state, filters };
    });
  const hasFilters =
    filters != null || chips.length > 0 || Boolean(resolvedState.query) || activeFilters.length > 0;
  const head = (
    <>
      <span
        className="t-small t-upper"
        title="Everything currently in scope. This table is never hidden and never narrowed silently — every filter acting on it is a chip in this strip."
      >
        {scopeLabel}
      </span>
      {summary && <span className="face-mono t-small text-ink-2">{summary}</span>}
    </>
  );
  const headTrail = (
    <>
      {searchPlaceholder && (
        <div className="w-44">
          <Input
            face="mono"
            value={resolvedState.query}
            onChange={(event) => updateState((state) => ({ ...state, query: event.target.value }))}
            placeholder={searchPlaceholder}
            title="Free-text filter. It reads only the columns that declare themselves searchable, so a match here always points at a visible column."
          />
        </div>
      )}
      {modes}
      {actions}
    </>
  );

  return (
    <ArtifactFrame className="flex min-h-0 flex-1 flex-col" head={head} headTrail={headTrail}>
      {hasFilters && (
        <div
          data-slot="table-filters"
          className="flex shrink-0 flex-wrap items-center gap-2 px-2 py-1 hairline-b"
        >
          {filters}
          {/*
        <span
          className="t-small t-upper"
          title="Everything currently in scope. This table is never hidden and never narrowed silently — every filter acting on it is a chip in this strip."
        >
          {scopeLabel}
        </span>
        {searchPlaceholder && (
          <input
            value={resolvedState.query}
            onChange={(event) => updateState((state) => ({ ...state, query: event.target.value }))}
            placeholder={searchPlaceholder}
            title="Free-text filter. It reads only the columns that declare themselves searchable, so a match here always points at a visible column."
            className="face-mono t-small h-(--control-h) w-44 rounded-sm border border-line-2 bg-transparent px-1.5 outline-none focus:border-line-2"
          />
        )}
        {resolvedState.query && (
          <span
            className="face-mono t-small text-ink-2"
            title="How many rows survive the free-text filter, out of every row in scope."
          >
            {visibleRows.length} of {rows.length}
          </span>
        )}
        {summary && <span className="face-mono t-small text-ink-2">{summary}</span>}
        */}
          {chips.map((chip) => (
            <NarrowChip
              key={chip.label}
              label={chip.label}
              count={visibleRows.length}
              onRemove={chip.onClear}
              title="A route-owned filter narrowing this table right now. The count is rows still in scope; removing it widens back out."
            />
          ))}
          {resolvedState.query && (
            <NarrowChip
              label={`search: ${resolvedState.query}`}
              count={visibleRows.length}
              onRemove={() => updateState((state) => ({ ...state, query: "" }))}
              title="The free-text filter narrowing this table right now. The count is rows still in scope; removing it widens back out."
            />
          )}
          {activeFilters.map((column) => (
            <NarrowChip
              key={column.key}
              label={`${column.label}: ${labelOf(column, rows, resolvedState.filters[column.key] ?? "")}`}
              count={visibleRows.length}
              onRemove={() => setFilter(column.key, null)}
              title="A column filter narrowing this table right now. The count is rows still in scope; removing it widens back out."
            />
          ))}
          {activeFilters.length > 0 && (
            <Press
              type="button"
              onClick={() => updateState((state) => ({ ...state, filters: {} }))}
              title="Drop every column filter at once. Filters owned by the route have their own chips and are left alone."
              tone="quiet"
              size="label"
            >
              clear column filters
            </Press>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          role="grid"
          aria-rowcount={visibleRows.length}
          aria-colcount={columns.length + (gutter ? 1 : 0)}
          // SEPARATE, not collapsed: a collapsed border belongs to the TABLE, so it does not travel
          // with a sticky cell — it scrolls out from under the locked column and the header and
          // leaves the page ground showing as a white seam. Every cell already draws its own
          // `border-b border-l` with `first:border-l-0`, so nothing doubles (annotation, 2026-08-31).
          className="w-full border-separate border-spacing-0 t-small"
        >
          <MasterTableHeader
            table={table}
            columnByKey={columnByKey}
            rows={rows}
            filters={resolvedState.filters}
            setFilter={setFilter}
            stickyTop={(rowIndex) => rowTops[rowIndex] ?? 0}
            sortCount={table.state.sorting.length}
            gutter={Boolean(gutter)}
            gutterWidth={GUTTER_PX}
            theadRef={theadRef}
          />
          <MasterTableBody
            table={table}
            visibleRows={visibleRows}
            columnByKey={columnByKey}
            activeKey={activeKey}
            rowClassName={rowClassName}
            onRowClick={onRowClick}
            onRowHover={onRowHover}
            gutter={gutter}
            gutterWidth={GUTTER_PX}
          />
        </table>
        {visibleRows.length === 0 && (
          <div className="mx-auto max-w-md p-6 text-center">
            {rows.length > 0 ? (
              <EmptyState story="filter" exit="clear a chip in the strip above to bring them back">
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
    </ArtifactFrame>
  );
}
