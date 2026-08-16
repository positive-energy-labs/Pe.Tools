import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  useTable,
  type ColumnFiltersState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";

import { CellNavigationProvider, type CellMove } from "#/components/master-table/cell-navigation";
import { facetOptions, type Column, type MasterTableState } from "#/components/master-table/model";
import { masterTableFeatures, toColumnDefs } from "#/components/master-table/tanstack-adapter";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/ui/combobox";
import { cn } from "#/lib/utils";

export interface MasterTableProps<Row extends RowData> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  /** Left-hand label for the header strip, e.g. "families in scope". */
  scopeLabel: string;
  /** Free-text box; omit when no column declares `search`. */
  searchPlaceholder?: string;
  /** Chips for filters the ROUTE owns (plan scope, rail stage…). */
  chips?: { label: string; onClear: () => void }[];
  /** Trailing summary text for the header strip (counts, totals). */
  summary?: ReactNode;
  /** Shown when the route-owned scope is empty — say what would widen it. */
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  /** Extra per-row classes — for a route-owned highlight vocabulary the table cannot know. */
  rowClassName?: (row: Row) => string | undefined;
  /** Pointer entered/left a row. Absent ⇒ the table attaches no row hover handlers at all. */
  onRowHover?: (row: Row | null) => void;
  /** Highlighted row, if the route tracks a cursor. Kept scrolled into view. */
  activeKey?: string | null;
  /** Visible row order after filter, sort, and search. */
  onVisibleChange?: (keys: string[]) => void;
  /** Supply this with onTableStateChange when a route or agent owns table state. */
  tableState?: MasterTableState;
  onTableStateChange?: (state: MasterTableState) => void;
}

const emptyTableState = (): MasterTableState => ({ filters: {}, sorts: [], query: "" });

