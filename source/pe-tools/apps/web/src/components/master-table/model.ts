/** MasterTable's public product model. TanStack's types stay behind the component boundary. */
import type { ReactNode } from "react";

import type { StateCellProps } from "#/components/lang/cell";

/** A column. Capabilities are opt-in by the presence of a field, never by a flag. */
interface ColumnBase<Row> {
  /** Stable id — filter/sort state and React keys are keyed on it. */
  key: string;
  label: string;
  /** Rich visible header; `label` remains the stable plain-text name for chips and state. */
  header?: ReactNode;
  /** Nested header path. A string keeps the existing one-level grouping shorthand. */
  group?: string | readonly string[];
  /** Header tooltip — say what the column MEANS, not what it is called. */
  title?: string;
  /** Extra classes on this column's `<th>` — for a route-owned header vocabulary (a tint on
   * the column that is currently on stage) the table itself cannot know. */
  headerClassName?: string;
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
}

/** A column that draws its own body. The table knows nothing about what the cell says. */
export interface ValueColumn<Row> extends ColumnBase<Row> {
  cell: (row: Row) => ReactNode;
  state?: never;
}

/**
 * THE CELL-STATE CLAUSE. A column that declares WHAT IT DRAWS instead of returning an opaque
 * node: the table renders the language's `StateCell` itself (one box model, owned here), and —
 * because the renderer's identity is known — it can facet, count and order rows by cell state
 * without the consumer modelling that fact a second time. `facet` defaults to the grammar's
 * one-word reading (`cellStateLabel`); `sort` defaults to attention order (`CELL_STATE_ORDER`).
 * Either can still be supplied to override.
 */
export interface StateColumn<Row> extends ColumnBase<Row> {
  state: (row: Row) => StateCellProps;
  cell?: never;
}

/** Exactly one of `cell` and `state` — a column draws a body or declares one, never both. */
export type Column<Row> = ValueColumn<Row> | StateColumn<Row>;

export interface SortKey {
  key: string;
  dir: "asc" | "desc";
}

/** Column filters, keyed by column key. A key is absent when that column is unfiltered. */
export type Filters = Record<string, string>;

/** Route-ownable table state. Supplying it lets Pea read and drive the exact visible model. */
export interface MasterTableState {
  filters: Filters;
  sorts: SortKey[];
  query: string;
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
