import {
  createRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { ReactTable, RowData } from "@tanstack/react-table";

import { CellHost } from "#/components/lang/cell";
import { Row } from "#/components/lang/row";
import { CellNavigationProvider, type CellMove } from "#/components/master-table/cell-navigation";
import type { ResolvedColumn } from "#/components/master-table/master-table-columns";
import {
  CELL_EDITOR,
  editCell,
  isInteractive,
  isTypingKey,
  keyDirection,
} from "#/components/master-table/master-table-state";
import type { MasterTableFeatures } from "#/components/master-table/tanstack-adapter";
import { token } from "#/lib/token";
import { cn } from "#/lib/utils";

type Table<Row extends RowData> = ReactTable<MasterTableFeatures, Row, unknown>;
type VisibleRow<Row extends RowData> = ReturnType<Table<Row>["getRowModel"]>["rows"][number];
type Gutter<Row> = (row: Row) => {
  count: number;
  title: string;
  tone?: "alarm" | "caution";
} | null;

interface MasterRowProps<Row extends RowData> {
  row: Row;
  active: boolean;
  selected?: boolean;
  /** Present, the row refuses selection and says why. */
  refusal?: string | null;
  activeRowRef: React.RefObject<HTMLTableRowElement | null>;
  className: string;
  onRowClick?: (row: Row) => void;
  onSelect?: (event: MouseEvent<HTMLTableRowElement>) => void;
  onRowHover?: (row: Row | null) => void;
  /** The columns the children were drawn from: a row's cells redraw when the columns do. */
  columns: unknown;
  children: ReactNode;
}

function MasterRowView<Row extends RowData>({
  row,
  active,
  selected,
  refusal,
  activeRowRef,
  className,
  onRowClick,
  onSelect,
  onRowHover,
  children,
}: MasterRowProps<Row>) {
  return (
    <Row
      as="tr"
      ref={active ? activeRowRef : undefined}
      active={active}
      selected={selected}
      refusal={refusal}
      className={className}
      onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
      onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button,input,select,textarea,a,[role=button]"))
          return;
        onSelect?.(event as MouseEvent<HTMLTableRowElement>);
        onRowClick?.(row);
      }}
    >
      {children}
    </Row>
  );
}

const MasterRow = memo(
  MasterRowView,
  (previous, next) =>
    previous.row === next.row &&
    previous.active === next.active &&
    previous.selected === next.selected &&
    previous.refusal === next.refusal &&
    previous.className === next.className &&
    previous.onRowClick === next.onRowClick &&
    previous.onSelect === next.onSelect &&
    previous.onRowHover === next.onRowHover &&
    // Cell state often lives in the columns (a route's Work), not the row: without this, a
    // stable row skipped every Work change and a staged cell never showed its mark.
    previous.columns === next.columns,
) as typeof MasterRowView;

