/** Keyed `/families` cells and the Family Foundry drafts staged cells generate. */
import {
  familyCellAddress,
  familyCellKey,
  familyStagedPatch,
  type FamilyCellAddress,
  type FamilyCellState,
} from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA } from "#/host/familyfoundry";

/** A cell's group path in the Chat head: parameter › family › type. */
export const familiesGroupOf = (key: string): string[] => {
  const { parameter, familyName, typeName } = familyCellAddress(key);
  return [parameter, familyName, typeName];
};

export const cellAt = (
  cells: Record<string, FamilyCellState>,
  address: FamilyCellAddress,
): FamilyCellState | undefined => cells[familyCellKey(address)];

export interface FamilyCellEntry extends FamilyCellAddress {
  key: string;
  cell: FamilyCellState;
}

export const familyCellEntries = (cells: Record<string, FamilyCellState>): FamilyCellEntry[] =>
  Object.entries(cells).map(([key, cell]) => ({ key, ...familyCellAddress(key), cell }));

export interface StagedDraft {
  familyName: string;
  /** Names the draft in its run; nothing is filed here. */
  path: string;
  content: string;
}

/** Family Foundry patch drafts, one per family with staged cells, in family-name order. */
export function stagedDrafts(
  cells: Record<string, FamilyCellState>,
  schema: string = FF_SPEC_SCHEMA,
): StagedDraft[] {
  const names = [
    ...new Set(familyCellEntries(cells).flatMap((e) => (e.cell.staged ? [e.familyName] : []))),
  ];
  return names
    .map((familyName) => {
      const { spec } = familyStagedPatch(cells, familyName)!;
      return {
        familyName,
        path: `staged/${familyName.replace(/[^\w.-]+/g, "-")}.json`,
        // The host proves these captured bytes are exactly the staged cells before the plan may retire them.
        content: `${JSON.stringify({ $schema: schema, ...spec }, null, 2)}\n`,
      };
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}
