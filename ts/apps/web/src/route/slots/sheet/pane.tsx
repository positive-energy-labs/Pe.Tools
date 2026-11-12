import { useState, type ReactNode } from "react";
import { decode, type SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import type { SheetSlot } from "@pe/agent-contracts/slots";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { callHostRpc } from "#/host/client";
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
 * over the `finding` command the mount gives every route (shell/typed-mount.ts); without Work it is refused.
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

/**
 * A `setting` cell (ADR 0037 rule 8): the value, the tier that served it, and "save at" for each
 * declared tier. A save goes straight to that home's file through the host's write door; it never
 * stages in Work, and a tier whose home was not found is refused with where the host looked.
 * Re-openable default (homes MAP decision log, 2026-11-12): one typed value, one button per tier.
 */
function SettingCell({ ctx, cell, schema }: { ctx: Ctx; cell: SheetCell; schema: SheetSlot["bindings"][string]["schema"] }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const target = ctx.target?.kind === "document" ? ctx.target.ref : null;
  const save = async (tier: NonNullable<SheetCell["setting"]>["tiers"][number]) => {
    const typed = text.trim();
    const value = typed === "" ? null : cell.numeric || typeof cell.value === "number" ? Number(typed) : typed;
    const parsed = value === null ? null : schema.safeParse(value);
    if (parsed && !parsed.success) return setSaid(`Not saved: ${parsed.error.issues[0]?.message ?? "the value is not valid"}`);
    setBusy(tier.tier);
    try {
      const wrote = await callHostRpc(
        "settings.tiers.write",
        { owner: cell.setting!.owner, tier: tier.tier, path: [...cell.setting!.path] as [string, ...string[]], value: parsed ? parsed.data : null, expectedSha256: tier.sha256 },
        target ? { bridgeSessionId: target.session, openDocumentId: target.openId } : {},
      );
      setSaid(`${value === null ? "Cleared" : "Saved"} at ${wrote.tier}: ${wrote.path}`);
      setText("");
      ctx.refresh();
    } catch (error) {
      setSaid(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="contents" data-sheet-cell={cell.label} data-sheet-address={cell.binding} data-source={cell.source}>
      <span className="min-w-0 truncate">{cell.label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">{cell.value == null ? "\u2014" : String(cell.value)}{cell.unit ? ` ${cell.unit}` : ""}</span>
        <Input aria-label={`${cell.label}: value to save`} value={text} placeholder="save at" onChange={(event) => setText(event.target.value)} />
      </span>
      <span className="t-small min-w-0 truncate text-ink-2" data-input-source={cell.source}>{[layerWord(cell), cell.note].filter(Boolean).join(" \u00b7 ")}</span>
      <span className="flex gap-1">
        {cell.setting!.tiers.map((tier) => (
          <Button key={tier.tier} kind="quiet" label={`Save ${cell.label} at the ${tier.tier} home${text.trim() ? "" : " (empty clears it there)"}`}
            busy={busy === tier.tier} {...(tier.home ? {} : { refusal: tier.notFound ?? `No ${tier.tier} home` })} onPress={() => void save(tier)}>
            {tier.tier}
          </Button>
        ))}
      </span>
      {said ? <p role="status" className="col-span-full min-w-0 text-ink-2">{said}</p> : null}
    </div>
  );
}

export function SheetPane({ ctx: { draw: ctx, slot, field } }: { ctx: { draw: Ctx; slot: SheetSlot; field?: string } }) {
  const [typedOnly, setTypedOnly] = useState(false);
  const search = useRouteSearchSlice((s) => s);
  const read = ctx.value.value ?? undefined;
  const cells = sheetCells(slot, { rows: rowsOf(slot, ctx, field), work: ctx.cells?.doc ?? null, model: [], read });
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
            {shown.map((cell) => cell.setting
              ? <SettingCell key={cell.binding} ctx={ctx} cell={cell} schema={slot.bindings[cell.binding]!.schema} />
              : <Cell key={`${cell.binding}:${cell.row ?? ""}`} ctx={ctx} cell={cell} verb={verbOf(cell)} />)}
          </div>
        )}
    </section>
  );
}
