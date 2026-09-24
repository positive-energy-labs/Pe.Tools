/** Table's public product model. TanStack's types stay behind the component boundary. */
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
  /** The displayed scalar the query's `Label>1` clauses read. Units belong in text fields. */
  condition?: { kind: "text" | "number"; read: (row: Row) => string | number | null };
}

/** A column that draws its own body. The table knows nothing about what the cell says. */
export interface ValueColumn<Row> extends ColumnBase<Row> {
  cell: (row: Row) => ReactNode;
  state?: never;
  verdict?: never;
}

/** The meaning-band tones a verdict may wear. NARROW BY CONSTRUCTION (takeoffs #11(b), ruled
 * 2026-08-16 R5): a consumer physically cannot hand this a viz/taxonomy colour, which is the
 * defect that let one cell draw its dot in alarm and its word in kiln. */
export type VerdictTone = "alarm" | "caution" | "done" | "ink" | "mute";
/* `done` ALSO covers healthy/connected/running, as a deliberate stretch. /instances ruled it
 * 2026-08-16: the meaning band has no running role, `ink` under-states "the bridge connection
 * landed" against `booting`, and minting a sixth hue for liveness is not worth it. The next
 * fleet-ish surface reads this line instead of inventing a different answer — DO NOT mint a hue. */

/** A row-level pipeline verdict — what the plan/receipts/pipeline says about the ROW. */
export interface Verdict {
  /** The route's own word — `applied`, `synced`, `needs a call`. Domain vocabulary is the
   * point: a pipeline verdict is not a value state and never lies in the grammar's eight. */
  word: string;
  tone: VerdictTone;
  /** The cell title — say what the verdict MEANS, not what it is called. */
  note: string;
  dim?: boolean;
}

/**
 * THE CELL-STATE CLAUSE. A column that declares WHAT IT DRAWS instead of returning an opaque
 * node: the table renders the language's `StateCell` itself (one box model, owned here), and —
 * because the renderer's identity is known — it can facet, count and order rows by cell state
 * without the consumer modelling that fact a second time. `facet` defaults to the grammar's
 * one-word reading (`cellStateLabel`); `sort` defaults to attention order (`CELL_STATE_ORDER`).
 * Either can still be supplied to override.
 */
interface StateColumn<Row> extends ColumnBase<Row> {
  state: (row: Row) => StateCellProps;
  /**
   * Domain vocabulary override (ruled 2026-08-16, takeoffs finding #1): the word the filter,
   * facet and readout speak for this row, when the grammar's eight universal words (the
   * `CELL_STATE_ORDER` vocabulary, `never` included) would lie — "clean" where the domain means
   * "no Manual J entered". The MARKS stay universal; only the
   * word is the route's. Omit it unless the universal word is actually wrong: every override
   * is one more vocabulary for the user to learn. (Row-level PIPELINE verdicts do not belong
   * here at all — they ride the `verdict:` clause below.)
   */
  word?: (row: Row) => string;
  cell?: never;
  verdict?: never;
}

/**
 * THE VERDICT CLAUSE (ruled 2026-08-16, consolidation batch R5 — families #1's evidence).
 * A row-level PIPELINE VERDICT is a second legitimate form, distinct from a value's
 * pseudo-dimension: at seven words with one axis mapping, riding `state:` + `word` would draw
 * marks that say nothing under a word that says everything, and a reader who has learned the
 * marks would read six different states as "clean". The table renders the dot + word itself;
 * facet and sort default to the word. This clause replaces and deletes `stateColumn`, the
 * last parallel cell-state renderer.
 */
interface VerdictColumn<Row> extends ColumnBase<Row> {
  verdict: (row: Row) => Verdict;
  state?: never;
  word?: never;
  cell?: never;
}

/** Exactly one of `cell`, `state` and `verdict` — a column draws a body or declares one. */
export type Column<Row> = ValueColumn<Row> | StateColumn<Row> | VerdictColumn<Row>;

interface SortKey {
  key: string;
  dir: "asc" | "desc";
}

/** Column filters, keyed by column key. A key is absent when that column is unfiltered. */
type Filters = Record<string, string>;

/** What the query box can name: fields (a `kind` filters, a `sort` key sorts), rule words, and
 * the rows a query keeps. `TableFrame` derives it from the columns unless a route supplies it. */
export interface QueryVocabulary {
  fields: readonly { label: string; kind?: "text" | "number"; sort?: string }[];
  rules: readonly { word: string; label: string }[];
  count: (query: string) => number;
  /** A field's distinct values with their counts over the rows `query` keeps (ruling 26). */
  values: (label: string, query: string) => { value: string; count: number }[];
}

/** Route-ownable table state. Supplying it lets Pea read and drive the exact visible model. */
export interface TableState {
  filters: Filters;
  sorts: SortKey[];
  /** The query box's whole text: free words search, `Label>1` narrows a field, `!` negates. */
  query: string;
  /** Column visibility is view state, so column definitions remain stable. */
  hiddenColumns?: string[];
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

/** The numeric-cell semantics moved into the language with the editor (fit reviews 2026-08-16,
 * #2 — `StateCell.numeric` is the one commit path now). Re-exported so table consumers keep
 * their import site. */
export { fmtNum } from "#/components/lang/cell";
