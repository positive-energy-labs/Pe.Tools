import { useContext } from "react";
import type { ReactTable, RowData } from "@tanstack/react-table";

import type { ResolvedColumn } from "./master-table-columns";
import type { Column } from "./model";
import type { MasterTableFeatures } from "./tanstack-adapter";
import { cn } from "../../lib/utils";
import { ColumnMenu, ColumnQuery } from "./query-workbench";
import { SortMark } from "./sort-mark";
import { TooltipHint } from "../lang/tooltip";

type Table<Row extends RowData> = ReactTable<MasterTableFeatures, Row, unknown>;

export function MasterTableHeader<Row extends RowData>({
  table,
  columnByKey,
  stickyTop,
  sortCount,
  gutter,
  gutterWidth,
  theadRef,
}: {
  table: Table<Row>;
  columnByKey: ReadonlyMap<string, ResolvedColumn<Row>>;
  stickyTop: (rowIndex: number) => number;
  sortCount: number;
  gutter: boolean;
  gutterWidth: number;
  theadRef: React.RefObject<HTMLTableSectionElement | null>;
}) {
  const headerGroups = table.getHeaderGroups();
  return (
    <thead ref={theadRef}>
      {headerGroups.map((headerGroup, rowIndex) => (
        <tr key={headerGroup.id}>
          {gutter && rowIndex === 0 && (
            <TooltipHint content="Rows marked in this gutter owe a person a decision — the mark's own title says what.">
              <th
                rowSpan={headerGroups.length}
                style={{ top: 0, width: gutterWidth, minWidth: gutterWidth }}
                className="sticky left-0 z-[calc(var(--z-sticky)+1)] border-b border-line p-0 on-recess"
              />
            </TooltipHint>
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
                lockLeft={gutter ? gutterWidth : 0}
                direction={header.column.getIsSorted()}
                rank={header.column.getSortIndex()}
                sortCount={sortCount}
                onSort={(additive) => header.column.toggleSorting(undefined, additive)}
              />
            ) : (
              <th
                key={header.id}
                colSpan={header.colSpan}
                rowSpan={header.rowSpan}
                style={{ top: stickyTop(rowIndex) }}
                className="role-colhead sticky z-sticky whitespace-nowrap h-(--item-h) shadow-[inset_0_-1px_0_var(--pe-line)] border-l border-line px-(--item-pad-x) py-0 text-left on-recess first:border-l-0"
              >
                <table.FlexRender header={header} />
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
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
}: {
  column: Column<Row>;
  rowSpan: number;
  stickyTop: number;
  lockLeft: number;
  direction: false | "asc" | "desc";
  rank: number;
  sortCount: number;
  onSort: (additive: boolean) => void;
}) {
  const menu = useContext(ColumnQuery) !== null && column.condition !== undefined;
  const heading = column.header ?? column.label;
  return (
    <TooltipHint content={column.title}>
      <th
        data-column-key={column.key}
        data-lock={column.lock ? "" : undefined}
        rowSpan={rowSpan}
        style={{
          top: stickyTop,
          left: column.lock ? lockLeft : undefined,
          zIndex: column.lock ? "calc(var(--z-sticky) + 1)" : undefined,
        }}
        className={cn(
          "sticky z-sticky h-(--item-h) whitespace-nowrap shadow-[inset_0_-1px_0_var(--pe-line)] border-l border-line p-0 align-middle font-normal on-recess first:border-l-0",
          column.right ? "text-right" : "text-left",
          column.width,
          column.headerClassName,
        )}
      >
        {menu ? (
          <ColumnMenu
            label={column.label}
            heading={heading}
            direction={direction}
            rank={rank}
            sortCount={sortCount}
            right={column.right}
          />
        ) : column.sort ? (
          <button
            type="button"
            data-colhead-trigger=""
            className={cn("dl-button w-full", column.right ? "justify-end" : "justify-start")}
            aria-label={`sort ${column.label}`}
            onClick={(event) => onSort(event.shiftKey)}
          >
            <span className="role-colhead min-w-0 truncate">{heading}</span>
            {direction && <SortMark direction={direction} rank={rank} count={sortCount} />}
          </button>
        ) : (
          <span className="role-colhead block truncate px-(--item-pad-x)">{heading}</span>
        )}
      </th>
    </TooltipHint>
  );
}
