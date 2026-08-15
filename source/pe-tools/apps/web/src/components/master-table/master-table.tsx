/** MasterTable — the dense, editable, always-scoped grid.
 *
 * THE LAW: the table always answers "everything currently in scope". It is never hidden, never
 * collapses into a per-row detail pane, and every filter narrowing it is visible as a removable
 * chip in its own header — so what you see is always the complete truth about the current scope.
 *
 * shim: duplicated from takeoff-fresh atlas; when takeoff merges, both routes consume this one
 * component.
 */
import { useMemo, useState, type ReactNode } from "react";

import {
  applyFilters,
  applySort,
  clusters,
  facetOptions,
  toggleSort,
  type Column,
  type Filters,
  type SortKey,
} from "#/components/master-table/model";
import { cn } from "#/lib/utils";

export interface MasterTableProps<Row> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  /** Left-hand label for the header strip, e.g. "families in scope". */
  scopeLabel: string;
  /** Free-text box; omit when no column declares `search`. */
  searchPlaceholder?: string;
  /** Chips for filters the ROUTE owns (plan scope, rail stage…). Rendered beside the column chips. */
  chips?: { label: string; onClear: () => void }[];
  /** Trailing summary text for the header strip (counts, totals). */
  summary?: ReactNode;
  /** Shown when the scope is empty — say what would widen it. */
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  /** Highlighted row, if the route tracks a cursor. */
  activeKey?: string | null;
}

export function MasterTable<Row>({
  rows,
  columns,
  rowKey,
  scopeLabel,
  searchPlaceholder,
  chips = [],
  summary,
  empty,
  onRowClick,
  activeKey,
}: MasterTableProps<Row>) {
  const [filters, setFilters] = useState<Filters>({});
  const [sorts, setSorts] = useState<SortKey[]>([]);
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => applySort(applyFilters(rows, columns, filters, query), columns, sorts),
    [rows, columns, filters, query, sorts],
  );

  const activeFilters = columns.filter((c) => filters[c.key]);
  const grouped = columns.some((c) => c.group);

  const setFilter = (key: string, value: string | null) =>
    setFilters((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        <span className="tele-label text-muted-foreground">{scopeLabel}</span>
        {searchPlaceholder && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="tele h-6 w-44 rounded-[var(--radius)] border border-border bg-transparent px-1.5 outline-none focus:border-ring"
          />
        )}
        {summary && <span className="tele text-muted-foreground">{summary}</span>}

        {chips.map((chip) => (
          <FilterChip key={chip.label} label={chip.label} onClear={chip.onClear} />
        ))}
        {query && <FilterChip label={`search: ${query}`} onClear={() => setQuery("")} />}
        {activeFilters.map((col) => (
          <FilterChip
            key={col.key}
            label={`${col.label}: ${labelOf(col, rows, filters[col.key] ?? "")}`}
            onClear={() => setFilter(col.key, null)}
          />
        ))}
        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="tele rounded-[var(--radius)] px-1 text-muted-foreground hover:bg-muted"
          >
            clear column filters
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            {grouped && (
              <tr>
                {clusters(columns).map((c, i) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: clusters are positional by definition
                    key={`${c.group ?? ""}-${i}`}
                    colSpan={c.span}
                    className="tele-label sticky top-0 z-10 whitespace-nowrap border-b border-l border-border bg-muted px-1.5 py-px text-left font-normal text-muted-foreground first:border-l-0"
                  >
                    {c.group ?? ""}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {columns.map((col) => (
                <Th
                  key={col.key}
                  col={col}
                  sorts={sorts}
                  stickyTop={grouped}
                  onSort={(additive) => setSorts((prev) => toggleSort(prev, col.key, additive))}
                >
                  {col.facet && (
                    <ColFilter
                      value={filters[col.key] ?? null}
                      onChange={(v) => setFilter(col.key, v)}
                      all={col.all ?? "any"}
                      options={facetOptions(rows, col)}
                    />
                  )}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={cn(
                    "h-7 scroll-mt-12 hover:bg-muted/60",
                    activeKey === key && "bg-primary/[0.06]",
                  )}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button,input,select,textarea,a,[role=button]")) return;
                    onRowClick?.(row);
                  }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "border-b border-l border-[var(--line-soft)] p-0 first:border-l-0",
                        col.right && "text-right",
                        col.width,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="p-6 text-center text-xs text-muted-foreground">
            {empty ?? "Nothing in scope. Widen the filters."}
          </p>
        )}
      </div>
    </div>
  );
}

function labelOf<Row>(col: Column<Row>, rows: readonly Row[], value: string): string {
  return facetOptions(rows, col).find((o) => o.value === value)?.label ?? value;
}

function Th<Row>({
  col,
  sorts,
  stickyTop,
  onSort,
  children,
}: {
  col: Column<Row>;
  sorts: SortKey[];
  stickyTop: boolean;
  onSort: (additive: boolean) => void;
  children?: ReactNode;
}) {
  const rank = sorts.findIndex((s) => s.key === col.key);
  const dir = rank === -1 ? null : sorts[rank]?.dir;
  return (
    <th
      title={col.title}
      className={cn(
        "sticky z-10 align-top whitespace-nowrap border-b border-l border-border bg-muted px-1.5 py-1 font-normal first:border-l-0",
        stickyTop ? "top-5" : "top-0",
        col.right ? "text-right" : "text-left",
        col.width,
      )}
    >
      {col.sort ? (
        <button
          type="button"
          onClick={(e) => onSort(e.shiftKey)}
          title="click to sort · shift-click to add to the sort"
          className="tele-label block w-full text-left text-muted-foreground hover:text-foreground"
        >
          {col.label}
          {dir && (
            <span className="ml-1 text-foreground">
              {dir === "asc" ? "↑" : "↓"}
              {sorts.length > 1 && <span className="opacity-60">{rank + 1}</span>}
            </span>
          )}
        </button>
      ) : (
        <span className="tele-label block text-muted-foreground">{col.label}</span>
      )}
      {children}
    </th>
  );
}

/** A column filter, in the table's own idiom: a hairline native select, tinted when active. */
function ColFilter({
  value,
  onChange,
  options,
  all,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: { value: string; label: string }[];
  all: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className={cn(
        "tele mt-0.5 h-5 w-full min-w-0 max-w-32 rounded-[1px] border bg-transparent px-0.5 outline-none",
        value
          ? "border-primary/40 bg-primary/[0.06] text-foreground"
          : "border-[var(--line-soft)] text-muted-foreground",
      )}
    >
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      title="remove this filter"
      className="tele inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--line-2)] bg-muted px-1.5 py-px hover:border-destructive/40 hover:text-destructive"
    >
      <span className="normal-case">{label}</span>
      <span className="opacity-60">×</span>
    </button>
  );
}
