/**
 * Undo and redo for sheet input edits (kaitpw 2026-10-30: "strong distrust for whether i'd be able
 * to redo from scratch what i had just undone"). Work keeps no history: the host stores one
 * envelope, and the composer's only revert clears every edit. So the page keeps its own: before an
 * edit it snapshots the exact Work cells the edit writes (`editCells`, absence included), undo
 * writes them back through the route's Work writer (revision-bound, so a stale page is refused,
 * never merged), and redo sends the same edits again. Each step keeps the open fan's totals
 * before and after, so every edit says what it did to the numbers.
 * The history lives in this page; a reload starts it empty, and the words say so.
 */
import type { DuctsSheetEdits, DuctsSheetOverview, RouteStatePatch } from "@pe/agent-contracts";

export type Totals = DuctsSheetOverview["totals"];

export type Step = {
  label: string;
  /** The input row or fitting group the edit came from; it offers "restore" while this step is last. */
  rowKey: string | null;
  /** A clear: the row returned to its source underneath. */
  clear: boolean;
  edits: DuctsSheetEdits;
  /** A step written straight to Work (take or unsuggest of a Pea suggestion): redo writes these again. */
  patches?: RouteStatePatch[];
  cells: string[][];
  /** Each cell as it was before the edit; undefined where the cell did not exist. */
  before: unknown[];
  /** What the row showed before (for a cleared row that leaves the list, the restore line names it). */
  was: string;
  effect: { before: Totals; after: Totals } | null;
};

const at = (doc: unknown, path: readonly string[]) =>
  path.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
    doc,
  );

export const cellsAt = (doc: unknown, cells: readonly string[][]): unknown[] =>
  cells.map((path) => {
    const value = at(doc, path);
    return value === undefined ? undefined : structuredClone(value);
  });

/** Patches that put each cell back as it was: a value where one existed, a delete where none did. */
export const restorePatches = (cells: readonly string[][], values: readonly unknown[]): RouteStatePatch[] =>
  cells.map((path, i) => (values[i] === undefined ? { path: [...path] } : { path: [...path], value: values[i] }));

type Side = NonNullable<Totals>["supply"];
const side = (s: Side | undefined) =>
  !s ? "—" : s.complete && s.worstPath != null ? s.worstPath.toFixed(4) : `≥${s.knownInWg.toFixed(4)}`;
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
