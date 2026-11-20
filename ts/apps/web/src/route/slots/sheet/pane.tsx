import { useFieldOptionsReading, previousOf } from "../../../host/resource-state";
import { FieldOptionSelect, pickerOptions } from "../../../host/field-options";
import { useState } from "react";
import { decode, type SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { schemaOf, type SheetSlot } from "@pe/agent-contracts/slots";
import { useMention } from "@pe/kit/lang/attention";
import { Button } from "@pe/kit/lang/button";
import { StateCell } from "@pe/kit/lang/cell";
import { useRouteSearchSlice } from "@pe/web-kernel/route/activity";
import type { DrawContext, Fields } from "@pe/web-kernel/route/typed-route";
import { bindingPath, sheetCells, typedCells, type CalcCell } from "./index.ts";

/*
 * The kernel's sheet pane (ADR 0035 rules 1 and 3): one kit StateCell per binding per row, staged
 * through the one Work write path (`ctx.cells.at`); the write button is the route's `sheet` verb in the
 * pane head (`sheet.plan` then `sheet.apply`), so this pane never reaches Revit. A route adds no chrome.
 * A row keyed by a SubjectRef mentions it; the shell owns the one findings surface (rule 9).
 */
type Ctx = DrawContext<unknown, Fields, Record<string, unknown>, unknown>;

/** Rows are the subject field's ids; a route with no subject lists the rows its Work already keys. */
const rowsOf = (slot: SheetSlot, ctx: Ctx, field?: string): string[] => {
  const picked = field ? (ctx.page.read() as Record<string, { kind?: string; ids?: string[] }>)[field] : undefined;
  if (picked?.kind === "ids" && picked.ids) return picked.ids;
  const doc = (ctx.cells?.doc ?? {}) as Record<string, unknown>;
  return [...new Set(Object.entries(slot.bindings).flatMap(([name, b]) =>
    b.per === "subject" && !b.rows ? Object.keys((doc[name] ?? {}) as object) : []))];
};

/** Where a value stands when Work holds none: the layer and, for the firm file, which file. */
const layerWord = (cell: CalcCell) => (cell.ref ? `${cell.source} ${cell.ref}` : cell.source);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The row's subject, when its key is a SubjectRef code; a binding's own row key (a slot name) has none. */
const subjectRow = (row: string | undefined) => (row !== undefined && decode(row).ok ? (row as SubjectRefCode) : null);

function Cell({ ctx, cell }: { ctx: Ctx; cell: CalcCell }) {
  const mention = useMention();
  const subject = subjectRow(cell.row);
  const [draft, setDraft] = useState<{ value: unknown } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const schema = schemaOf(cell.domain);
  const domain = cell.domain;
  const optionInput = domain.kind === "options" ? (typeof domain.input === "function" ? domain.input(ctx.value.value) : domain.input) : null;
  if (domain.kind === "options" && ctx.target?.kind === "document") domain.handle.input.parse({ request: optionInput, target: ctx.target });
  const optionsReading = useFieldOptionsReading(ctx.target?.kind === "document" ? ctx.target.ref : null,
    typeof optionInput?.key === "string" ? optionInput.key : undefined, optionInput?.context ?? {});
  const options = pickerOptions(optionsReading);
  if (domain.kind === "options" && previousOf(optionsReading)) domain.handle.data.parse({ body: previousOf(optionsReading), version: null });
  const setting = cell.setting;
  const handle = (() => {
    if (!setting) {
      const workHandle = ctx.cells.at(bindingPath(cell.binding, cell.row));
      return { ...workHandle, stage: async (value: unknown, history?: { label: string }) => {
        const parsed = schema.safeParse(value);
        return parsed.success ? workHandle.stage(parsed.data, history) : { code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid value" };
      } };
    }
    return {
    owner: { route: setting.owner, label: "unsaved" }, value: draft ? { edit: { value: draft.value, by: "human" as const } } : {},
    refusal: null, transitions: () => [{ kind: "clear" as const, run: async () => { setDraft({ value: null }); return null; } }], clear: async () => { setDraft({ value: null }); return null; },
    stage: async (value: unknown) => {
      if (value === null) { setDraft({ value: null }); return null; }
      const parsed = schema.safeParse(value);
      if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Invalid value" };
      setDraft({ value: parsed.data }); return null;
    },
    };
  })();
  const save = async (tier: NonNullable<CalcCell["setting"]>["tiers"][number]) => {
    const value = draft?.value;
    if (!setting) return;
    if (value === undefined) return setSaid("Type a value or clear it before saving");
    setSaving(tier.tier);
    const failure = await ctx.cells.at(["setting", setting.owner, tier.tier, ...setting.path]).stage(value);
    setSaid(failure ? `Not saved: ${failure.message}` : `${value === null ? "Cleared" : "Saved"} at ${tier.tier}`);
    if (!failure) setDraft(null);
    setSaving(null);
  };
  const under = cell.source === "work" ? cell.model : cell.value;
  const field = cell.field;
  const choices = cell.choices && cell.value != null && !cell.choices.some(c => !c.clear && same(c.value ?? c.key, cell.value))
    ? [...cell.choices, { key: "standing", label: typeof cell.value === "string" ? cell.value : JSON.stringify(cell.value), value: cell.value, disabled: "not offered now" }]
    : cell.choices;
  return (
    <div {...mention(subject)} className="contents" data-sheet-cell={cell.label} data-sheet-address={cell.row === undefined ? cell.binding : `${cell.binding}:${cell.row}`} data-source={cell.source} data-drift={cell.drift || undefined}>
      <span className="min-w-0 truncate">{cell.label}</span>
      <span className="block min-w-0 h-(--item-h)">
        <StateCell
          cell={handle}
          value={ctx.value}
          label={cell.setting ? `${cell.label}: value to save` : cell.label}
          model={under}
          source={layerWord(cell)}
          scale="row"
          {...(cell.refusal || domain.kind === "options" && domain.mode === "constraint" ? { capReason: cell.refusal ?? "Choose an option from the list" } : {})}
          {...(cell.note ? { note: cell.note } : {})}
          {...(cell.unit ? { unit: { label: cell.unit } } : {})}
          {...(cell.numeric || field ? { numeric: cell.numeric ?? {} } : {})}
          {...(field ? {
            format: (v: unknown) => String((v as Record<string, unknown> | null)?.[field] ?? "—"),
            parse: (text: string) => ({ [field]: Number(text) }),
          } : cell.setting ? {
            parse: (text: string) => text.trim() === "" ? (schema.safeParse("").success ? "" : null) : cell.numeric ? Number(text) : text,
          } : {})}
          {...(choices ? {
            options: choices,
            // A cell that holds nothing shows its clear choice ("None") as current.
            current: choices.find((c) => !c.clear && same(c.value ?? c.key, cell.value))?.key
              ?? (cell.value == null ? choices.find((c) => c.clear)?.key : undefined) ?? null,
          } : {})}
        />
        {domain.kind === "options" ? <FieldOptionSelect items={options.items} value={typeof cell.value === "string" ? cell.value : undefined}
          placeholder={`${cell.label} options`} status={options.status} disabled={!!handle.refusal}
          onChange={option => void handle.stage(domain.persist === "label" ? option.label : option.value)} /> : null}
      </span>
      <span className="t-small min-w-0 truncate text-ink-2" data-input-source={cell.source}>{layerWord(cell)}{cell.setting && draft ? ` · saved ${cell.value ?? "—"}` : ""}</span>
      <span>{cell.setting?.tiers.map(tier => <Button key={tier.tier} kind="quiet"
        label={`Save ${cell.label} at the ${tier.tier} home`} busy={saving === tier.tier}
        {...(tier.home ? {} : { refusal: tier.notFound ?? `No ${tier.tier} home` })}
        onPress={() => void save(tier)}>{tier.tier}</Button>)}</span>
      {said ? <p role="status" className="col-span-full text-ink-2">{said}</p> : null}
    </div>
  );
}

export function SheetPane({ ctx: { draw: ctx, slot, field } }: { ctx: { draw: Ctx; slot: SheetSlot; field?: string } }) {
  const [typedOnly, setTypedOnly] = useState(false);
  const search = useRouteSearchSlice((s) => s);
  // A sheet over Work alone names no read: its pane has no value.
  const read = ctx.value?.value ?? undefined;
  const cells = sheetCells(slot, { rows: rowsOf(slot, ctx, field), work: ctx.cells?.doc ?? null, read });
  const shown = typedOnly ? typedCells(cells) : cells;
  const from = read !== undefined ? slot.from?.(read, search) : null;
  const empty = slot.empty?.(read ?? null);
  const said = read !== undefined ? slot.note?.(read) : null;
  const note = said ? <p role="note" className="min-w-0 text-ink-2" data-sheet-note="">{said}</p> : null;
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
            {shown.map(cell => <Cell key={`${cell.binding}:${cell.row ?? ""}`} ctx={ctx} cell={cell} />)}
          </div>
        )}
    </section>
  );
}
