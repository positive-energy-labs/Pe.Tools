import {
  CELL_STATE_ORDER,
  StateCell,
  cellStateLabel,
  type StateCellProps,
} from "#/components/lang/cell";
import { VerdictCell } from "#/components/master-table/cells";
import type { Column, ValueColumn } from "#/components/master-table/model";
import type { QueryRead } from "#/components/master-table/view";

export type ResolvedColumn<Row> = ValueColumn<Row> & {
  condition?: QueryRead<Row>;
  readState?: (row: Row) => StateCellProps;
  readWord?: (row: Row) => string;
};

/** A column as the table reads it: its body drawn, and a facet column's query field (MAP N4). */
export function resolveStateColumn<Row>(column: Column<Row>): ResolvedColumn<Row> {
  const body = resolveBody(column);
  if (body.condition || !(body.facet || body.options)) return body;
  const facet = body.facet;
  return {
    ...body,
    condition: {
      kind: "text",
      read: (row: Row) => facet?.(row) ?? null,
      match: body.match,
      values: body.options?.map((option) => option.value),
    },
  };
}

function resolveBody<Row>(column: Column<Row>): ResolvedColumn<Row> {
  if (column.verdict !== undefined) {
    const verdict = column.verdict;
    return {
      ...column,
      verdict: undefined,
      cell: (row: Row) => <VerdictCell verdict={verdict(row)} />,
      facet: column.facet ?? ((row: Row) => verdict(row).word),
      sort: column.sort ?? ((row: Row) => verdict(row).word),
    } as ResolvedColumn<Row>;
  }
  const state = column.state;
  if (state === undefined) return column;
  const word = column.word ?? ((row: Row) => cellStateLabel(state(row)));
  return {
    ...column,
    state: undefined,
    word: undefined,
    cell: (row: Row) => <StateCell scale="row" {...state(row)} />,
    facet: column.facet ?? word,
    sort: column.sort ?? ((row: Row) => CELL_STATE_ORDER.indexOf(cellStateLabel(state(row)))),
    readState: state,
    readWord: word,
  } as ResolvedColumn<Row>;
}
