import { useState } from "react";
import type { SheetSlot } from "@pe/agent-contracts/slots";
import { Button } from "@pe/kit/lang/button";
import { StateCell } from "@pe/kit/lang/cell";
import { useRouteSearchSlice } from "../../activity";
import type { DrawContext, Fields } from "../../typed-route.ts";
import { sheetCells, typedCells, type SheetCell } from "./index.ts";

/*
 * The kernel's sheet pane (ADR 0035 rules 1 and 3): one kit StateCell per binding per row, staged
 * through the one Work write path (`ctx.cells.at`); the write button is the route's `sheet` verb in the
 * pane head (`sheet.plan` then `sheet.apply`), so this pane never reaches Revit. A route adds no chrome.
 */
type Ctx = DrawContext<unknown, Fields, Record<string, unknown>, unknown>;

/** Rows are the subject field's ids; a route with no subject lists the rows its Work already keys. */
const rowsOf = (slot: SheetSlot, ctx: Ctx, field?: string): string[] => {
  const picked = field ? (ctx.page.read() as Record<string, { kind?: string; ids?: string[] }>)[field] : undefined;
  if (picked?.kind === "ids" && picked.ids) return picked.ids;
  const doc = (ctx.cells.doc ?? {}) as Record<string, unknown>;
  return [...new Set(Object.entries(slot.bindings).flatMap(([name, b]) =>
    b.per === "subject" && !b.rows ? Object.keys((doc[name] ?? {}) as object) : []))];
};

/** Where a value stands when Work holds none: the layer and, for the firm file, which file. */
const layerWord = (cell: SheetCell) => (cell.ref ? `${cell.source} ${cell.ref}` : cell.source);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Cell({ ctx, cell }: { ctx: Ctx; cell: SheetCell }) {
  const handle = ctx.cells.at(cell.row === undefined ? [cell.binding] : [cell.binding, cell.row]);
  const under = cell.source === "work" ? cell.model : cell.value;
  const field = cell.field;
  const choices = cell.choices;
  return (
    <div className="contents" data-sheet-cell={cell.label} data-source={cell.source} data-drift={cell.drift || undefined}>
      <span className="min-w-0 truncate">{cell.label}</span>
      <span className="block min-w-0 h-(--item-h)">
        <StateCell
          cell={handle}
          value={ctx.value as never}
          label={cell.label}
          model={under}
          source={layerWord(cell)}
          scale="row"
          {...(cell.unit ? { unit: { label: cell.unit } } : {})}
          {...(cell.numeric || field ? { numeric: cell.numeric ?? {} } : {})}
          {...(field ? {
            format: (v: unknown) => String((v as Record<string, unknown> | null)?.[field] ?? "—"),
            parse: (text: string) => ({ [field]: Number(text) }),
          } : {})}
          {...(choices ? {
            options: choices,
            current: choices.find((c) => !c.clear && same(c.value ?? c.key, cell.value))?.key ?? null,
          } : {})}
        />
      </span>
      <span className="t-small min-w-0 truncate text-ink-2" data-input-source={cell.source}>{layerWord(cell)}</span>
    </div>
  );
}

export function SheetPane({ ctx: { draw: ctx, slot, field } }: { ctx: { draw: Ctx; slot: SheetSlot; field?: string } }) {
  const [typedOnly, setTypedOnly] = useState(false);
  const search = useRouteSearchSlice((s) => s);
  const read = ctx.value.value ?? undefined;
  const cells = sheetCells(slot, { rows: rowsOf(slot, ctx, field), work: ctx.cells.doc, model: [], read });
  const shown = typedOnly ? typedCells(cells) : cells;
  const from = read !== undefined ? slot.from?.(read, search) : null;
  return (
    <section aria-label="Sheet" className="flex min-w-0 flex-col gap-1 t-small">
      {from ? <a href={from.href} className="min-w-0 truncate text-ink-2" data-sheet-from="">{from.says}</a> : null}
      <Button pressed={typedOnly} label={typedOnly ? "Show every cell" : "Show typed cells only"} onPress={() => setTypedOnly(!typedOnly)}>
        typed only ({typedCells(cells).length})
      </Button>
      {!cells.length ? <p className="text-ink-2">Nothing on this sheet yet: open a subject to list its cells.</p>
        : !shown.length ? <p className="text-ink-2">No typed cells; show every cell to type one.</p>
        : (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,6rem)] items-center gap-x-2 gap-y-1">
            {shown.map((cell) => <Cell key={`${cell.binding}:${cell.row ?? ""}`} ctx={ctx} cell={cell} />)}
          </div>
        )}
    </section>
  );
}
