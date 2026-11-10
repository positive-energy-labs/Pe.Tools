import type { Immutable } from "@pe/agent-contracts";
import type { ModelValue, SheetSlot, StateCell } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";

/*
 * The kernel seam for the sheet slot (ADR 0035 rules 1 and 3). The slot draws one StateCell per
 * binding per row from the Work doc and the model's values; staging goes through the one Work
 * write path (`DrawContext.cells`) and Revit through `SHEET_COMMANDS` (`DrawContext.write`).
 * Owner: slice 7, which replaces every throw here and deletes the hand-drawn `InputsBody`.
 */

export interface SheetInput<W = unknown> {
  /** The rows: the route subject's members, in roster order. */
  readonly rows: readonly SubjectRefCode[];
  /** The Work doc the `local` bindings and staged values live in; null before the handle lands. */
  readonly work: Immutable<W> | null;
  /** What Revit (parameter) and the store (store) hold for each binding's row. */
  readonly model: readonly ModelValue[];
}

/** A pure projection: the StateCells the slot draws, in row order then binding order. */
export function sheetCells(slot: SheetSlot, input: SheetInput): readonly StateCell[] {
  void slot;
  void input;
  throw Error("not implemented: slice 7 (sheet slot draws a binding's StateCells)");
}
