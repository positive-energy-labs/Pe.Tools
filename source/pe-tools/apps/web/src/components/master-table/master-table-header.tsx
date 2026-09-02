import { useMemo, type ReactNode } from "react";
import type { ReactTable, RowData } from "@tanstack/react-table";

import { Press } from "#/components/lang/press";
import type { ResolvedColumn } from "#/components/master-table/master-table-columns";
import { facetOptions, type Column, type MasterTableState } from "#/components/master-table/model";
import type { MasterTableFeatures } from "#/components/master-table/tanstack-adapter";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/lang/combobox";
import { cn } from "#/lib/utils";
import { PressContent } from "#/components/anatomy/press-content";

type Table<Row extends RowData> = ReactTable<MasterTableFeatures, Row, unknown>;

export function labelOf<Row>(column: Column<Row>, rows: readonly Row[], value: string): string {
  return facetOptions(rows, column).find((option) => option.value === value)?.label ?? value;
}

export function MasterTableHeader<Row extends RowData>({
  table,
  columnByKey,
  rows,
  filters,
  setFilter,
  stickyTop,
  sortCount,
  gutter,
  gutterWidth,
  theadRef,
}: {
  table: Table<Row>;
  columnByKey: ReadonlyMap<string, ResolvedColumn<Row>>;
  rows: readonly Row[];
  filters: MasterTableState["filters"];
  setFilter: (key: string, value: string | null) => void;
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
            <th
              rowSpan={headerGroups.length}
              style={{ top: 0, width: gutterWidth, minWidth: gutterWidth }}
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
                lockLeft={gutter ? gutterWidth : 0}
                direction={header.column.getIsSorted()}
                rank={header.column.getSortIndex()}
                sortCount={sortCount}
                onSort={(additive) => header.column.toggleSorting(undefined, additive)}
              >
                {(column.facet || column.options) && (
                  <ColFilter
                    label={column.label}
                    value={filters[column.key] ?? null}
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
                className="t-small t-upper sticky z-sticky whitespace-nowrap border-b border-l border-line bg-recess px-(--item-pad-x) py-px text-left on-recess first:border-l-0"
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
      title={column.title}
      rowSpan={rowSpan}
      style={{ top: stickyTop, left: column.lock ? lockLeft : undefined }}
      className={cn(
        "sticky z-sticky align-top whitespace-nowrap border-b border-l border-line bg-recess px-(--item-pad-x) py-1 font-normal on-recess first:border-l-0",
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

interface FacetChoice {
  value: string | null;
  label: string;
}

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
      <div ref={anchorRef} className="mt-0.5 flex">
        <ComboboxTrigger
          fill
          aria-label={`${label} filter`}
          title="Narrow the table to one value of this column. The choices are every value present across ALL rows, so they stay put as other filters move."
        >
          <span className="truncate normal-case">{value === null ? all : selected.label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef}>
        {options.length > 7 && <ComboboxInput placeholder="filter values…" />}
        <ComboboxEmpty>No matching values</ComboboxEmpty>
        <ComboboxList>
          {(choice: FacetChoice) => (
            <ComboboxItem key={choice.value ?? "\u0000all"} value={choice}>
              <span className={cn("face-mono truncate", choice.value === null && "text-ink-2")}>
                {choice.label}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