export function MasterTable<Row extends RowData>({
  rows,
  columns,
  rowKey,
  scopeLabel,
  searchPlaceholder,
  chips = [],
  summary,
  empty,
  onRowClick,
  rowClassName,
  onRowHover,
  activeKey,
  onVisibleChange,
  tableState,
  onTableStateChange,
}: MasterTableProps<Row>) {
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
      state: {
        sorting,
        columnFilters,
        globalFilter: resolvedState.query,
        columnPinning,
      },
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
        if (!query) return true;
        return (
          columnByKey.get(columnId)?.search?.(row.original).toLowerCase().includes(query) ?? false
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

  const visibleRows = table.getRowModel().rows;
  const cellsFor = (row: (typeof visibleRows)[number]) => [
    ...row.getStartVisibleCells(),
    ...row.getCenterVisibleCells(),
    ...row.getEndVisibleCells(),
  ];
  const visibleKeys = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);
  const onVisibleChangeRef = useRef(onVisibleChange);
  onVisibleChangeRef.current = onVisibleChange;
  useEffect(() => {
    onVisibleChangeRef.current?.(visibleKeys);
  }, [visibleKeys]);

  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  /* Sticky offsets are MEASURED per header ROW, not derived from `header.depth`. A grouped table
     renders one <tr> per group level (top→bottom, so the outer map index IS the visual row), and
     each row's `top` must equal the cumulative height of the rows above it. We measure each row's
     top POSITION rather than a row's height: an ungrouped column becomes a rowspan cell that
     inflates its origin row's measured height but never shifts where the rows below it actually
     begin, so positions stay honest where heights lie. */
  const theadRef = useRef<HTMLTableSectionElement | null>(null);
  const [rowTops, setRowTops] = useState<number[]>([]);
  useLayoutEffect(() => {
    const thead = theadRef.current;
    if (!thead) return;
    const measure = () => {
      const rows = Array.from(thead.rows);
      if (rows.length === 0) return;
      const base = rows[0]!.getBoundingClientRect().top;
      setRowTops(rows.map((row) => row.getBoundingClientRect().top - base));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return; // jsdom — the initial measure stands
    const observer = new ResizeObserver(measure);
    observer.observe(thead);
    return () => observer.disconnect();
  }, [columns]);
  const stickyTop = (rowIndex: number) => rowTops[rowIndex] ?? 0;

  const moveFrom = (origin: HTMLElement, direction: CellMove, wrapHorizontal = false): boolean => {
    const cell = origin.closest<HTMLTableCellElement>("[data-master-cell]");
    const row = cell?.parentElement;
    if (!cell || !row) return false;
    const siblingRow = direction === "up" ? row.previousElementSibling : row.nextElementSibling;
    let target: Element | null | undefined;
    if (direction === "up" || direction === "down") target = siblingRow?.children[cell.cellIndex];
    if (direction === "left") target = cell.previousElementSibling;
    if (direction === "right") target = cell.nextElementSibling;
    if (!target && wrapHorizontal && direction === "left") {
      target = row.previousElementSibling?.lastElementChild;
    }
    if (!target && wrapHorizontal && direction === "right") {
      target = row.nextElementSibling?.firstElementChild;
    }
    if (!(target instanceof HTMLElement)) return false;
    target.focus();
    return true;
  };

  const handleGridKey = (event: KeyboardEvent<HTMLTableCellElement>) => {
    if (event.key === "Enter" && editCell(event.currentTarget)) return event.preventDefault();
    if (isTypingKey(event) && editCell(event.currentTarget, event.key))
      return event.preventDefault();
    const direction = keyDirection(event.key, event.shiftKey);
    if (!direction) return;
    const tab = event.key === "Tab";
    const moved = moveFrom(event.currentTarget, direction, tab);
    if (!tab || moved) event.preventDefault();
  };

  const activeFilters = columns.filter((column) => resolvedState.filters[column.key]);
  const setFilter = (key: string, value: string | null) =>
    updateState((state) => {
      const filters = { ...state.filters };
      if (value === null) delete filters[key];
      else filters[key] = value;
      return { ...state, filters };
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-2 py-1">
        <span
          className="tele-label text-muted-foreground"
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
            className="tele h-6 w-44 rounded-[var(--radius)] border border-[var(--line-2)] bg-transparent px-1.5 outline-none focus:border-ring"
          />
        )}
        {/* The search box says how much it cut, right where the typing happens. */}
        {resolvedState.query && (
          <span
            className="tele text-muted-foreground"
            title="How many rows survive the free-text filter, out of every row in scope."
          >
            {visibleRows.length} of {rows.length}
          </span>
        )}
        {summary && <span className="tele text-muted-foreground">{summary}</span>}

        {chips.map((chip) => (
          <FilterChip key={chip.label} label={chip.label} onClear={chip.onClear} />
        ))}
        {resolvedState.query && (
          <FilterChip
            label={`search: ${resolvedState.query}`}
            onClear={() => updateState((state) => ({ ...state, query: "" }))}
          />
        )}
        {activeFilters.map((column) => (
          <FilterChip
            key={column.key}
            label={`${column.label}: ${labelOf(column, rows, resolvedState.filters[column.key] ?? "")}`}
            onClear={() => setFilter(column.key, null)}
          />
        ))}
        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={() => updateState((state) => ({ ...state, filters: {} }))}
            title="Drop every column filter at once. Filters owned by the route have their own chips and are left alone."
            className="tele rounded-[var(--radius)] px-1 text-muted-foreground hover:bg-muted"
          >
            clear column filters
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          role="grid"
          aria-rowcount={visibleRows.length}
          aria-colcount={columns.length}
          className="w-full border-collapse text-xs"
        >
          <thead ref={theadRef}>
            {table.getHeaderGroups().map((headerGroup, rowIndex) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  if (header.rowSpan === 0) return null;
                  const column = columnByKey.get(header.column.id);
                  return column ? (
                    <LeafHeader
                      key={header.id}
                      column={column}
                      rowSpan={header.rowSpan}
                      stickyTop={stickyTop(rowIndex)}
                      direction={header.column.getIsSorted()}
                      rank={header.column.getSortIndex()}
                      sortCount={table.state.sorting.length}
                      onSort={(additive) => header.column.toggleSorting(undefined, additive)}
                    >
                      {(column.facet || column.options) && (
                        <ColFilter
                          label={column.label}
                          value={resolvedState.filters[column.key] ?? null}
                          onChange={(value) => setFilter(column.key, value)}
                          all={column.all ?? "any"}
                          options={facetOptions(rows, column)}
                        />
                      )}
                    </LeafHeader>
                  ) : (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      rowSpan={header.rowSpan}
                      style={{ top: stickyTop(rowIndex) }}
                      className="tele-label sticky z-10 whitespace-nowrap border-b border-l border-[var(--line)] bg-muted px-1.5 py-px text-left font-normal text-muted-foreground first:border-l-0"
                    >
                      <table.FlexRender header={header} />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.map((tableRow, rowIndex) => {
              const key = tableRow.id;
              const cells = cellsFor(tableRow);
              return (
                <tr
                  key={key}
                  ref={activeKey === key ? activeRowRef : undefined}
                  className={cn(
                    "h-7 scroll-mt-12 hover:bg-muted/60",
                    activeKey === key && "bg-primary/[0.06]",
                    rowClassName?.(tableRow.original),
                  )}
                  onMouseEnter={onRowHover ? () => onRowHover(tableRow.original) : undefined}
                  onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
                  onClick={(event) => {
                    if (
                      (event.target as HTMLElement).closest(
                        "button,input,select,textarea,a,[role=button]",
                      )
                    )
                      return;
                    onRowClick?.(tableRow.original);
                  }}
                >
                  {cells.map((cell, columnIndex) => {
                    const column = columnByKey.get(cell.column.id);
                    if (!column) return null;
                    const isEntryCell =
                      table.getFocusedCell() === undefined && rowIndex === 0 && columnIndex === 0;
                    return (
                      <table.Subscribe
                        key={cell.id}
                        source={table.atoms.cellSelection}
                        selector={() =>
                          Number(cell.getIsFocused()) | (Number(cell.getIsSelected()) << 1)
                        }
                      >
                        {(selection) => (
                          <td
                            role="gridcell"
                            tabIndex={
                              selection & 1 || (isEntryCell && table.getFocusedCell() === undefined)
                                ? 0
                                : -1
                            }
                            aria-selected={Boolean(selection & 2)}
                            data-master-cell=""
                            onFocus={(event) => {
                              if (event.target === event.currentTarget) {
                                table.setFocusedCell(tableRow.id, cell.column.id);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.target === event.currentTarget) handleGridKey(event);
                            }}
                            onMouseDown={(event) => {
                              if (!isInteractive(event.target)) {
                                cell.getSelectionStartHandler(document)(event);
                              }
                            }}
                            onMouseEnter={cell.getSelectionExtendHandler()}
                            className={cn(
                              "border-b border-l border-[var(--line-soft)] p-0 outline-none first:border-l-0 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
                              selection & 2 && "bg-primary/[0.06]",
                              column.right && "text-right",
                              column.width,
                              column.lock && "sticky left-0 z-[5] bg-background",
                            )}
                          >
                            <CellNavigationProvider
                              move={(direction) =>
                                document.activeElement instanceof HTMLElement &&
                                moveFrom(document.activeElement, direction, true)
                              }
                            >
                              <table.FlexRender cell={cell} />
                            </CellNavigationProvider>
                          </td>
                        )}
                      </table.Subscribe>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleRows.length === 0 && (
          <p className="tele mx-auto max-w-md p-6 text-center text-[11px] text-muted-foreground">
            {rows.length > 0
              ? `All ${rows.length} rows in scope are filtered out — clear a chip in the strip above to bring them back.`
              : (empty ?? "Nothing in scope yet. Widen the scope above to fill the table.")}
          </p>
        )}
      </div>
    </div>
  );
}

function labelOf<Row>(column: Column<Row>, rows: readonly Row[], value: string): string {
  return facetOptions(rows, column).find((option) => option.value === value)?.label ?? value;
}

function LeafHeader<Row>({
  column,
  rowSpan,
  stickyTop,
  direction,
  rank,
  sortCount,
  onSort,
  children,
}: {
  column: Column<Row>;
  rowSpan: number;
  stickyTop: number;
  direction: false | "asc" | "desc";
  rank: number;
  sortCount: number;
  onSort: (additive: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <th
      title={column.title}
      rowSpan={rowSpan}
      style={{ top: stickyTop }}
      className={cn(
        "sticky z-10 align-top whitespace-nowrap border-b border-l border-[var(--line)] bg-muted px-1.5 py-1 font-normal first:border-l-0",
        column.right ? "text-right" : "text-left",
        column.width,
        column.lock && "left-0 z-20",
        column.headerClassName,
      )}
    >
      {column.sort ? (
        <button
          type="button"
          onClick={(event) => onSort(event.shiftKey)}
          title="Sort by this column. Clicking again flips the direction; shift-click appends it as a tie-breaker behind the sorts already applied, numbered in the header."
          className="tele-label block w-full text-left text-muted-foreground hover:text-foreground"
        >
          {column.header ?? column.label}
          {direction && (
            <span className="ml-1 text-foreground">
              {direction === "asc" ? "↑" : "↓"}
              {sortCount > 1 && <span className="opacity-60">{rank + 1}</span>}
            </span>
          )}
        </button>
      ) : (
        <span className="tele-label block text-muted-foreground">
          {column.header ?? column.label}
        </span>
      )}
      {children}
    </th>
  );
}

interface FacetChoice {
  value: string | null;
  label: string;
}

/** The facet filter is OUR combobox, not a native `<select>` — the popup of a native select
 * cannot be styled at all, and it was the one foreign-looking element left in the table. The
 * widen-back-out choice rides along as the first item; the strip's chip stays the other exit. */
function ColFilter({
  label,
  value,
  onChange,
  options,
  all,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: { value: string; label: string }[];
  all: string;
}) {
  const anchorRef = useComboboxAnchor();
  const choices = useMemo<FacetChoice[]>(
    () => [{ value: null, label: all }, ...options],
    [all, options],
  );
  const selected = choices.find((choice) => choice.value === value) ?? choices[0];
  return (
    <Combobox
      items={choices}
      value={selected}
      onValueChange={(choice: FacetChoice | null) => onChange(choice ? choice.value : null)}
      itemToStringLabel={(choice: FacetChoice) => choice.label}
    >
      {/* ponytail: explicit anchor on the trigger — the in-popup search input must not be the
          positioner anchor or the popup jitters (see control-chips.tsx). */}
      <div ref={anchorRef} className="mt-0.5 flex">
        <ComboboxTrigger
          aria-label={`${label} filter`}
          title="Narrow the table to one value of this column. The choices are every value present across ALL rows, so they stay put as other filters move."
          className={cn(
            "tele flex h-5 w-full min-w-0 max-w-32 items-center justify-between gap-0.5 rounded-[var(--radius)] border bg-transparent px-1 font-normal outline-none",
            value
              ? "border-primary/40 bg-primary/[0.06] text-foreground"
              : "border-[var(--line-soft)] text-muted-foreground hover:border-[var(--line-2)]",
          )}
        >
          <span className="truncate normal-case">{value === null ? all : selected.label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef} className="min-w-44 rounded-[var(--radius)]">
        {options.length > 7 && <ComboboxInput placeholder="filter values…" />}
        <ComboboxEmpty>No matching values</ComboboxEmpty>
        <ComboboxList>
          {(choice: FacetChoice) => (
            <ComboboxItem key={choice.value ?? "\u0000all"} value={choice} className="pr-7">
              <span className={cn("truncate", choice.value === null && "text-muted-foreground")}>
                {choice.label}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      title="This filter is narrowing the table right now. Click to drop it and widen the scope back out."
      className="tele inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--line-2)] bg-muted px-1.5 py-px hover:border-destructive/40 hover:text-destructive"
    >
      <span className="normal-case">{label}</span>
      <span className="opacity-60">×</span>
    </button>
  );
}

function toSortingState(sorts: MasterTableState["sorts"]): SortingState {
  return sorts.map((sort) => ({ id: sort.key, desc: sort.dir === "desc" }));
}

function fromSortingState(sorting: SortingState): MasterTableState["sorts"] {
  return sorting.map((sort) => ({ key: sort.id, dir: sort.desc ? "desc" : "asc" }));
}

function toColumnFiltersState(filters: MasterTableState["filters"]): ColumnFiltersState {
  return Object.entries(filters).map(([id, value]) => ({ id, value }));
}

function fromColumnFiltersState(filters: ColumnFiltersState): MasterTableState["filters"] {
  return Object.fromEntries(filters.map((filter) => [filter.id, String(filter.value)]));
}

function resolveUpdater<Value>(
  update: Value | ((previous: Value) => Value),
  previous: Value,
): Value {
  return typeof update === "function" ? (update as (previous: Value) => Value)(previous) : update;
}

function keyDirection(key: string, shift: boolean): CellMove | null {
  if (key === "ArrowUp" || (key === "Enter" && shift)) return "up";
  if (key === "ArrowDown" || key === "Enter") return "down";
  if (key === "ArrowLeft" || (key === "Tab" && shift)) return "left";
  if (key === "ArrowRight" || key === "Tab") return "right";
  return null;
}

function editCell(cell: HTMLTableCellElement, replacement?: string): boolean {
  const editor = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input:not([disabled]),textarea:not([disabled])",
  );
  if (!editor) return false;
  editor.focus();
  if (replacement !== undefined) editor.value = replacement;
  const end = editor.value.length;
  editor.setSelectionRange(end, end);
  return true;
}

function isTypingKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

function isInteractive(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button,input,select,textarea,a,[role=button]") !== null
  );
}