export function MasterTableBody<Row extends RowData>({
  table,
  visibleRows,
  columnByKey,
  activeKey,
  rowClassName,
  onRowClick,
  selectedKeys,
  refusalOf,
  onSelect,
  onRowHover,
  gutter,
  gutterWidth,
}: {
  table: Table<Row>;
  visibleRows: VisibleRow<Row>[];
  columnByKey: ReadonlyMap<string, ResolvedColumn<Row>>;
  activeKey?: string | null;
  rowClassName?: (row: Row) => string | undefined;
  onRowClick?: (row: Row) => void;
  selectedKeys?: ReadonlySet<string>;
  refusalOf?: (key: string) => string | null | undefined;
  onSelect?: (key: string, range: boolean) => void;
  onRowHover?: (row: Row | null) => void;
  gutter?: Gutter<Row>;
  gutterWidth: number;
}) {
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  // The td is each cell's keyboard host: one stable ref per cell id, handed to whatever the column
  // draws (a StateCell registers its verbs on it). ponytail: never pruned; ids are bounded by rows.
  const hosts = useRef(new Map<string, RefObject<HTMLTableCellElement | null>>());
  const hostOf = (id: string) => {
    let ref = hosts.current.get(id);
    if (!ref) hosts.current.set(id, (ref = createRef<HTMLTableCellElement>()));
    return ref;
  };
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

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
      if ((event.key === "Enter" || event.key === "F2") && editCell(event.currentTarget))
        return event.preventDefault();
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

  return (
    <tbody>
      {visibleRows.map((tableRow, rowIndex) => {
        const key = tableRow.id;
        const cells = [
          ...tableRow.getStartVisibleCells(),
          ...tableRow.getCenterVisibleCells(),
          ...tableRow.getEndVisibleCells(),
        ];
        return (
          <MasterRow
            key={key}
            row={tableRow.original}
            active={activeKey === key}
            selected={selectedKeys ? selectedKeys.has(key) : undefined}
            refusal={refusalOf?.(key)}
            activeRowRef={activeRowRef}
            className={cn("veil h-(--item-h) scroll-mt-12", rowClassName?.(tableRow.original))}
            onRowClick={onRowClick}
            onSelect={onSelect ? (event) => onSelect(key, event.shiftKey) : undefined}
            onRowHover={onRowHover}
            columns={columnByKey}
          >
            {gutter && <GutterCell row={tableRow.original} gutter={gutter} width={gutterWidth} />}
            {cells.map((cell, columnIndex) => {
              const column = columnByKey.get(cell.column.id);
              if (!column) return null;
              const isEntryCell =
                table.getFocusedCell() === undefined && rowIndex === 0 && columnIndex === 0;
              return (
                <table.Subscribe
                  key={cell.id}
                  source={table.atoms.cellSelection}
                  selector={() => Number(cell.getIsFocused()) | (Number(cell.getIsSelected()) << 1)}
                >
                  {(selection) => (
                    <td
                      ref={hostOf(cell.id)}
                      role="gridcell"
                      tabIndex={
                        selection & 1 || (isEntryCell && table.getFocusedCell() === undefined)
                          ? 0
                          : -1
                      }
                      aria-selected={Boolean(selection & 2)}
                      data-master-cell=""
                      onFocus={(event) => {
                        if (event.target === event.currentTarget)
                          table.setFocusedCell(tableRow.id, cell.column.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget) handleGridKey(event);
                      }}
                      onMouseDown={(event) => {
                        // A click SELECTS the cell (F-J3-5a): an idle editor under the pointer
                        // would take the caret and make typing append. The td takes focus; the
                        // first printable key then replaces the value, and a double-click, F2 or
                        // Enter edits in place.
                        const target = event.target as HTMLElement;
                        if (target.matches(CELL_EDITOR) && document.activeElement !== target) {
                          event.preventDefault();
                          event.currentTarget.focus();
                        }
                        if (!isInteractive(event.target))
                          cell.getSelectionStartHandler(document)(event);
                      }}
                      onDoubleClick={(event) => {
                        if (document.activeElement === event.currentTarget)
                          editCell(event.currentTarget);
                      }}
                      onMouseEnter={cell.getSelectionExtendHandler()}
                      style={column.lock ? { left: gutter ? gutterWidth : 0 } : undefined}
                      className={cn(
                        // The row rule is drawn INSIDE the cell: a border on a td adds to the row box and put
                        // every list row at 21px (measured, annotation round 2 2026-08-31).
                        "hairline-b-inset border-l border-line p-0 outline-none first:border-l-0 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-2",
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
                        <CellHost.Provider value={hostOf(cell.id)}>
                          {/* The column's own renderer, called, never `FlexRender`: TanStack
                            renders a def's `cell` as a component TYPE, and the def is rebuilt
                            whenever the columns are, so every cell remounted on each Work change
                            and a half-typed value (and focus) vanished with its input (O8-c). */}
                          {column.cell(tableRow.original)}
                        </CellHost.Provider>
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
  );
}

function GutterCell<Row>({ row, gutter, width }: { row: Row; gutter: Gutter<Row>; width: number }) {
  const owed = gutter(row);
  return (
    <td
      data-master-gutter=""
      title={owed?.title}
      style={{ width, minWidth: width }}
      className="hairline-b-inset sticky left-0 z-[5] bg-on p-0 text-center align-middle"
    >
      {owed && (
        <span className="t-small face-mono" style={{ color: token(owed.tone ?? "caution") }}>
          {owed.count}
        </span>
      )}
    </td>
  );
}
