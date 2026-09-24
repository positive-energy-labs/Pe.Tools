/**
 * TABLE FRAME — a table's chrome, as a wrapper (the approved reshape): the box, the scope strip
 * (label, summary, modes, select-all, actions) and the one query box, where every narrowing is a
 * chip. It holds no table state of its own: it reads the route's `state` and the same
 * `visibleRows(...)` the grid draws, so its counts are the grid's rows. A table that wants no
 * chrome is a bare `Table`.
 */
import { useState, type ReactNode } from "react";
import type { RowData } from "@tanstack/react-table";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { NarrowChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { resolveStateColumn } from "#/components/master-table/master-table-columns";
import type { Column, QueryVocabulary, TableState } from "#/components/master-table/model";
import { ConditionTarget, QueryBox } from "#/components/master-table/query";
import { selectableKeys, type TableSelection } from "#/components/master-table/table";
import { conditionValues, quoted, visibleRows } from "#/components/master-table/view";

export interface TableFrameProps<Row extends RowData> {
  /** What is in scope, said as the strip's lead. */
  label: string;
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  state: TableState;
  onStateChange: (state: TableState) => void;
  summary?: ReactNode;
  /** Present, the frame draws the query box even where no column declares a `condition`. */
  searchPlaceholder?: string;
  /** A route's own vocabulary, for rows it narrows before the frame sees them (families); absent,
   * the box names the columns that declare a `condition`. */
  query?: QueryVocabulary;
  /** Route-owned filters narrowing the rows before the table sees them: one chip each. Present
   * (even empty), the box reserves its line, so a chip appearing never moves the grid. */
  chips?: { label: string; onClear: () => void }[];
  modes?: ReactNode;
  actions?: ReactNode;
  /** Present, the strip offers select-all over the shown rows. */
  selection?: TableSelection;
  children: ReactNode;
}

function columnVocabulary<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  state: TableState,
): QueryVocabulary {
  const scope = (query: string) => visibleRows(rows, columns, { ...state, query });
  const resolved = columns.map(resolveStateColumn);
  return {
    fields: resolved.map((column) => ({
      label: column.label,
      kind: column.condition?.kind,
      sort: column.sort ? column.key : undefined,
    })),
    rules: [],
    count: (query) => scope(query).length,
    values: (label, query) => {
      const condition = resolved.find((column) => column.label === label)?.condition;
      return condition ? conditionValues(scope(query), condition) : [];
    },
  };
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
  query,
  chips,
  modes,
  actions,
  selection,
  children,
}: TableFrameProps<Row>) {
  const visibleColumns = columns.filter((column) => !state.hiddenColumns?.includes(column.key));
  const conditioned = visibleColumns.some((column) => resolveStateColumn(column).condition);
  const [draft, setDraft] = useState("");
  const [box, setBox] = useState<HTMLInputElement | null>(null);
  // A route vocabulary narrowed the rows already; the frame only orders them.
  const shown = visibleRows(rows, visibleColumns, query ? { ...state, query: "" } : state).map(
    rowKey,
  );
  const reach = selection ? selectableKeys(selection, shown) : [];
  const selectedShown = reach.filter((key) => selection!.selected.has(key)).length;
  const boxed =
    searchPlaceholder !== undefined ||
    query !== undefined ||
    chips !== undefined ||
    conditioned ||
    Boolean(state.query);
  return (
    <ArtifactFrame
      className="flex min-h-0 flex-1 flex-col"
      head={
        <>
          <span
            className="t-small t-upper"
            title="Everything currently in scope. This table is never hidden and never narrowed silently — every filter acting on it is a chip in its query box."
          >
            {label}
          </span>
          {summary && <span className="face-mono t-small text-ink-2">{summary}</span>}
          {!query && boxed && (
            <span className="face-mono t-small text-ink-2">
              {shown.length === rows.length
                ? `${rows.length} rows`
                : `${shown.length} of ${rows.length} rows`}
            </span>
          )}
        </>
      }
      headTrail={
        <>
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
      {boxed && (
        <div data-slot="table-filters" className="flex shrink-0 items-center px-2 hairline-b">
          <QueryBox
            vocabulary={query ?? columnVocabulary(rows, visibleColumns, state)}
            state={state}
            onStateChange={onStateChange}
            draft={draft}
            onDraft={setDraft}
            onInput={setBox}
            placeholder={searchPlaceholder}
          >
            {chips?.map((chip) => (
              <NarrowChip
                key={chip.label}
                label={chip.label}
                onRemove={chip.onClear}
                title="A route-owned filter narrowing this table right now; removing it widens back out."
              />
            ))}
          </QueryBox>
        </div>
      )}
      <ConditionTarget.Provider
        value={
          conditioned
            ? (field) => {
                setDraft(quoted(field));
                box?.focus();
              }
            : null
        }
      >
        {children}
      </ConditionTarget.Provider>
    </ArtifactFrame>
  );
}
