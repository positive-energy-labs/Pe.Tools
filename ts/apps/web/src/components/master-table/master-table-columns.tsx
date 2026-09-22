import {
  CELL_STATE_ORDER,
  StateCell,
  cellStateLabel,
  type StateCellProps,
} from "#/components/lang/cell";
import { VerdictCell } from "#/components/master-table/cells";
import type { Column, ValueColumn } from "#/components/master-table/model";

export type ResolvedColumn<Row> = ValueColumn<Row> & {
  readState?: (row: Row) => StateCellProps;
  readWord?: (row: Row) => string;
};

export function resolveStateColumn<Row>(column: Column<Row>): ResolvedColumn<Row> {
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
