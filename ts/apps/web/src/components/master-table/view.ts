/**
 * THE VIEW — which rows a table shows, in which order, as one pure function (the approved table
 * reshape). `Table` renders exactly `visibleRows(...)`, and every wrapper (the frame's counts and
 * select-all, an export, a summary) reads the same function, so no two readers can disagree.
 *
 * Semantics: every field clause of the query holds on its column's `condition` (a `facet` column's
 * is derived, `resolveStateColumn`), every free word hits a searchable column (`wordMatches`), and
 * a leading `!` negates either; sorts apply in order, each on its column's `sort`, and ties keep
 * the input order.
 */
import { useState } from "react";

import { resolveStateColumn } from "#/components/master-table/master-table-columns";
import type { Column, TableState } from "#/components/master-table/model";

export const emptyTableState = (): TableState => ({ sorts: [], query: "" });

const WHOLE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function parseConditionNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = value?.trim();
  if (!text || !WHOLE_NUMBER.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** A query operator: `~` contains, `=` is, `!=` is not, then the number comparisons. With no
 * value, `=` reads "is empty" and `!=` "is not empty". */
export type QueryOp = "~" | "=" | "!=" | ">" | ">=" | "<" | "<=";

/** One word of the query, read without a schema; a leading `!` negates any of them. */
export type QueryClause = { text: string; not: boolean } & (
  | { kind: "word"; word: string }
  | { kind: "field"; label: string; op: QueryOp; value: string }
  | { kind: "broken" }
);

const CLAUSE = /^(!?)(?:"([^"]*)"|([^\s"~=<>!]+))(~|!=|>=|<=|=|>|<)(?:"([^"]*)"?|(\S*))$/;

/** The query's words: whitespace splits them, except inside quotes ("Room Name"=Office). */
export const queryWords = (text: string) => text.match(/(?:"[^"]*"?|[^\s"])+/g) ?? [];

