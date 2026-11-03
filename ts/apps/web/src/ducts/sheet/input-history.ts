/** Sheet presentation on the kernel's in-memory Work journal; the route owns no undo stack. */
import { z } from "zod";
import { ductsSheetOverviewSchema } from "@pe/agent-contracts";
import type { DuctsSheetEdits, DuctsSheetOverview, RouteStatePatch } from "@pe/agent-contracts";
import type { ReadingState } from "#/shell/readings";
import type { WorkHistoryEntry } from "../../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { SheetReading } from "../sources";
import { CRITERION_WORDS } from "./criterion-words";

export type Totals = DuctsSheetOverview["totals"];

export const editMetaSchema = z.strictObject({
  label: z.string(),
  rowKey: z.string().nullable().optional(),
  clear: z.boolean().optional(),
  was: z.string().optional(),
  /** A numeric row may have no underlying source after clear; retain its identity in the journal. */
  row: z
    .object({
      label: z.string(),
      section: z.enum(["units", "terminals", "parts", "rulings"]),
      ids: z.array(z.number()),
    })
    .optional(),
});
export type EditMeta = z.infer<typeof editMetaSchema>;
export const inputHistoryMetaSchema = editMetaSchema.omit({ label: true }).extend({
  kind: z.literal("ducts-input"),
  effect: z.object({
    before: ductsSheetOverviewSchema.shape.totals,
    after: ductsSheetOverviewSchema.shape.totals.optional(),
  }),
});
type Readings = Readonly<Record<string, ReadingState>>;
const totals = (readings: Readings): Totals =>
  (readings.sheet?.value as SheetReading | undefined)?.open?.overview.totals ?? null;

export function describeInputHistory(before: Readings, detail: EditMeta, after?: Readings) {
  const { label, ...meta } = detail;
  return {
    label,
    meta: {
      ...meta,
      kind: "ducts-input",
      effect: { before: totals(before), ...(after && { after: totals(after) }) },
    },
  };
}

export function presentInputHistory(
  entries: readonly WorkHistoryEntry<z.output<typeof inputHistoryMetaSchema>>[],
  refusal: string | null,
) {
  const undo = entries.filter((entry) => entry.state === "applied").at(-1);
  const redo = entries.filter((entry) => entry.state === "undone").at(-1);
  const cleared = undo?.detail === "available" ? undo.meta : null;
  const last = redo ?? undo;
  return {
    undoLabel: undo ? undo.label : null,
    redoLabel: redo ? redo.label : null,
    undoSuperseded: null,
    redoSuperseded: null,
    cleared:
      undo && cleared?.clear
        ? {
            press: undo.press,
            rowKey: cleared.rowKey ?? null,
            was: cleared.was ?? undo.label,
            row: cleared.row ? { ...cleared.row, ids: [...cleared.row.ids] } : undefined,
          }
        : null,
    last: refusal
      ? { label: "restore", words: "", refusal }
      : last
        ? {
            label: `${last.state === "undone" ? "undid " : ""}${last.label}`,
            // Entries cannot distinguish a new forward edit from a redo. Never infer effect numbers.
            words: last.detail === "unavailable" ? "detail unavailable" : "",
          }
        : null,
  };
}

const at = (doc: unknown, path: readonly string[]) =>
  path.reduce<unknown>(
    (node, key) =>
      node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
    doc,
  );

export const cellsAt = (doc: unknown, cells: readonly string[][]): unknown[] =>
  cells.map((path) => {
    const value = at(doc, path);
    return value === undefined ? undefined : structuredClone(value);
  });

/** Patches that put each cell back as it was: a value where one existed, a delete where none did. */
export const restorePatches = (
  cells: readonly string[][],
  values: readonly unknown[],
): RouteStatePatch[] =>
  cells.map((path, i) =>
    values[i] === undefined ? { path: [...path] } : { path: [...path], value: values[i] },
  );

type Side = NonNullable<Totals>["supply"];
const side = (s: Side | undefined) =>
  !s
    ? "—"
    : s.complete && s.worstPath != null
      ? s.worstPath.toFixed(4)
      : `≥${s.knownInWg.toFixed(4)}`;
const esp = (t: Totals) => (t?.requiredEspInWg == null ? "—" : t.requiredEspInWg.toFixed(4));

/**
 * What an edit did to the open fan: each side's worst path (≥ marks a known subtotal of an
 * incomplete side) and required ESP, before → after, only where it moved.
 */
export function effectWords(before: Totals, after: Totals): string {
  const parts = [
    ["supply", side(before?.supply), side(after?.supply)],
    ["return", side(before?.return), side(after?.return)],
    ["required ESP", esp(before), esp(after)],
  ].filter(([, a, b]) => a !== b);
  return parts.length
    ? parts.map(([name, a, b]) => `${name} ${a} → ${b}`).join(" · ")
    : "no change to this fan's totals";
}

const NOUNS: Record<string, string> = {
  flows: "terminal airflow",
  terminalDrops: "terminal drop",
  componentDrops: "part drop",
  esp: "unit ESP",
  equipmentFlows: "unit airflow",
  roles: "unit role",
  kinds: "unit kind",
  tables: "table",
  assignments: "fitting rule",
  fittingDrops: "path drop",
};

/** A short name for an edit made outside the inputs list (a worksheet cell, a ledger closer). */
export function editLabel(edits: DuctsSheetEdits, nameOf: (id: number) => string | null): string {
  for (const [field, noun] of Object.entries(NOUNS)) {
    const record = (edits as Record<string, Record<string, unknown> | undefined>)[field];
    const [key, value] = Object.entries(record ?? {})[0] ?? [];
    if (key == null) continue;
    const name = /^\d+$/.test(key) ? (nameOf(Number(key)) ?? key) : key;
    return `${value === null ? "Revert " : ""}${noun} ${name}`;
  }
  if (edits.criteria)
    return `criteria ${Object.keys(edits.criteria)
      .map((key) => CRITERION_WORDS[key as keyof typeof CRITERION_WORDS] ?? key)
      .join(", ")}`;
  if (edits.joins?.length) return `join ${edits.joins[0]!.verdict}`;
  if (edits.ends?.length) return `end ${edits.ends[0]!.verdict}`;
  return "edit";
}
