import { z } from "zod";
import { canonicalRouteInput } from "./route-doc.ts";
import { type RouteStatePatch } from "./route-state.ts";

/*
 * One staged value per Work cell (ADR 0030 rule 8). The person and Pea write the same `edit`; the
 * host stamps `by`, `at` and `base`; the newest accepted write stands (last writer wins). There is
 * no suggestion lane: a Pea write is already the staged value, shown with its author. Undo is the
 * owner's Work journal restoring the earlier preimage, never a cleared value.
 *
 * Every route sets values, and an empty value is a value. Deleting the addressed property is
 * opt-in per route, kept only where a shipped consumer sets it (rulings 2026-09-18 16:00 #3): on a
 * route without it a delete rung is refused by the schema and has no type.
 */
const valueRung = <V extends z.ZodType>(value: V) =>
  z.object({ value, delete: z.never().optional() });
const deletableRung = <V extends z.ZodType>(value: V) =>
  z.object({ value: value.optional(), delete: z.literal(true).optional() });
const oneWrite = (rung: { value?: unknown; delete?: true }) =>
  (rung.delete === true) !== Object.hasOwn(rung, "value");
const ONE_WRITE = { error: "a rung sets a value or deletes the property: exactly one" };
const CHANGE_META = {
  by: z.enum(["human", "pea", "unknown"]).optional(),
  at: z.string().nullable().optional(),
  base: z.number().int().nonnegative().nullable().optional(),
  note: z.string().nullish(),
  confidence: z.enum(["high", "low"]).nullish(),
};
const valueCell = <V extends z.ZodType, E extends z.ZodRawShape>(value: V, extra: E) =>
  z
    .object({
      edit: valueRung(value)
        .extend(CHANGE_META)
        .extend(extra)
        .strict()
        .refine(oneWrite, ONE_WRITE)
        .nullish(),
    })
    .strict();
const deletableCell = <V extends z.ZodType, E extends z.ZodRawShape>(value: V, extra: E) =>
  z
    .object({
      edit: deletableRung(value)
        .extend(CHANGE_META)
        .extend(extra)
        .strict()
        .refine(oneWrite, ONE_WRITE)
        .nullish(),
    })
    .strict();

/** One staged edit; domain metadata (`extend`) may ride on it. */
export function draftCellSchema<V extends z.ZodType, E extends z.ZodRawShape = {}>(
  value: V,
  options?: { deletable?: false; extend?: E },
): ReturnType<typeof valueCell<V, E>>;
export function draftCellSchema<V extends z.ZodType, E extends z.ZodRawShape = {}>(
  value: V,
  options: { deletable: true; extend?: E },
): ReturnType<typeof deletableCell<V, E>>;
export function draftCellSchema(
  value: z.ZodType,
  { deletable = false, extend = {} }: { deletable?: boolean; extend?: z.ZodRawShape } = {},
) {
  return deletable ? deletableCell(value, extend) : valueCell(value, extend);
}

/** What a rung writes: a value, or the deletion of the addressed property. */
export interface Rung {
  value?: unknown;
  delete?: true;
}

export type Author = "human" | "pea" | "unknown";
export type Change = Rung & {
  by?: Author;
  at?: string | null;
  base?: number | null;
  note?: string | null;
  confidence?: "high" | "low" | null;
};
export interface CellLike {
  edit?: Change | null | undefined;
}

/**
 * Every way a cell changes. `set` and `clear` are any author's; `retire` is the host's alone, after
 * proven native success. A `set` equal to `baseline` stages nothing (the cell resolves to the model).
 * `baseline` omitted means the caller already diffed against its own baseline (Family's draft).
 */
export type CellWrite =
  | { kind: "set"; rung: Rung; baseline?: Rung }
  | { kind: "clear" }
  | { kind: "retire"; consumed: Rung };

/**
 * Whether two rungs write the same thing: canonical JSON of value and delete, never identity, and
 * never note or confidence. Absent on either side is not equal. Every reader compares rungs by this.
 */
export const sameValue = (a: Rung | null | undefined, b: Rung | null | undefined) =>
  a != null &&
  b != null &&
  canonicalRouteInput({ value: a.value, delete: a.delete === true }) ===
    canonicalRouteInput({ value: b.value, delete: b.delete === true });
const rungOf = (rung: Rung): Rung =>
  rung.delete === true ? { delete: true } : { value: rung.value };

