import { useState, type ReactNode } from "react";
import { decode, type SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import type { SheetSlot } from "@pe/agent-contracts/slots";
import { Button } from "@pe/kit/lang/button";
import { StateCell } from "@pe/kit/lang/cell";
import { useRouteSearchSlice } from "../../activity";
import type { DrawContext, Fields } from "../../typed-route.ts";
import { sheetCells, typedCells, type SheetCell } from "./index.ts";
import { FindingVerb } from "../findings/verb.tsx";

/*
 * The kernel's sheet pane (ADR 0035 rules 1 and 3): one kit StateCell per binding per row, staged
 * through the one Work write path (`ctx.cells.at`); the write button is the route's `sheet` verb in the
 * pane head (`sheet.plan` then `sheet.apply`), so this pane never reaches Revit. A route adds no chrome.
 * A row keyed by a SubjectRef carries the person's Finding verb (rule 9), once, on its first cell,
 * over the `finding` command the mount gives every route with Work (route/slots/kernel-commands.ts).
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
/** A `json` cell's text: JSON when it parses, else the text itself. */
const jsonOrText = (text: string): unknown => { try { return JSON.parse(text); } catch { return text; } };

/** The row's subject, when its key is a SubjectRef code; a binding's own row key (a slot name) has none. */
const subjectRow = (row: string | undefined) => (row !== undefined && decode(row).ok ? (row as SubjectRefCode) : null);

function Cell({ ctx, cell, verb }: { ctx: Ctx; cell: SheetCell; verb: ReactNode }) {
  const handle = ctx.cells.at(cell.row === undefined ? [cell.binding] : [cell.binding, cell.row]);
  const under = cell.source === "work" ? cell.model : cell.value;
  const field = cell.field;
  const choices = cell.choices;
  return (
    <div className="contents" data-sheet-cell={cell.label} data-sheet-address={cell.row === undefined ? cell.binding : `${cell.binding}:${cell.row}`} data-source={cell.source} data-drift={cell.drift || undefined}>
      <span className="min-w-0 truncate">{cell.label}</span>
      <span className="block min-w-0 h-(--item-h)">
        <StateCell
          cell={handle}
          value={ctx.value as never}
          label={cell.label}
          model={under}
          source={layerWord(cell)}
          scale="row"
          {...(cell.refusal ? { capReason: cell.refusal } : {})}
          {...(cell.note ? { note: cell.note } : {})}
          {...(cell.unit ? { unit: { label: cell.unit } } : {})}
          {...(cell.numeric || field ? { numeric: cell.numeric ?? {} } : {})}
          {...(field ? {
            format: (v: unknown) => String((v as Record<string, unknown> | null)?.[field] ?? "—"),
            parse: (text: string) => ({ [field]: Number(text) }),
          } : cell.json ? {
            format: (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v)),
            parse: (text: string) => (typeof under === "string" ? text : jsonOrText(text)),
          } : {})}
          {...(choices ? {
            options: choices,
            // A cell that holds nothing shows its clear choice ("None") as current.
            current: choices.find((c) => !c.clear && same(c.value ?? c.key, cell.value))?.key
              ?? (cell.value == null ? choices.find((c) => c.clear)?.key : undefined) ?? null,
          } : {})}
        />
      </span>
      <span className="t-small min-w-0 truncate text-ink-2" data-input-source={cell.source}>{layerWord(cell)}</span>
      <span>{verb}</span>
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
  // The read's own states come first: failed with its reason, computing, or the sheet's empty state and exit.
  const value = ctx.value as { status?: string; reason?: string };
  if (value.status === "failed" && read === undefined) return <p role="alert">{value.reason}</p>;
  if (read === undefined && value.status === "pending") return <p role="status">computing</p>;
  const empty = slot.empty?.(read ?? null);
  const said = read !== undefined ? slot.note?.(read) : null;
  const note = said ? <p role="note" className="min-w-0 text-ink-2" data-sheet-note="">{said}</p> : null;
  const verbed = new Set<string>();
  const verbOf = (cell: SheetCell) => {
    const subject = subjectRow(cell.row);
    if (!subject || verbed.has(subject)) return null;
    verbed.add(subject);
    return <FindingVerb subject={subject} name={cell.label} action={ctx.write("finding")} />;
  };
  if (empty) return <>{note}<p className="text-ink-2">{empty}</p></>;
  return (
    <section aria-label="Sheet" className="flex min-w-0 flex-col gap-1 t-small">
      {from?.href ? <a href={from.href} className="min-w-0 truncate text-ink-2" data-sheet-from="">{from.says}</a>
        : from ? <p className="min-w-0 text-ink-2" data-sheet-from="">{from.says}</p> : null}
      {note}
      <Button kind="quiet" pressed={typedOnly} label={typedOnly ? "Show every cell" : "Show typed cells only"} onPress={() => setTypedOnly(!typedOnly)}>
        typed only ({typedCells(cells).length})
      </Button>
      {!cells.length ? <p className="text-ink-2">Nothing on this sheet yet: open a subject to list its cells.</p>
        : !shown.length ? <p className="text-ink-2">No typed cells; show every cell to type one.</p>
        : (
          // The label keeps its floor (10rem or 45%); the value input sheds width first and the
          // source word takes only its own width, so a ~330px pane no longer reads "Vel..." (L3).
          <div className="grid grid-cols-[minmax(min(10rem,45%),1fr)_minmax(0,9rem)_fit-content(6rem)_auto] items-center gap-x-2 gap-y-1">
            {shown.map((cell) => <Cell key={`${cell.binding}:${cell.row ?? ""}`} ctx={ctx} cell={cell} verb={verbOf(cell)} />)}
          </div>
        )}
    </section>
  );
}