/** A label or value as the query writes it: quoted when it holds a space or an operator. */
export const quoted = (text: string) => (!text || /[\s"~=<>!]/.test(text) ? `"${text}"` : text);

export function readClause(text: string): QueryClause {
  const field = CLAUSE.exec(text);
  if (field) {
    const [, not, label, bare, op, value, rest] = field;
    return {
      text,
      not: not === "!",
      kind: "field",
      label: label ?? bare!,
      op: op as QueryOp,
      value: value ?? rest ?? "",
    };
  }
  const not = text.length > 1 && text.startsWith("!");
  const bare = not ? text.slice(1) : text;
  const word = /^"([^"]*)"?$/.exec(bare)?.[1] ?? bare;
  return word && /^[^"~=<>!]+$/.test(word)
    ? { text, not, kind: "word", word }
    : { text, not, kind: "broken" };
}

export const readQuery = (text: string) => queryWords(text).map(readClause);

/** Each kind's operators in the order the box offers them: `[op, empty, said]`. */
export const QUERY_OPS: Record<"text" | "number", [QueryOp, boolean, string][]> = {
  text: [
    ["~", false, "contains"],
    ["=", false, "is"],
    ["!=", false, "is not"],
    ["=", true, "is empty"],
    ["!=", true, "is not empty"],
  ],
  number: [
    ["=", false, "="],
    ["!=", false, "≠"],
    [">", false, ">"],
    [">=", false, "≥"],
    ["<", false, "<"],
    ["<=", false, "≤"],
    ["=", true, "is empty"],
  ],
};

/** What a field clause says after its label: "> 1", "contains millwork", "is empty". */
export function opSaid(kind: "text" | "number", op: QueryOp, value: string) {
  if (!value) return op === "!=" ? "is not empty" : op === "=" ? "is empty" : op;
  const said = QUERY_OPS[kind].find(([each, empty]) => each === op && !empty)?.[2] ?? op;
  return `${said} ${value}`;
}

/** A field clause against one cell: text compares trimmed and case-folded, numbers as numbers. */
function fieldMatches(
  raw: string | number | null,
  kind: "text" | "number",
  op: QueryOp,
  value: string,
): boolean {
  const actual = String(raw ?? "")
    .trim()
    .toLocaleLowerCase();
  const wanted = value.trim().toLocaleLowerCase();
  if (!wanted) return op === "=" ? !actual : op === "!=" && Boolean(actual);
  if (op === "~") return actual.includes(wanted);
  if (kind === "text" && (op === "=" || op === "!=")) return (actual === wanted) === (op === "=");
  const a = parseConditionNumber(raw);
  const b = parseConditionNumber(value);
  if (a == null || b == null) return false;
  return { "=": a === b, "!=": a !== b, ">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b }[op];
}

/** What a field clause reads of a row. */
export type QueryRead<Row> = {
  kind: "text" | "number";
  read: (row: Row) => string | number | null;
  /** A multi-valued field's `=` (a facet column's `match`); `!=` negates it. */
  match?: (row: Row, value: string) => boolean;
  /** The whole vocabulary, suggested even at zero rows in scope (a facet column's `options`). */
  values?: readonly string[];
};

/** Whether `row` passes every clause: a field clause on `fields` (keyed by lower-case label), a
 * word through `word`. A clause this schema cannot read (`undefined`) narrows nothing. */
export function passes<Row>(
  row: Row,
  clauses: readonly QueryClause[],
  fields: ReadonlyMap<string, QueryRead<Row>>,
  word: (row: Row, word: string) => boolean | undefined,
): boolean {
  return clauses.every((clause) => {
    let hit: boolean | undefined;
    if (clause.kind === "word") hit = word(row, clause.word.toLowerCase());
    else if (clause.kind === "field") {
      const field = fields.get(clause.label.toLowerCase());
      hit =
        field?.match && clause.value && (clause.op === "=" || clause.op === "!=")
          ? field.match(row, clause.value) === (clause.op === "=")
          : field && fieldMatches(field.read(row), field.kind, clause.op, clause.value);
    }
    return hit === undefined || hit !== clause.not;
  });
}

/** A field's distinct values with their counts over `rows`, keyed the way `=` matches
 * (trimmed, case-folded) and offered in the spelling first seen. */
export function conditionValues<Row>(rows: readonly Row[], field: QueryRead<Row>) {
  const { match, values } = field;
  if (values)
    return values.map((value) => ({
      value,
      count: rows.filter((row) =>
        match ? match(row, value) : fieldMatches(field.read(row), field.kind, "=", value),
      ).length,
    }));
  const counts = new Map<string, { value: string; count: number }>();
  for (const row of rows) {
    const value = String(field.read(row) ?? "").trim();
    const seen = counts.get(value.toLocaleLowerCase());
    if (seen) seen.count++;
    else if (value) counts.set(value.toLocaleLowerCase(), { value, count: 1 });
  }
  const number = field.kind === "number";
  return [...counts.values()].sort((a, b) =>
    number
      ? (parseConditionNumber(a.value) ?? 0) - (parseConditionNumber(b.value) ?? 0)
      : a.value.localeCompare(b.value),
  );
}

/** A cell number: signed unless the minus follows a word character ("A-104" holds 104), and
 * "1,200" is one number only when every comma group is exactly three digits. */
const CELL_NUMBER = /(?:(?<!\w)-)?(?:(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?|\.\d+)/g;

/**
 * A free word that is a number matches a cell holding that number, never a digit run inside a
 * longer one: "4" finds "4", "4.0", "4 ea" and "Level 4", not "14", "0.4", "-4" or "A-104";
 * "1200" finds "1,200" and "200" does not.
 */
export function wordMatches(text: string, word: string): boolean {
  const number = parseConditionNumber(word);
  if (number == null) return text.toLowerCase().includes(word);
  return (text.match(CELL_NUMBER) ?? []).some(
    (each) => Number(each.replaceAll(",", "")) === number,
  );
}

/** Uncontrolled table state a route can still read: the frame's search and the grid share it. */
export function useTableState(initial?: Partial<TableState>) {
  return useState<TableState>(() => ({ ...emptyTableState(), ...initial }));
}

function compare(a: string | number | undefined, b: string | number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

export function visibleRows<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  state: TableState,
): Row[] {
  const resolved = columns
    .filter((column) => !state.hiddenColumns?.includes(column.key))
    .map(resolveStateColumn);
  const byKey = new Map(resolved.map((column) => [column.key, column]));
  const fields = new Map(
    columns
      .map(resolveStateColumn)
      .flatMap((column) =>
        column.condition ? [[column.label.toLowerCase(), column.condition] as const] : [],
      ),
  );
  const clauses = readQuery(state.query);
  const searchable = resolved.filter((column) => column.search);
  const kept = rows.filter((row) =>
    passes(row, clauses, fields, (each, word) =>
      searchable.some((column) => wordMatches(column.search!(each), word)),
    ),
  );
  const sorts = state.sorts.filter((sort) => byKey.get(sort.key)?.sort);
  if (!sorts.length) return kept;
  return kept
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const { key, dir } of sorts) {
        const sort = byKey.get(key)!.sort!;
        const order = compare(sort(a.row), sort(b.row));
        if (order) return dir === "desc" ? -order : order;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
}
