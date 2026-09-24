import { useContext, type ReactNode } from "react";
import { ListFilter } from "lucide-react";
import type { ReactTable, RowData } from "@tanstack/react-table";

import { Press } from "#/components/lang/press";
import type { ResolvedColumn } from "#/components/master-table/master-table-columns";
import type { Column } from "#/components/master-table/model";
import type { MasterTableFeatures } from "#/components/master-table/tanstack-adapter";
import { cn } from "#/lib/utils";
import { PressContent } from "#/components/anatomy/press-content";
import { ConditionTarget } from "#/components/master-table/query";
import { opSaid, readQuery } from "#/components/master-table/view";

type Table<Row extends RowData> = ReactTable<MasterTableFeatures, Row, unknown>;

export function MasterTableHeader<Row extends RowData>({
  table,
  columnByKey,
  query,
  stickyTop,
  sortCount,
  gutter,
  gutterWidth,
  theadRef,
}: {
  table: Table<Row>;
  columnByKey: ReadonlyMap<string, ResolvedColumn<Row>>;
  query: string;
  stickyTop: (rowIndex: number) => number;
  sortCount: number;
  gutter: boolean;
  gutterWidth: number;
  theadRef: React.RefObject<HTMLTableSectionElement | null>;
}) {
  const headerGroups = table.getHeaderGroups();
  const editCondition = useContext(ConditionTarget);
  const clauses = readQuery(query);
  return (
    <thead ref={theadRef}>
      {headerGroups.map((headerGroup, rowIndex) => (
        <tr key={headerGroup.id}>
          {gutter && rowIndex === 0 && (
            <th
              rowSpan={headerGroups.length}
              style={{ top: 0, width: gutterWidth, minWidth: gutterWidth }}
              title="Rows marked in this gutter owe a person a decision — the mark's own title says what."
              className="sticky left-0 z-sticky border-b border-line p-0 on-recess"
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
                lockLeft={gutter ? gutterWidth : 0}
                direction={header.column.getIsSorted()}
                rank={header.column.getSortIndex()}
                sortCount={sortCount}
                onSort={(additive) => header.column.toggleSorting(undefined, additive)}
              >
                {column.condition && editCondition && (
                  <ConditionPress
                    said={clauses.flatMap((clause) =>
                      clause.kind === "field" &&
                      clause.label.toLowerCase() === column.label.toLowerCase()
                        ? [
                            `${clause.not ? "not " : ""}${opSaid(column.condition!.kind, clause.op, clause.value)}`,
                          ]
                        : [],
                    )}
                    column={column}
                    onClick={() => editCondition(column.label)}
                  />
                )}
              </LeafHeader>
            ) : (
              <th
                key={header.id}
                colSpan={header.colSpan}
                rowSpan={header.rowSpan}
                style={{ top: stickyTop(rowIndex) }}
                className="t-small t-upper sticky z-sticky whitespace-nowrap border-b border-l border-line px-(--item-pad-x) py-px text-left on-recess first:border-l-0"
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
  children,
}: {
  column: Column<Row>;
  rowSpan: number;
  stickyTop: number;
  lockLeft: number;
  direction: false | "asc" | "desc";
  rank: number;
  sortCount: number;
  onSort: (additive: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <th
      data-column-key={column.key}
      title={column.title}
      rowSpan={rowSpan}
      style={{ top: stickyTop, left: column.lock ? lockLeft : undefined }}
      className={cn(
        "sticky z-sticky align-top whitespace-nowrap border-b border-l border-line px-(--item-pad-x) py-1 font-normal on-recess first:border-l-0",
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
          tone="quiet"
          size="caption"
          hover="bare"
        >
          <PressContent geometry="block">
            <span className="t-small t-upper">{column.header ?? column.label}</span>
            {direction && (
              <span className="ml-1 text-ink">
                {direction === "asc" ? "↑" : "↓"}
                {sortCount > 1 && <span className="opacity-60">{rank + 1}</span>}
              </span>
            )}
          </PressContent>
        </Press>
      ) : (
        <span className="t-small t-upper block">{column.header ?? column.label}</span>
      )}
      {children}
    </th>
  );
}

/** The column's way into the query box; pressed, it says what narrows the column right now. */
function ConditionPress<Row>({
  said,
  column,
  onClick,
}: {
  said: readonly string[];
  column: Column<Row>;
  onClick: () => void;
}) {
  return (
    <div className="mt-0.5 flex normal-case">
      <Press
        type="button"
        tone="quiet"
        size="caption"
        hover="bare"
        aria-pressed={said.length > 0}
        aria-label={`filter ${column.label}`}
        title={
          said.length
            ? `Narrowed by ${said.join(" and ")}. Click to add another condition on this column; edit or remove one from its chip in the query box.`
            : "Filter this column: opens the query box on it, with its operators and values."
        }
        onClick={onClick}
      >
        <PressContent geometry="block">
          <ListFilter aria-hidden className="size-3 shrink-0" />
          {said.length > 0 && <span className="face-mono truncate">{said.join(" · ")}</span>}
        </PressContent>
      </Press>
    </div>
  );
}
