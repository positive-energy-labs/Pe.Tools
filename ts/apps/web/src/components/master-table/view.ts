/**
 * THE VIEW — which rows a table shows, in which order, as one pure function (the approved table
 * reshape). `Table` renders exactly `visibleRows(...)`, and every wrapper (the frame's counts and
 * select-all, an export, a summary) reads the same function, so no two readers can disagree.
 *
 * Semantics: a column filter keeps rows whose `match` accepts the value, else whose `facet` equals
 * it; the query keeps rows where any searchable column contains it (case-insensitive); sorts apply
 * in order, each on its column's `sort`, and ties keep the input order.
 */
import { useState } from "react";

import { resolveStateColumn } from "#/components/master-table/master-table-columns";
import type { Column, QueryGrammar, TableState } from "#/components/master-table/model";

export const emptyTableState = (): TableState => ({ filters: {}, sorts: [], query: "" });

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
  grammar?: QueryGrammar,
): Row[] {
  const resolved = columns
    .filter((column) => !state.hiddenColumns?.includes(column.key))
    .map(resolveStateColumn);
  const byKey = new Map(resolved.map((column) => [column.key, column]));
  // With a grammar only its free words search, each one on its own; without, the whole text does.
  const words = (
    grammar
      ? grammar
          .tokens(state.query)
          .filter((token) => token.kind === "free")
          .map((token) => token.text)
      : [state.query.trim()]
  )
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  const searchable = resolved.filter((column) => column.search);
  const kept = rows.filter((row) => {
    for (const [key, value] of Object.entries(state.filters)) {
      const column = byKey.get(key);
      // A filter only acts on a column that can be filtered, as the header offers it.
      if (!column || !(column.match || column.facet)) continue;
      const hit = column.match ? column.match(row, value) : column.facet?.(row) === value;
      if (!hit) return false;
    }
    return words.every((word) =>
      searchable.some((column) => column.search!(row).toLowerCase().includes(word)),
    );
  });
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

/** The whitespace-delimited word under the caret, and the text before the caret within it. */
export function tokenAt(text: string, caret: number) {
  const start = text.lastIndexOf(" ", caret - 1) + 1;
  const end = text.indexOf(" ", caret);
  return { start, end: end === -1 ? text.length : end, text: text.slice(start, caret) };
}

export const removeToken = (text: string, token: string) =>
  text
    .split(/\s+/)
    .filter((word) => word !== token)
    .join(" ");
