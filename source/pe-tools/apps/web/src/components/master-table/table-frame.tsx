/**
 * TABLE FRAME — a table's chrome, as a wrapper (the approved reshape): the box, the scope strip
 * (label, summary, search, modes, select-all, actions) and the filter-chip strip. It holds no
 * table state of its own: it reads the route's `state` and the same `visibleRows(...)` the grid
 * draws, so its counts are the grid's rows. A table that wants no chrome is a bare `Table`.
 */
import type { ReactNode } from "react";
import type { RowData } from "@tanstack/react-table";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { NarrowChip } from "#/components/lang/chip";
import { Input } from "#/components/lang/input";
import { Press } from "#/components/lang/press";
import { labelOf } from "#/components/master-table/master-table-header";
import type { Column, TableState } from "#/components/master-table/model";
import { selectableKeys, type TableSelection } from "#/components/master-table/table";
import { visibleRows } from "#/components/master-table/view";

export interface TableFrameProps<Row extends RowData> {
  /** What is in scope, said as the strip's lead. */
  label: string;
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  state: TableState;
  onStateChange: (state: TableState) => void;
  summary?: ReactNode;
  /** Present, the strip draws a free-text search over the searchable columns. */
  searchPlaceholder?: string;
  /** Route-owned filters narrowing the rows before the table sees them: one chip each. Present
   * (even empty), the chip row reserves its line, so a chip appearing never moves the grid. */
  chips?: { label: string; onClear: () => void }[];
  filters?: ReactNode;
  modes?: ReactNode;
  actions?: ReactNode;
  /** Present, the strip offers select-all over the shown rows. */
  selection?: TableSelection;
  children: ReactNode;
}

export function TableFrame<Row extends RowData>({
  label,
  rows,
  columns,
  rowKey,
  state,
  onStateChange,
  summary,
  searchPlaceholder,
  chips,
  filters,
  modes,
  actions,
  selection,
  children,
}: TableFrameProps<Row>) {
  const shown = visibleRows(rows, columns, state).map(rowKey);
  const reach = selection ? selectableKeys(selection, shown) : [];
  const selectedShown = reach.filter((key) => selection!.selected.has(key)).length;
  const filtered = columns.filter((column) => state.filters[column.key]);
  const setFilter = (key: string, value: string | null) => {
    const next = { ...state.filters };
    if (value === null) delete next[key];
    else next[key] = value;
    onStateChange({ ...state, filters: next });
  };
  const narrowed =
    filters != null || chips !== undefined || Boolean(state.query) || filtered.length > 0;
  return (
    <ArtifactFrame
      className="flex min-h-0 flex-1 flex-col"
      head={
        <>
          <span
            className="t-small t-upper"
            title="Everything currently in scope. This table is never hidden and never narrowed silently — every filter acting on it is a chip in this strip."
          >
            {label}
          </span>
          {summary && <span className="face-mono t-small text-ink-2">{summary}</span>}
        </>
      }
      headTrail={
        <>
          {searchPlaceholder && (
            <div className="w-44">
              <Input
                face="mono"
                value={state.query}
                onChange={(event) => onStateChange({ ...state, query: event.target.value })}
                placeholder={searchPlaceholder}
                title="Free-text filter. It reads only the columns that declare themselves searchable, so a match here always points at a visible column."
              />
            </div>
          )}
          {modes}
          {selection && reach.length > 0 && (
            <Press
              type="button"
              tone="quiet"
              size="label"
              onClick={() => {
                const next = new Set(selection.selected);
                if (selectedShown === reach.length) for (const key of reach) next.delete(key);
                else for (const key of reach) next.add(key);
                selection.onChange(next);
              }}
            >
              {selectedShown === reach.length ? `clear ${reach.length}` : `select ${reach.length}`}
            </Press>
          )}
          {actions}
        </>
      }
    >
      {narrowed && (
        <div
          data-slot="table-filters"
          className="flex min-h-(--item-h) shrink-0 flex-wrap items-center gap-2 px-2 py-1 hairline-b"
        >
          {filters}
          {chips?.map((chip) => (
            <NarrowChip
              key={chip.label}
              label={chip.label}
              count={shown.length}
              onRemove={chip.onClear}
              title="A route-owned filter narrowing this table right now. The count is rows still in scope; removing it widens back out."
            />
          ))}
          {state.query && (
            <NarrowChip
              label={`search: ${state.query}`}
              count={shown.length}
              onRemove={() => onStateChange({ ...state, query: "" })}
              title="The free-text filter narrowing this table right now. The count is rows still in scope; removing it widens back out."
            />
          )}
          {filtered.map((column) => (
            <NarrowChip
              key={column.key}
              label={`${column.label}: ${labelOf(column, rows, state.filters[column.key] ?? "")}`}
              count={shown.length}
              onRemove={() => setFilter(column.key, null)}
              title="A column filter narrowing this table right now. The count is rows still in scope; removing it widens back out."
            />
          ))}
          {filtered.length > 0 && (
            <Press
              type="button"
              onClick={() => onStateChange({ ...state, filters: {} })}
              title="Drop every column filter at once. Filters owned by the route have their own chips and are left alone."
              tone="quiet"
              size="label"
            >
              clear column filters
            </Press>
          )}
        </div>
      )}
      {children}
    </ArtifactFrame>
  );
}
