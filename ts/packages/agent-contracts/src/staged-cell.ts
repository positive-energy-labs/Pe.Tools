import type { Change, Rung } from "./draft.ts";
import type { RouteStatePatch } from "./route-state.ts";

/*
 * Step 3 frozen contract (ADR 0030 rules 8 and 9). TEMPORARY SCAFFOLD: the bodies throw and nothing
 * calls them yet. The fill moves these into draft.ts, deletes the suggestion lane there, and deletes
 * this file. Not exported from index.ts until then, so no current caller can reach a throwing body.
 */

/**
 * One staged value per Work cell. The person and Pea write the same `edit`; the host stamps `by`,
 * `at` and `base`; the newest accepted write stands (last writer wins). There is no `suggestion`.
 * Undo is the owner's Work journal restoring the earlier preimage, never a cleared value.
 */
export interface StagedCell {
  edit?: Change | null;
}

/**
 * Every way a cell changes. `set` and `clear` are any author's; `retire` is the host's alone, after
 * proven native success. No suggest, unsuggest or take: a Pea write is already the staged value.
 */
export type CellWrite =
  /** A value equal to `baseline` stages nothing (the cell resolves to the model again). */
  | { kind: "set"; rung: Rung; baseline?: Rung }
  | { kind: "clear" }
  | { kind: "retire"; consumed: Rung };

/** The only way anything writes a cell: the patches one write makes at `[...cellsPath, key, "edit"]`. */
export function cellPatches(
  _cellsPath: readonly string[],
  _key: string,
  _cell: StagedCell,
  _write: CellWrite,
): RouteStatePatch[] {
  throw Error("Step 3 scaffold: cellPatches is filled by the contracts edge");
}

/**
 * The storage boundary (runtime work-cutover.ts, called from host route-document-store.ts on read).
 * Ruled migration: a cell with only a suggestion keeps that value as its staged edit with its
 * original author; a cell with both keeps the edit and drops the differing suggestion, which is the
 * one named loss. Undo history is untouched: journal steps already restore whole preimages.
 */
export function collapseSuggestion(_cell: Record<string, unknown>): StagedCell & Record<string, unknown> {
  throw Error("Step 3 scaffold: collapseSuggestion is filled by the contracts edge");
}
