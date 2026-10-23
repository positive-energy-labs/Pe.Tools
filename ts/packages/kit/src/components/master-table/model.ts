import type { Tone } from "../../lib/token";
/** Table's public product model. TanStack's types stay behind the component boundary. */
import type { ReactNode } from "react";

import type { StateCellProps } from "../lang/cell";

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
  /** Present ⇒ a query field (`label=value`); the box suggests its values ("" = no value). */
  facet?: (row: Row) => string;
  /** The field's `=` for multi-valued columns (a row with several flags matching "any"/"none"/one
   * flag). Defaults to `facet(row)` equality. */
  match?: (row: Row, value: string) => boolean;
  /** The field's whole vocabulary, suggested even where no row in scope holds a value. */
  options?: { value: string; label: string }[];
  /** Lock the column to the left edge while the table scrolls horizontally. Give locked
   * columns a `width`; lock only leading columns — a lock after a scrolling column overlaps. */
  lock?: boolean;
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

/** A row-level pipeline verdict — what the plan/receipts/pipeline says about the ROW. */
export interface Verdict {
  /** The route's own word — `applied`, `synced`, `needs a call`. Domain vocabulary is the
   * point: a pipeline verdict is not a value state and never lies in the grammar's eight. */
  word: string;
  tone?: Tone;
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

/** What the query box can name: fields (a `kind` filters, a `sort` key sorts), rule words, and
 * the rows a query keeps. `TableFrame` derives it from the columns unless a route supplies it. */
export interface QueryFilter {
  /** One canonical query clause. The query remains the only enabled-state authority. */
  clause: string;
  label: string;
  description: string;
  /** Included when the caller creates its initial query; never applied invisibly by the UI. */
  default?: boolean;
}

export interface QueryVocabulary {
  fields: readonly {
    label: string;
    kind?: "text" | "number";
    sort?: string;
    /** The field's values are declared (`options`): pickers skip the operator rung, `is` implied. */
    enumerated?: boolean;
    /** What the column means; shown beside the field in the pickers. */
    title?: string;
  }[];
  rules: readonly { word: string; label: string }[];
  /** Named domain conditions, including recommended starting filters. */
  filters?: readonly QueryFilter[];
  count: (query: string) => number;
  /** A field's distinct values with their counts over the rows `query` keeps (ruling 26). */
  values: (label: string, query: string) => { value: string; label?: string; count: number }[];
}

/** The query box's second vocabulary, after an arrow (`→` or `->`): a command the caller owns.
 * Before the arrow the box narrows the table as ever; after it, the box draws the caller's chips,
 * offers the caller's tokens for the word being typed (Tab completes, a space or a paste commits
 * each complete word through its token, Backspace on an empty box pulls the last chip back as
 * text) and Enter on an empty word runs the command. One state, two inputs: the caller derives
 * `chips` and `tokens` from its own state, so a click elsewhere changes the chips too. */
export interface QueryCommand {
  /** Whether the arrow has been typed, or a click armed the command. */
  armed: boolean;
  onArmed: (armed: boolean) => void;
  /** The command so far, as chips after the arrow; removing one is the caller's undo. */
  chips: readonly {
    key: string;
    label: string;
    detail?: string;
    title: string;
    onRemove: () => void;
  }[];
  /** The tokens the word typed so far may become ("" lists every token). */
  tokens: (
    typed: string,
  ) => readonly { key: string; label: string; hint?: string; take: () => void }[];
  /** Enter with nothing typed: run the command. */
  onCommit: () => void;
  /** What Enter runs, for the arrow chip's hover. */
  says: string;
  placeholder?: string;
}

/** Route-ownable table state. Supplying it lets Pea read and drive the exact visible model. */
export interface TableState {
  sorts: SortKey[];
  /** The query box's whole text: free words search, `Label>1` narrows a field, `!` negates. */
  query: string;
  /** Column visibility is view state, so column definitions remain stable. */
  hiddenColumns?: string[];
}

/** The numeric-cell semantics moved into the language with the editor (fit reviews 2026-08-16,
 * #2 — `StateCell.numeric` is the one commit path now). Re-exported so table consumers keep
 * their import site. */
export { fmtNum } from "../lang/cell";
