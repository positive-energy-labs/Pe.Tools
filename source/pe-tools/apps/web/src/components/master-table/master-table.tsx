import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { token } from "#/lib/token";
import {
  useTable,
  type ColumnFiltersState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";

import {
  CELL_STATE_ORDER,
  StateCell,
  cellFactsText,
  cellStateLabel,
  type StateCellProps,
} from "#/components/lang/cell";
import { NarrowChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { CellNavigationProvider, type CellMove } from "#/components/master-table/cell-navigation";
import { VerdictCell } from "#/components/master-table/cells";
import {
  facetOptions,
  type Column,
  type MasterTableState,
  type ValueColumn,
} from "#/components/master-table/model";
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
import { Press } from "#/components/lang/press";

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
  /** Route-owned visible row order after filter, sort, and search. */
  visibleKeys?: readonly string[];
  /** Supply this with onTableStateChange when a route or agent owns table state. */
  tableState?: MasterTableState;
  onTableStateChange?: (state: MasterTableState) => void;
  /**
   * THE OWED MARKER (ruled 2026-08-16 — fit reviews' highest-leverage build; R3's row-fact
   * primitive, finally real): "a person must act on this row". Presence-based — return null
   * for a row owing nothing. Renders a narrow leading GUTTER cell carrying the count in the
   * tone's ink (`caution` by default); the `title` carries the sentence. It LOCATES, nothing
   * more: no verb, no click — the row's own verbs do the acting.
   *
   * LOCK INTERACTION: the gutter is sticky at `left-0`, and when it is present the table
   * shifts `lock` columns right by the gutter's fixed width (GUTTER_PX) so both stay visible
   * while the table scrolls. Do not lock a column to a width that assumes `left-0`.
   */
  gutter?: (row: Row) => { count: number; title: string; tone?: "alarm" | "caution" } | null;
}

const emptyTableState = (): MasterTableState => ({ filters: {}, sorts: [], query: "" });

/** The gutter's one width — the th/td class and the lock-column offset must agree. */
const GUTTER_PX = 18;

interface MasterRowProps<Row extends RowData> {
  row: Row;
  active: boolean;
  columns: readonly Column<Row>[];
  rowMarker?: MasterTableProps<Row>["gutter"];
  activeRowRef: RefObject<HTMLTableRowElement | null>;
  className: string;
  onRowClick?: (row: Row) => void;
  onRowHover?: (row: Row | null) => void;
  children: ReactNode;
}

function MasterRowView<Row extends RowData>({
  row,
  active,
  activeRowRef,
  className,
  onRowClick,
  onRowHover,
  children,
}: MasterRowProps<Row>) {
  return (
    <tr
      ref={active ? activeRowRef : undefined}
      className={className}
      onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
      onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button,input,select,textarea,a,[role=button]"))
          return;
        onRowClick?.(row);
      }}
    >
      {children}
    </tr>
  );
}

const MasterRow = memo(
  MasterRowView,
  (previous, next) =>
    previous.row === next.row &&
    previous.active === next.active &&
    previous.columns === next.columns &&
    previous.rowMarker === next.rowMarker &&
    previous.className === next.className &&
    previous.onRowClick === next.onRowClick &&
    previous.onRowHover === next.onRowHover,
) as typeof MasterRowView;

/**
 * THE CELL-STATE CLAUSE, executed once at the boundary. A `state` column resolves to a plain
 * column whose cell is the language's `StateCell` in the primitive's own box model, and whose
 * facet/sort default to the grammar's one-word reading — so the table filters, counts and
 * orders by cell state without any consumer modelling the fact a second time, and the word in
 * the filter can never disagree with the marks in the cell.
 */
type ResolvedColumn<Row> = ValueColumn<Row> & {
  /** Kept off the public union: the table's own handles on a state column's readers, so the
   * readout band can re-read the focused cell's facts without the consumer re-supplying them. */
  readState?: (row: Row) => StateCellProps;
  readWord?: (row: Row) => string;
};

