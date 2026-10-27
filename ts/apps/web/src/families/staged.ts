/** Keyed `/families` cells and the Family Foundry drafts edit cells generate. */
import {
  familyCellAddress,
  type FamilyCellAddress,
  type FamilyCellState,
} from "@pe/agent-contracts";

/** A cell's group path in the Chat head: parameter › family › type. */
export const familiesGroupOf = (key: string): string[] => {
  const { parameter, familyName, typeName } = familyCellAddress(key);
  return [parameter, familyName, typeName];
};

export interface FamilyCellEntry extends FamilyCellAddress {
  key: string;
  cell: FamilyCellState;
}

export const familyCellEntries = (cells: Record<string, FamilyCellState>): FamilyCellEntry[] =>
  Object.entries(cells).map(([key, cell]) => ({ key, ...familyCellAddress(key), cell }));

/** Names are presentation facts; the host composes the immutable drafts. */
export const editedFamilies = (cells: Record<string, FamilyCellState>): string[] =>
  [
    ...new Set(
      familyCellEntries(cells).flatMap((entry) => (entry.cell.edit ? [entry.familyName] : [])),
    ),
  ].sort();
