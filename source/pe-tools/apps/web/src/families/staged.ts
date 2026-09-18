/** Keyed `/families` cells and the Family Foundry members staged cells generate. */
import {
  familyCellAddress,
  familyCellKey,
  familyStagedPatch,
  type FamilyCellAddress,
  type FamilyCellState,
} from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA } from "#/host/familyfoundry";

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

export interface StagedMember {
  familyId: number;
  familyName: string;
  path: string;
  content: string;
  cells: readonly string[];
}

/** Family Foundry patch members, one per family with staged cells, in family-name order. */
export function stagedMembers(
  cells: Record<string, FamilyCellState>,
  at: Date,
  schema: string = FF_SPEC_SCHEMA,
): StagedMember[] {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const ids = [
    ...new Set(familyCellEntries(cells).flatMap((e) => (e.cell.staged ? [e.familyId] : []))),
  ];
  return ids
    .map((familyId) => {
      const { familyName, spec, keys } = familyStagedPatch(cells, familyId)!;
      return {
        familyId,
        familyName,
        path: `settings/families/staged-${familyName.replace(/[^\w.-]+/g, "-")}-${stamp}.json`,
        // The host proves a planned member is exactly this before the plan may retire its cells.
        content: `${JSON.stringify({ $schema: schema, ...spec }, null, 2)}\n`,
        cells: keys.map((key) => {
          const { typeName, parameter } = familyCellAddress(key);
          return `${typeName} · ${parameter} = ${cells[key]!.staged!.value.value}`;
        }),
      };
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}
