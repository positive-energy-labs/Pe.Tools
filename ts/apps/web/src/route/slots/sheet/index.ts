import type { Immutable } from "@pe/agent-contracts";
import type { ModelValue, SheetChoice, SheetSlot, StateCell } from "@pe/agent-contracts/slots";

/*
 * The kernel seam for the sheet slot (ADR 0035 rules 1 and 3). The slot draws one StateCell per
 * binding per row from the Work doc, the route's core read and its declared layers; staging goes
 * through the one Work write path (`DrawContext.cells`) and Revit through `SHEET_COMMANDS`. Owner: slice 7.
 *
 * Census of what Fans' borrowed `InputsBody` drew, and where each part lives now (slice 7 Delete,
 * ruling 2026-11-10: split by owner; MAP decision log). Slot features: `SheetSlot.draft`, a binding's
 * `default`/`unit`/`min`/`max`/`digits`, `model`, `choices`, `rows`, a firm `source` with `ref`, and
 * the pane's typed-only filter.
 *   draft cells, `{ edit: { value, by, at } }`            the slot: `SheetSlot.draft`, `pending` by author
 *   design friction (default 0.08, min 0, in-wg/100 ft)  /ducts sheet: a criteria cell, default layer and limits
 *   criteria and split policy, with their firm source    /ducts sheet: `criteria` rows, firm `source` and `ref`
 *   the firm line (version, file, present)               /ducts sheet: the `ref` of every firm-sourced cell
 *   fitting tables, rule assignments                     /ducts Rules pane (its chips), already there
 *   unit kinds                                           /ducts All-systems rules pane, already there
 *   network rulings (joins, ends)                        /ducts Rulings pane, already there
 *   parameter slot names, ESP and protocol slot pickers  /fans sheet: `parameters` rows, model and choices from the read
 *   write scope (`writeIntent`)                          /fans sheet: choices from the open fan
 *   unit roles, drops, esp and flows                     /fans sheet: rows per binding, `field`, units, model from the read
 *   the /ducts design Fans prices with                   /fans sheet: the slot's read-only `from` line, linked to /ducts
 *   per-fitting loss readouts                            /fans Ledger: a result, beside the ESP it explains
 *   undo, redo, revert, restore                          kernel chrome (the Timeline) and each cell's own clear
 *   typed-only filter                                    the sheet pane's chrome, cells whose source is Work
 */

export interface SheetInput<W = unknown> {
  /** The rows of a per-subject binding with no rows of its own: the route subject's members, in roster order. */
  readonly rows: readonly string[];
  /** The Work doc the bindings stage in; null before the handle lands. */
  readonly work: Immutable<W> | null;
  /** What Revit (parameter) and the store (store) hold for a binding's row, when read apart from `read`. */
  readonly model: readonly ModelValue[];
  /** The route's core read; a binding's `rows`, `model` and `choices` read it. */
  readonly read?: unknown;
}

/** A StateCell as the kernel draws it: the binding's label, unit, limits and choices for this row. */
export interface SheetCell extends StateCell {
  readonly label: string;
  readonly unit?: string;
  readonly numeric?: { readonly min?: number; readonly max?: number; readonly digits?: number };
  readonly field?: string;
  readonly choices?: readonly SheetChoice[];
  readonly ref?: string;
}

const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** A pure projection: binding by binding in declaration order, each per-subject binding once per row. */
export function sheetCells(slot: SheetSlot, input: SheetInput): readonly SheetCell[] {
  const work = (input.work ?? {}) as Readonly<Record<string, unknown>>;
  const read = input.read;
  return Object.entries(slot.bindings).flatMap(([binding, declared]) =>
    (declared.per === "subject" ? (read !== undefined && declared.rows?.(read)) || input.rows : [undefined]).map((row): SheetCell => {
      const held = work[binding];
      const at = row === undefined ? held : (held as Readonly<Record<string, unknown>> | undefined)?.[row];
      const edit = slot.draft ? (at as { edit?: { value?: unknown; by?: string; at?: string | null } | null } | undefined)?.edit : undefined;
      const staged = slot.draft ? edit?.value : at;
      const layer = input.model.find((m) => m.binding === binding && m.row === row)
        ?? (read !== undefined ? declared.model?.(read, row) : undefined) ?? undefined;
      const model = layer?.value ?? null;
      const value = staged ?? model ?? declared.default ?? null;
      const source = staged !== undefined ? "work"
        : layer && layer.value != null ? (("source" in layer && layer.source) || "model")
        : declared.default !== undefined ? "default" : "model";
      const numeric = defined({ min: declared.min, max: declared.max, digits: declared.digits });
      return {
        binding,
        ...(row === undefined ? {} : { row }),
        kind: declared.kind,
        value,
        model,
        // A raw Work value carries no author; a draft cell's edit is the pending change, by whoever staged it.
        pending: edit && staged !== undefined
          ? { by: edit.by === "pea" ? "pea" : "person", value: staged, at: edit.at ?? "" }
          : null,
        // A local binding never reaches Revit, so it cannot drift from it.
        drift: declared.kind !== "local" && JSON.stringify(value) !== JSON.stringify(model),
        freshness: layer?.freshness ?? (layer ? "fresh" : declared.kind === "local" ? "fresh" : "never"),
        source,
        label: row === undefined ? (declared.label ?? binding)
          : (read !== undefined && declared.rowLabel?.(read, row)) || declared.label || binding,
        ...defined({
          unit: declared.unit,
          field: declared.field,
          ref: layer && "ref" in layer ? layer.ref : undefined,
          choices: read !== undefined ? declared.choices?.(read, row) : undefined,
        }),
        ...(Object.keys(numeric).length ? { numeric } : {}),
      };
    }),
  );
}

/** The pane's typed-only filter: the cells Work stages, by person or Pea. */
export const typedCells = (cells: readonly SheetCell[]) => cells.filter((c) => c.source === "work");