function resolveStateColumn<Row>(column: Column<Row>): ResolvedColumn<Row> {
  // THE VERDICT CLAUSE (ruled 2026-08-16, R5): a row-level pipeline verdict — dot + the
  // route's own word, tone from the narrow meaning-role union. Facet/sort default to the word.
  if (column.verdict !== undefined) {
    const verdict = column.verdict;
    return {
      ...column,
      verdict: undefined,
      cell: (row: Row) => <VerdictCell verdict={verdict(row)} />,
      facet: column.facet ?? ((row: Row) => verdict(row).word),
      sort: column.sort ?? ((row: Row) => verdict(row).word),
    } as ResolvedColumn<Row>;
  }
  const state = column.state;
  if (state === undefined) return column;
  // The word the filter/facet/readout speak: the route's domain vocabulary when supplied,
  // else the grammar's universal eight (CELL_STATE_ORDER, `never` included). Sort stays
  // attention order of the universal reading either way — the MARKS are universal even when
  // the word is the route's.
  const word = column.word ?? ((row: Row) => cellStateLabel(state(row)));
  return {
    ...column,
    state: undefined,
    word: undefined,
    // ROW SCALE (ruled 2026-08-16): the cell IS the td's content box — one clipped line,
    // full-bleed, so the body wash covers the whole cell. Prose facts read out in the band
    // below the table, never inside the row.
    cell: (row: Row) => <StateCell scale="row" {...state(row)} />,
    facet: column.facet ?? word,
    sort: column.sort ?? ((row: Row) => CELL_STATE_ORDER.indexOf(cellStateLabel(state(row)))),
    readState: state,
    readWord: word,
  } as ResolvedColumn<Row>;
}

