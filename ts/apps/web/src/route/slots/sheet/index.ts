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

/** A pure projection: the StateCells the slot draws, binding by binding in declaration order, each per-subject binding once per row. */
export function sheetCells(slot: SheetSlot, input: SheetInput): readonly StateCell[] {
  const work = (input.work ?? {}) as Readonly<Record<string, unknown>>;
  const modelOf = (binding: string, subject?: SubjectRefCode) =>
    input.model.find((m) => m.binding === binding && m.subject === subject);
  return Object.entries(slot.bindings).flatMap(([binding, declared]) =>
    (declared.per === "subject" ? input.rows : [undefined]).map((subject): StateCell => {
      const held = work[binding];
      const staged = subject === undefined ? held : (held as Readonly<Record<string, unknown>> | undefined)?.[subject];
      const model = modelOf(binding, subject);
      const value = staged ?? model?.value ?? null;
      return {
        binding,
        ...(subject === undefined ? {} : { subject }),
        kind: declared.kind,
        value,
        model: model?.value ?? null,
        // ponytail: raw Work values carry no author; draw `pending` when a binding stages draft cells.
        pending: null,
        // A local binding never reaches Revit, so it cannot drift from it.
        drift: declared.kind !== "local" && JSON.stringify(value) !== JSON.stringify(model?.value ?? null),
        freshness: model?.freshness ?? (declared.kind === "local" ? "fresh" : "never"),
        source: staged !== undefined ? "work" : "model",
      };
    }),
  );
}
