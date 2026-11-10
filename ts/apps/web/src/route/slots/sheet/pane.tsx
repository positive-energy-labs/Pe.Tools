import type { SheetSlot, StateCell } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import type { DrawContext, Fields } from "../../typed-route.ts";
import { sheetCells } from "./index.ts";

/*
 * The kernel's sheet pane (ADR 0035 rules 1 and 3): one row per StateCell, the value beside the model
 * value it drifts from, staged through the one Work write path. The write button is the route's
 * `sheet` verb in the pane head (`sheet.plan` then `sheet.apply`); this pane never reaches Revit.
 */
type Ctx = DrawContext<unknown, Fields, Record<string, unknown>, unknown>;

/** Rows are the subject field's ids; a route with no subject lists the rows its Work already keys. */
const rowsOf = (slot: SheetSlot, ctx: Ctx, field?: string): SubjectRefCode[] => {
  const picked = field ? (ctx.page.read() as Record<string, { kind?: string; ids?: SubjectRefCode[] }>)[field] : undefined;
  if (picked?.kind === "ids" && picked.ids) return picked.ids;
  const doc = (ctx.cells.doc ?? {}) as Record<string, unknown>;
  return [...new Set(Object.entries(slot.bindings).flatMap(([name, b]) =>
    b.per === "subject" ? Object.keys((doc[name] ?? {}) as object) : []))] as SubjectRefCode[];
};

export function SheetPane({ ctx: { draw: ctx, slot, field } }: { ctx: { draw: Ctx; slot: SheetSlot; field?: string } }) {
  // ponytail: model values arrive with the plan review (`before`); add a model read when a sheet must show drift before planning.
  const cells = sheetCells(slot, { rows: rowsOf(slot, ctx, field), work: ctx.cells.doc, model: [] });
  const stage = (cell: StateCell, text: string) => {
    const schema = slot.bindings[cell.binding]!.schema;
    const parsed = schema.safeParse(text === "" ? undefined : Number.isNaN(Number(text)) ? text : Number(text));
    if (!parsed.success) return;
    const path = cell.subject ? [cell.binding, cell.subject] : [cell.binding];
    void ctx.cells.patch([{ path, value: parsed.data }], { label: `${cell.binding} = ${text}` });
  };
  if (!cells.length) return <p>Nothing staged yet.</p>;
  return (
    <dl aria-label="Sheet" className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)_auto] items-center gap-x-3">
      {cells.map((cell) => (
        <div key={`${cell.binding}:${cell.subject ?? ""}`} className="contents" data-source={cell.source} data-drift={cell.drift || undefined}>
          <dt className="min-w-0 truncate">{cell.binding}{cell.subject ? ` ${cell.subject}` : ""}</dt>
          <dd>
            <input aria-label={cell.binding} className="w-full" defaultValue={cell.value == null ? "" : String(cell.value)}
              onBlur={(e) => stage(cell, e.currentTarget.value)} />
          </dd>
          <dd className="t-small text-ink-2">{cell.drift ? <s>{cell.model == null ? "unread" : String(cell.model)}</s> : cell.source}</dd>
        </div>
      ))}
    </dl>
  );
}