/**
 * The only way anything writes a cell: the patch one write makes at `[...cellsPath, key, "edit"]`.
 * `retire` clears only the exact value the plan consumed; a later writer's value survives.
 */
export function cellPatches(
  cellsPath: readonly string[],
  key: string,
  cell: CellLike,
  write: CellWrite,
): RouteStatePatch[] {
  const edit = (value: unknown): RouteStatePatch[] => [{ path: [...cellsPath, key, "edit"], value }];
  switch (write.kind) {
    case "set":
      return edit(sameValue(write.rung, write.baseline) ? null : rungOf(write.rung));
    case "clear":
      return edit(null);
    case "retire":
      return sameValue(cell.edit, write.consumed) ? edit(null) : [];
  }
}

/**
 * An aggregate clear (header, row, group, a Chat count) is one write over many keys, so one refusal
 * covers every covered key. Keys with nothing staged or a lock are skipped with a reason.
 */
export function clearAll(
  cells: Record<string, CellLike>,
  keys: readonly string[],
  ctx: { cellsPath: readonly string[]; lockOf?: (key: string) => string | null },
): {
  patches: RouteStatePatch[];
  covered: string[];
  skipped: { key: string; reason: "locked" | "no-edit" }[];
} {
  const patches: RouteStatePatch[] = [];
  const covered: string[] = [];
  const skipped: { key: string; reason: "locked" | "no-edit" }[] = [];
  for (const key of keys) {
    const cell = cells[key] ?? {};
    if (cell.edit == null) skipped.push({ key, reason: "no-edit" });
    else if (ctx.lockOf?.(key)) skipped.push({ key, reason: "locked" });
    else {
      covered.push(key);
      patches.push(...cellPatches(ctx.cellsPath, key, cell, { kind: "clear" }));
    }
  }
  return { patches, covered, skipped };
}

export interface CellGroup {
  path: string[];
  /** Cells with a staged value. */
  staged: number;
  /** Staged cells whose last writer is Pea. */
  byPea: number;
  locked: number;
  /**
   * What the group stages: one value (and one baseline, when every baseline agrees), or how many
   * distinct values there are. Null when nothing unlocked is staged.
   */
  digest:
    | { single: { from?: unknown; to: unknown } }
    | { many: { count: number; examples: unknown[] } }
    | null;
}

// ponytail: three examples per group; widen when Chat's wording asks for more.
const EXAMPLES = 3;

/** Distinct values, by canonical JSON, in first-seen order. */
const distinct = (values: unknown[]) => [
  ...new Map(values.map((value) => [canonicalRouteInput(value), value])).values(),
];

/**
 * Chat-scale counts of staged cells, grouped by the route's own address path: the batch view of the
 * same cells the route draws in place. Unstaged cells are not counted; a deletion reads null.
 */
export function summarize(
  cells: Record<string, CellLike>,
  ctx: {
    groupOf: (key: string) => string[];
    baselineOf: (key: string) => unknown;
    lockOf?: (key: string) => string | null;
  },
): { groups: CellGroup[] } {
  type Tally = Omit<CellGroup, "digest"> & { to: unknown[]; from: unknown[] };
  const groups = new Map<string, Tally>();
  for (const [key, cell] of Object.entries(cells)) {
    if (cell.edit == null) continue;
    const path = ctx.groupOf(key);
    const id = JSON.stringify(path);
    let group = groups.get(id);
    if (!group) {
      group = { path, staged: 0, byPea: 0, locked: 0, to: [], from: [] };
      groups.set(id, group);
    }
    group.staged += 1;
    if (cell.edit.by === "pea") group.byPea += 1;
    if (ctx.lockOf?.(key)) group.locked += 1;
    else {
      group.to.push(cell.edit.delete === true ? null : cell.edit.value);
      group.from.push(ctx.baselineOf(key));
    }
  }
  return {
    groups: [...groups.values()].map(({ to, from, ...group }) => {
      const values = distinct(to);
      const baselines = distinct(from);
      return {
        ...group,
        digest: !values.length
          ? null
          : values.length === 1
            ? {
                single: {
                  ...(baselines.length === 1 && baselines[0] !== undefined
                    ? { from: baselines[0] }
                    : {}),
                  to: values[0],
                },
              }
            : { many: { count: values.length, examples: values.slice(0, EXAMPLES) } },
      };
    }),
  };
}

export function editedEntries<TCell extends CellLike>(
  cells: Record<string, TCell>,
): [string, TCell][] {
  return Object.entries(cells).filter(([, cell]) => cell.edit != null);
}