export function MasterTable<Row extends RowData>({
  rows,
  columns: rawColumns,
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

  const tableRows =
    visibleKeys === undefined ? table.getRowModel().rows : table.getCoreRowModel().rows;
  const visibleRows = useMemo(() => {
    if (visibleKeys === undefined) return tableRows;
    const byId = new Map(tableRows.map((row) => [row.id, row]));
    return visibleKeys.map((key) => byId.get(key)).filter((row) => row !== undefined);
  }, [tableRows, visibleKeys]);
  const cellsFor = useCallback(
    (row: (typeof visibleRows)[number]) => [
      ...row.getStartVisibleCells(),
      ...row.getCenterVisibleCells(),
      ...row.getEndVisibleCells(),
    ],
    [],
  );
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

  const moveFrom = useCallback(
    (origin: HTMLElement, direction: CellMove, wrapHorizontal = false): boolean => {
      const cell = origin.closest<HTMLTableCellElement>("[data-master-cell]");
      const row = cell?.parentElement;
      if (!cell || !row) return false;
      const siblingRow = direction === "up" ? row.previousElementSibling : row.nextElementSibling;
      let target: Element | null | undefined;
      if (direction === "up" || direction === "down") target = siblingRow?.children[cell.cellIndex];
      if (direction === "left") target = cell.previousElementSibling;
      if (direction === "right") target = cell.nextElementSibling;
      if (!target && wrapHorizontal && direction === "left")
        target = row.previousElementSibling?.lastElementChild;
      if (!target && wrapHorizontal && direction === "right")
        target = row.nextElementSibling?.firstElementChild;
      if (target instanceof HTMLElement && target.hasAttribute("data-master-gutter"))
        target = direction === "left" ? null : target.nextElementSibling;
      if (!(target instanceof HTMLElement)) return false;
      target.focus();
      return true;
    },
    [],
  );

  const handleGridKey = useCallback(
    (event: KeyboardEvent<HTMLTableCellElement>) => {
      if (event.key === "Enter" && editCell(event.currentTarget)) return event.preventDefault();
      if (isTypingKey(event) && editCell(event.currentTarget, event.key))
        return event.preventDefault();
      const direction = keyDirection(event.key, event.shiftKey);
      if (!direction) return;
      const tab = event.key === "Tab";
      const moved = moveFrom(event.currentTarget, direction, tab);
      if (!tab || moved) event.preventDefault();
    },
    [moveFrom],
  );

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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1">
        <span
          className="t-label t-upper text-ink-2"
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
            className="face-mono t-value h-6 w-44 rounded-sm border border-line-2 bg-transparent px-1.5 outline-none focus:border-line-2 focus:veil"
          />
        )}
        {/* The search box says how much it cut, right where the typing happens. */}
        {resolvedState.query && (
          <span
            className="face-mono t-value text-ink-2"
            title="How many rows survive the free-text filter, out of every row in scope."
          >
            {visibleRows.length} of {rows.length}
          </span>
        )}
        {summary && <span className="face-mono t-value text-ink-2">{summary}</span>}

        {/* THE STRIP'S CHIPS ARE THE LANGUAGE'S NarrowChip (fit reviews, ruled 2026-08-16 —
            FilterChip stated the same fact on different tokens and is deleted). The count is
            rows still in scope under ALL active narrowings — the strip has no per-chip
            denominator, and "what survives right now" is the honest number it can state. */}
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
            className="t-label rounded-sm px-1 text-ink-2 hover:veil"
          >
            clear column filters
          </Press>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          role="grid"
          aria-rowcount={visibleRows.length}
          aria-colcount={columns.length + (gutter ? 1 : 0)}
          className="w-full border-collapse t-value"
        >
          <thead ref={theadRef}>
            {table.getHeaderGroups().map((headerGroup, rowIndex) => (
              <tr key={headerGroup.id}>
                {gutter && rowIndex === 0 && (
                  <th
                    rowSpan={table.getHeaderGroups().length}
                    style={{ top: 0, width: GUTTER_PX, minWidth: GUTTER_PX }}
                    title="Rows marked in this gutter owe a person a decision — the mark's own title says what."
                    className="sticky left-0 z-sticky border-b border-line bg-recess p-0 on-recess"
                  />
                )}
                {headerGroup.headers.map((header) => {
                  if (header.rowSpan === 0) return null;
                  const column = columnByKey.get(header.column.id);
                  return column ? (
                    <LeafHeader
                      key={header.id}
                      column={column}
                      rowSpan={header.rowSpan}
                      stickyTop={stickyTop(rowIndex)}
                      lockLeft={gutter ? GUTTER_PX : 0}
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
                      className="t-caption t-upper sticky z-sticky whitespace-nowrap border-b border-l border-line bg-recess px-1.5 py-px text-left text-ink-2 on-recess first:border-l-0"
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
                <MasterRow
                  key={key}
                  row={tableRow.original}
                  active={activeKey === key}
                  columns={columns}
                  rowMarker={gutter}
                  activeRowRef={activeRowRef}
                  className={cn(
                    // THE HOVER LAW: the one neutral veil, composited over whatever fill the row
                    // carries. THE SELECTION LAW: the active row is a fill (--pe-select), never a
                    // hue, and re-declares --pe-on so cell washes land on the right ground.
                    "h-7 scroll-mt-12 hover:veil",
                    activeKey === key && "on-select",
                    rowClassName?.(tableRow.original),
                  )}
                  onRowClick={onRowClick}
                  onRowHover={onRowHover}
                >
                  {gutter &&
                    (() => {
                      const owed = gutter(tableRow.original);
                      return (
                        <td
                          data-master-gutter=""
                          title={owed?.title}
                          style={{ width: GUTTER_PX, minWidth: GUTTER_PX }}
                          className="sticky left-0 z-[5] border-b border-line bg-on p-0 text-center align-middle"
                        >
                          {owed && (
                            <span
                              className="face-mono t-caption"
                              style={{ color: token(owed.tone ?? "caution") }}
                            >
                              {owed.count}
                            </span>
                          )}
                        </td>
                      );
                    })()}
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
                            style={column.lock ? { left: gutter ? GUTTER_PX : 0 } : undefined}
                            className={cn(
                              // Focus is a firm hairline; selection is the select fill. Locked
                              // columns sit on --pe-on — the ground of whatever contains the table.
                              "border-b border-l border-line p-0 outline-none first:border-l-0 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-2",
                              selection & 2 && "on-select",
                              column.right && "text-right",
                              column.width,
                              column.lock && "sticky z-[5] bg-on",
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
                </MasterRow>
              );
            })}
          </tbody>
        </table>
        {visibleRows.length === 0 && (
          <div className="mx-auto max-w-md p-6 text-center">
            {rows.length > 0 ? (
              <EmptyState
                story="filter"
                exit="clear a chip in the strip above to bring them back"
              >{`all ${rows.length} rows in scope are filtered out`}</EmptyState>
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

      {/* THE READOUT BAND (ruled 2026-08-16; narrowed at the fit-review sitting): rows never
          grow, so the focused cell's prose — state word, refusal reason, note, citation, the
          model's ghost value — reads out HERE, the way a spreadsheet's formula bar reads out
          the active cell. It renders ONLY while a state cell is focused — the idle tutorial
          placeholder is dead; when nothing is focused the band is absent entirely. */}
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
            const facts = cellFactsText(cellState);
            return (
              <div className="face-mono t-label flex h-6 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-t border-line bg-recess px-2 whitespace-nowrap on-recess">
                <span className="dl-tag shrink-0 text-ink">
                  {column?.readWord?.(focused.row.original) ?? cellStateLabel(cellState)}
                </span>
                <span className="truncate text-ink-2">
                  {facts ?? "nothing further — the marks on the cell are the whole story"}
                </span>
              </div>
            );
          }}
        </table.Subscribe>
      )}
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
  lockLeft,
  direction,
  rank,
  sortCount,
  onSort,
  children,
}: {
  column: Column<Row>;
  rowSpan: number;
  stickyTop: number;
  /** Where a locked column pins: 0, or the gutter's width when the owed marker is present. */
  lockLeft: number;
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
      style={{ top: stickyTop, left: column.lock ? lockLeft : undefined }}
      className={cn(
        "sticky z-sticky align-top whitespace-nowrap border-b border-l border-line bg-recess px-1.5 py-1 font-normal on-recess first:border-l-0",
        column.right ? "text-right" : "text-left",
        column.width,
        column.lock && "z-sticky",
        column.headerClassName,
      )}
    >
      {column.sort ? (
        <Press
          type="button"
          onClick={(event) => onSort(event.shiftKey)}
          title="Sort by this column. Clicking again flips the direction; shift-click appends it as a tie-breaker behind the sorts already applied, numbered in the header."
          className="t-caption t-upper block w-full text-left text-ink-2 hover:text-ink"
        >
          {column.header ?? column.label}
          {direction && (
            <span className="ml-1 text-ink">
              {direction === "asc" ? "↑" : "↓"}
              {sortCount > 1 && <span className="opacity-60">{rank + 1}</span>}
            </span>
          )}
        </Press>
      ) : (
        <span className="t-caption t-upper block text-ink-2">{column.header ?? column.label}</span>
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
            "face-mono t-caption flex h-5 w-full min-w-0 max-w-32 items-center justify-between gap-0.5 rounded-sm border bg-transparent px-1 font-normal outline-none",
            // An active filter is "lit" — the select fill, never a hue.
            value
              ? "border-line-2 bg-select text-ink"
              : "border-line text-ink-2 hover:border-line-2",
          )}
        >
          <span className="truncate normal-case">{value === null ? all : selected.label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef} className="min-w-44 rounded-sm">
        {options.length > 7 && <ComboboxInput placeholder="filter values…" />}
        <ComboboxEmpty>No matching values</ComboboxEmpty>
        <ComboboxList>
          {(choice: FacetChoice) => (
            <ComboboxItem key={choice.value ?? "\u0000all"} value={choice} className="pr-7">
              <span className={cn("truncate", choice.value === null && "text-ink-2")}>
                {choice.label}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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
