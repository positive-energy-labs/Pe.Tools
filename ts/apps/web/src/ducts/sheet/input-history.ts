/** Sheet presentation on the kernel's in-memory Work journal; the route owns no undo stack. */
import { z } from "zod";
import { ductsSheetOverviewSchema } from "@pe/agent-contracts";
import type { DuctsSheetEdits, DuctsSheetOverview, RouteStatePatch } from "@pe/agent-contracts";
import type { ReadingState } from "#/shell/readings";
import type { WorkJournal } from "#/shell/journal";
import type { SheetReading } from "../sources";

export type Totals = DuctsSheetOverview["totals"];

export const editMetaSchema = z.strictObject({
  label: z.string(),
  rowKey: z.string().nullable().optional(),
  clear: z.boolean().optional(),
  was: z.string().optional(),
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
  journal: ReturnType<WorkJournal["read"]> | null,
  refusal: string | null,
) {
  const undo = journal?.undo.at(-1);
  const redo = journal?.redo.at(-1);
  const cleared = inputHistoryMetaSchema.safeParse(undo?.meta);
  const last = journal?.last;
  const meta = inputHistoryMetaSchema.safeParse(last?.step.meta);
  const effect = meta.success ? meta.data.effect : null;
  return {
    undoLabel: undo ? (undo.label ?? "input edit") : null,
    redoLabel: redo ? (redo.label ?? "input edit") : null,
    cleared:
      undo && cleared.success && cleared.data.clear
        ? {
            press: undo.press,
            rowKey: cleared.data.rowKey ?? null,
            was: cleared.data.was ?? undo.label ?? "input",
          }
        : null,
    last: refusal
      ? { label: "restore", words: "", refusal }
      : last && (effect || last.step.label)
        ? {
            label: `${last.kind === "undo" ? "undid " : last.kind === "redo" ? "redid " : ""}${last.step.label}`,
            words: !effect
              ? ""
              : effect.after === undefined
                ? "Waiting for this fan's totals"
                : last.kind === "undo"
                  ? effectWords(effect.after, effect.before)
                  : effectWords(effect.before, effect.after),
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
    return `${value === null ? "clear " : ""}${noun} ${name}`;
  }
  if (edits.criteria) return `criteria ${Object.keys(edits.criteria).join(", ")}`;
  if (edits.joins?.length) return `join ${edits.joins[0]!.verdict}`;
  if (edits.ends?.length) return `end ${edits.ends[0]!.verdict}`;
  return "edit";
}
