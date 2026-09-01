import { memo, useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ReactTable, RowData } from "@tanstack/react-table";

import { CellNavigationProvider, type CellMove } from "#/components/master-table/cell-navigation";
import type { ResolvedColumn } from "#/components/master-table/master-table-columns";
import {
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
  activeRowRef: React.RefObject<HTMLTableRowElement | null>;
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
    previous.className === next.className &&
    previous.onRowClick === next.onRowClick &&
    previous.onRowHover === next.onRowHover,
) as typeof MasterRowView;

export function MasterTableBody<Row extends RowData>({
  table,
  visibleRows,
  columnByKey,
  activeKey,
  rowClassName,
  onRowClick,
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
  onRowHover?: (row: Row | null) => void;
  gutter?: Gutter<Row>;
  gutterWidth: number;
}) {
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
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
            activeRowRef={activeRowRef}
            className={cn(
              "h-(--item-h) scroll-mt-12 hover:veil",
              activeKey === key && "on-select",
              rowClassName?.(tableRow.original),
            )}
            onRowClick={onRowClick}
            onRowHover={onRowHover}
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
                        if (!isInteractive(event.target))
                          cell.getSelectionStartHandler(document)(event);
                      }}
                      onMouseEnter={cell.getSelectionExtendHandler()}
                      style={column.lock ? { left: gutter ? gutterWidth : 0 } : undefined}
                      className={cn(
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
  );
}

function GutterCell<Row>({ row, gutter, width }: { row: Row; gutter: Gutter<Row>; width: number }) {
  const owed = gutter(row);
  return (
    <td
      data-master-gutter=""
      title={owed?.title}
      style={{ width, minWidth: width }}
      className="sticky left-0 z-[5] border-b border-line bg-on p-0 text-center align-middle"
    >
      {owed && (
        <span className="face-mono t-caption" style={{ color: token(owed.tone ?? "caution") }}>
          {owed.count}
        </span>
      )}
    </td>
  );
}
