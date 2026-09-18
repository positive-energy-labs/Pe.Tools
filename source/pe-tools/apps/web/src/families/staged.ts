/** Keyed `/families` cells and the Family Foundry members staged cells generate. */
import {
  familyCellAddress,
  familyCellKey,
  type FamilyCellAddress,
  type FamilyCellState,
  type FamilyCellValue,
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

const changeCells = (
  cells: Record<string, FamilyCellState>,
  addresses: readonly FamilyCellAddress[],
  change: (cell: FamilyCellState) => FamilyCellState,
) =>
  Object.fromEntries(
    Object.entries(cells).map(([key, cell]) => [
      key,
      addresses.some((address) => familyCellKey(address) === key) ? change(cell) : cell,
    ]),
  );

export const stageProposals = (
  cells: Record<string, FamilyCellState>,
  addresses: readonly FamilyCellAddress[],
) =>
  changeCells(cells, addresses, (cell) =>
    cell.proposal ? { ...cell, staged: { value: cell.proposal.value } } : cell,
  );

export const clearProposals = (
  cells: Record<string, FamilyCellState>,
  addresses: readonly FamilyCellAddress[],
) => changeCells(cells, addresses, (cell) => ({ ...cell, proposal: null }));

export const clearStaged = (
  cells: Record<string, FamilyCellState>,
  addresses: readonly FamilyCellAddress[],
) => changeCells(cells, addresses, (cell) => ({ ...cell, staged: null }));

export const stageHumanValue = (
  cells: Record<string, FamilyCellState>,
  address: FamilyCellAddress,
  value: FamilyCellValue,
  baseline: string,
) => ({
  ...cells,
  [familyCellKey(address)]: {
    proposal: cells[familyCellKey(address)]?.proposal ?? null,
    staged: value.value === "" || value.value === baseline ? null : { value },
  },
});

export const patchValue = (text: string): string | number | boolean =>
  text === "true"
    ? true
    : text === "false"
      ? false
      : text.trim() !== "" && Number.isFinite(Number(text))
        ? Number(text)
        : text;

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
  const byFamily = new Map<number, (FamilyCellAddress & FamilyCellValue)[]>();
  for (const { cell, ...address } of familyCellEntries(cells)) {
    if (!cell.staged) continue;
    const value = cell.staged.value;
    const bucket = byFamily.get(address.familyId);
    if (bucket) bucket.push({ ...address, ...value });
    else byFamily.set(address.familyId, [{ ...address, ...value }]);
  }
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return [...byFamily.values()]
    .map((entries) => {
      const { familyId, familyName } = entries[0]!;
      const types: Record<string, Record<string, string | number | boolean>> = {};
      for (const entry of entries)
        (types[entry.typeName] ??= {})[entry.parameter] = patchValue(entry.value);
      return {
        familyId,
        familyName,
        path: `settings/families/staged-${familyName.replace(/[^\w.-]+/g, "-")}-${stamp}.json`,
        content: `${JSON.stringify(
          { $schema: schema, select: { names: [familyName] }, patch: { types } },
          null,
          2,
        )}\n`,
        cells: entries.map((entry) => `${entry.typeName} · ${entry.parameter} = ${entry.value}`),
      };
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}
