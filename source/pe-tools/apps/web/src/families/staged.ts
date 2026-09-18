/**
 * Staged cell edits, and the spec they generate.
 *
 * `/families` is an editable table where Pea and a person both PROPOSE cell values (`edits` on the
 * route document, same shape, told apart by `by`) and only a person accepts them (`accepted`,
 * off the agent mask). Plan turns the accepted values into Family Foundry patch members at that
 * moment, one member per family, and the existing plan/apply lane takes them from there.
 *
 * ONE MEMBER PER FAMILY is forced by the patch grammar, not by taste: a patch's `types` map is
 * keyed by TYPE NAME and is merged onto every family its `select` matches, and a type name the
 * family does not have is CREATED by that merge (`FamilyPatch.Apply`, `{}` = ensure exists). One
 * member holding two families' cells would therefore write B's types from A's edits. So each
 * generated member selects exactly one family by name.
 */
import type { FamilyCellEdit } from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA } from "#/host/familyfoundry";

type CellAddress = Pick<FamilyCellEdit, "familyId" | "typeName" | "parameter">;

/** One cell's address — the row (family + type) and the parameter column. */
export const editKey = (cell: CellAddress): string =>
  `${cell.familyId} ${cell.typeName} ${cell.parameter}`;

/** The proposal (or accept) standing on one cell, or undefined. */
export const at = (list: readonly FamilyCellEdit[], cell: CellAddress) =>
  list.find((edit) => editKey(edit) === editKey(cell));

/** Put `edit` on its cell, replacing whatever stood there. */
export const put = (list: readonly FamilyCellEdit[], edit: FamilyCellEdit) => [
  ...drop(list, edit),
  edit,
];

/** Take whatever stands on one cell off the list. */
export const drop = (list: readonly FamilyCellEdit[], cell: CellAddress) =>
  list.filter((edit) => editKey(edit) !== editKey(cell));

/** Accepted means a person accepted THIS value on this cell; a later proposal is not accepted. */
export const isAccepted = (accepted: readonly FamilyCellEdit[], edit: FamilyCellEdit) =>
  at(accepted, edit)?.value === edit.value;

/**
 * A typed cell as a patch scalar. `PortableValue` is one JSON scalar: a number stays a number and
 * `true`/`false` stay booleans, so a Yes/No or an integer round-trips; everything else is the text
 * the person typed, which is also how a length ("3' - 6\"") reaches the engine's unit parser.
 */
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
  /** One line per staged cell, for the readout: what this member would change. */
  cells: readonly string[];
}

/** Family Foundry patch members, one per family with staged edits, in family-name order. */
export function stagedMembers(
  edits: readonly FamilyCellEdit[],
  at: Date,
  schema: string = FF_SPEC_SCHEMA,
): StagedMember[] {
  const byFamily = new Map<number, FamilyCellEdit[]>();
  for (const edit of edits) {
    const bucket = byFamily.get(edit.familyId);
    if (bucket) bucket.push(edit);
    else byFamily.set(edit.familyId, [edit]);
  }
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return [...byFamily.values()]
    .map((cells) => {
      const { familyId, familyName } = cells[0]!;
      const types: Record<string, Record<string, string | number | boolean>> = {};
      for (const cell of cells)
        (types[cell.typeName] ??= {})[cell.parameter] = patchValue(cell.value);
      return {
        familyId,
        familyName,
        path: `settings/families/staged-${familyName.replace(/[^\w.-]+/g, "-")}-${stamp}.json`,
        content: `${JSON.stringify(
          { $schema: schema, select: { names: [familyName] }, patch: { types } },
          null,
          2,
        )}\n`,
        cells: cells.map((cell) => `${cell.typeName} · ${cell.parameter} = ${cell.value}`),
      };
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}
