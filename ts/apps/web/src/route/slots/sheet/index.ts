import type { Immutable } from "@pe/agent-contracts";
import type { ModelValue, SheetSlot, StateCell } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";

/*
 * The kernel seam for the sheet slot (ADR 0035 rules 1 and 3). The slot draws one StateCell per
 * binding per row from the Work doc and the model's values; staging goes through the one Work
 * write path (`DrawContext.cells`) and Revit through `SHEET_COMMANDS` (`DrawContext.write`).
 * Owner: slice 7.
 *
 * Census of what Fans' borrowed `InputsBody` (`ducts/sheet/mount.tsx`) draws, and the slot feature
 * that owns each (slice 7 Delete, 2026-11-10). `home` = landed here; `owed` = a slot feature with a
 * home, not built; `none` = no home in Fans' sheet, the reason the Delete stopped.
 *   draft cells, `{ edit: { value, by, at } }` at every Fans Work address    home: `SheetSlot.draft`, `pending`
 *   design friction: route cell, default 0.08, min 0, unit in-wg/100 ft    owed: default layer, cell units, numeric bounds
 *   parameter slot names (fanStatic, terminalDrop, componentDrop, fitting) owed: model from the read (`snapshot.slots`)
 *   ESP and protocol slot pickers (options and coverage from the read)     owed: choice kind with read-derived options
 *   write scope (`writeIntent`, offered from the open fan)                 owed: choice kind with read-derived options
 *   unit roles, one per equipment node, fan or passive                     owed: rows per binding (not the fan subject), choice kind
 *   Fans-owned input rows (drops, esp, flows) with unit and source chip   owed: rows per binding, cell units, layered source
 *   firm line (version, path, present)                                     owed: the firm layer's provenance on `source`
 *   undo, redo, last effect, revert and restore                            home: kernel chrome (the Timeline), not a body part
 *   typed-only filter                                                      owed: pane chrome, a filter on `source === "work"`
 *   criteria, split policy, fitting tables, kinds, network rulings        none: staged in /ducts Work through `editPatches`;
 *                                                                           a Fans binding addresses Fans Work only
 *   per-fitting loss readouts under each table                            none in the sheet: a result readout (goal or ledger)
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
      const at = subject === undefined ? held : (held as Readonly<Record<string, unknown>> | undefined)?.[subject];
      const edit = slot.draft ? (at as { edit?: { value?: unknown; by?: string; at?: string | null } | null } | undefined)?.edit : undefined;
      const staged = slot.draft ? edit?.value : at;
      const model = modelOf(binding, subject);
      const value = staged ?? model?.value ?? null;
      return {
        binding,
        ...(subject === undefined ? {} : { subject }),
        kind: declared.kind,
        value,
        model: model?.value ?? null,
        // A raw Work value carries no author; a draft cell's edit is the pending change, by whoever staged it.
        pending: edit && staged !== undefined
          ? { by: edit.by === "pea" ? "pea" : "person", value: staged, at: edit.at ?? "" }
          : null,
        // A local binding never reaches Revit, so it cannot drift from it.
        drift: declared.kind !== "local" && JSON.stringify(value) !== JSON.stringify(model?.value ?? null),
        freshness: model?.freshness ?? (declared.kind === "local" ? "fresh" : "never"),
        source: staged !== undefined ? "work" : "model",
      };
    }),
  );
}
