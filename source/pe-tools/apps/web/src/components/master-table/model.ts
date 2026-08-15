/** MasterTable's pure core: the column model plus the filter/sort algebra the table renders.
 *
 * Kept free of React so the law below is testable without a DOM.
 */
import type { ReactNode } from "react";

/** A column. Capabilities are opt-in by the presence of a field, never by a flag. */
export interface Column<Row> {
  /** Stable id — filter/sort state and React keys are keyed on it. */
  key: string;
  label: string;
  /** Clustered group header. Contiguous columns sharing a group get one spanning header cell. */
  group?: string;
  /** Header tooltip — say what the column MEANS, not what it is called. */
  title?: string;
  right?: boolean;
  /** Width utility class, e.g. "w-16". */
  width?: string;
  /** Present ⇒ sortable. Returns the ordering value for a row. */
  sort?: (row: Row) => string | number;
  /** Present ⇒ filterable. Returns the row's value for this column's select ("" = no value). */
  facet?: (row: Row) => string;
  /** Custom filter predicate for multi-valued columns (a row with several flags matching
   * "any open"/"none"/one flag). Defaults to `facet(row) === value` equality. */
  match?: (row: Row, value: string) => boolean;
  /** Filter options; derived from the rows' facet values when omitted. */
  options?: { value: string; label: string }[];
  /** Lock the column to the left edge while the table scrolls horizontally. Give locked
   * columns a `width`; lock only leading columns — a lock after a scrolling column overlaps. */
  lock?: boolean;
  /** Label for the filter's "no filter" option. */
  all?: string;
  /** Free-text search reads this; omitted columns are not searched. */
  search?: (row: Row) => string;
  cell: (row: Row) => ReactNode;
}

export interface SortKey {
  key: string;
  dir: "asc" | "desc";
}

/** Column filters, keyed by column key. A key is absent when that column is unfiltered. */
export type Filters = Record<string, string>;

/**
 * Shift-click multi-sort. Plain click replaces the sort; additive appends, and the second
 * click on an already-sorted column flips it rather than adding a duplicate key.
 */
export function toggleSort(sorts: SortKey[], key: string, additive: boolean): SortKey[] {
  const existing = sorts.find((s) => s.key === key);
  const flipped: SortKey = { key, dir: existing?.dir === "asc" ? "desc" : "asc" };
  if (!additive) return [flipped];
  if (!existing) return [...sorts, flipped];
  return sorts.map((s) => (s.key === key ? flipped : s));
}

/**
 * Every distinct facet value present in the rows, sorted — the honest vocabulary of the column.
 *
 * INTENTIONAL: `rows` here is ALL rows, never the currently-visible subset. A column's select
 * therefore keeps a STABLE vocabulary as other filters narrow the table — options never vanish
 * or reshuffle under the cursor, and picking one can always widen the scope back out. The price
 * is that a chosen option may resolve to zero visible rows; the empty state says so, which is a
 * better answer than an option that quietly disappeared.
 */
export function facetOptions<Row>(
  rows: readonly Row[],
  col: Column<Row>,
): { value: string; label: string }[] {
  if (col.options) return col.options;
  if (!col.facet) return [];
  const set = new Set<string>();
  for (const row of rows) {
    const v = col.facet(row);
    if (v !== "") set.add(v);
  }
  return [...set].sort().map((v) => ({ value: v, label: v }));
}

export function applyFilters<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  filters: Filters,
  query = "",
): Row[] {
  const active = columns.filter((c) => (c.facet || c.match) && filters[c.key]);
  const q = query.trim().toLowerCase();
  const searchable = columns.filter((c) => c.search);
  return rows.filter((row) => {
    for (const col of active) {
      const value = filters[col.key] ?? "";
      if (col.match ? !col.match(row, value) : col.facet?.(row) !== value) return false;
    }
    if (q && searchable.length > 0) {
      if (!searchable.some((c) => c.search?.(row).toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

export function applySort<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  sorts: readonly SortKey[],
): Row[] {
  if (sorts.length === 0) return [...rows];
  const keyed = sorts
    .map((s) => ({ sort: columns.find((c) => c.key === s.key)?.sort, dir: s.dir }))
    .filter((s): s is { sort: (row: Row) => string | number; dir: "asc" | "desc" } => !!s.sort);
  return [...rows].sort((a, b) => {
    for (const { sort, dir } of keyed) {
      const av = sort(a);
      const bv = sort(b);
      if (av === bv) continue;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av) < String(bv)
            ? -1
            : 1;
      return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

/**
 * Contiguous runs of columns sharing a `group` — the clustered header row.
 *
 * The column order is the CALLER's to get right: a group interrupted and then resumed renders as
 * two separate spanning headers with the same label, which reads as a bug in the data rather than
 * a bug in the ordering. In dev that mis-ordering is named on the console (warn, never throw —
 * a cosmetic header must not take the table down).
 */
export function clusters<Row>(
  columns: readonly Column<Row>[],
): { group: string | undefined; span: number }[] {
  const out: { group: string | undefined; span: number }[] = [];
  const opened = new Set<string>();
  for (const col of columns) {
    const last = out.at(-1);
    if (last && last.group === col.group && col.group !== undefined) last.span += 1;
    else {
      if (col.group !== undefined) {
        if (import.meta.env.DEV && opened.has(col.group)) {
          console.warn(
            `MasterTable: column group "${col.group}" is not contiguous — column "${col.key}" resumes it after another group. Sort the columns by group before passing them in; the header will otherwise show "${col.group}" twice.`,
          );
        }
        opened.add(col.group);
      }
      out.push({ group: col.group, span: 1 });
    }
  }
  return out;
}

/** Round for display without float noise: 22.200000762 -> "22.2", 599.99994 -> "600". */
export function fmtNum(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}

/** Parse an edited number cell. Returns null when the text is not a number (commit is refused). */
export function parseCell(
  text: string,
  opts: { integer?: boolean; min?: number } = {},
): number | null {
  if (text.trim() === "") return null; // blank is not zero — an emptied cell commits nothing
  const parsed = opts.integer ? Number.parseInt(text, 10) : Number(text);
  if (Number.isNaN(parsed)) return null;
  return opts.min !== undefined && parsed < opts.min ? opts.min : parsed;
}
