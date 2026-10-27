import { z } from "zod";
import { canonicalRouteInput } from "./route-doc.ts";
import { isRecord, type RouteStatePatch } from "./route-state.ts";

const isRung = (value: unknown) =>
  isRecord(value) && (Object.hasOwn(value, "value") || value.delete === true);

/** Optional review changes, counted without interpreting their user-authored values. */
export function pendingSuggestions(doc: unknown): number {
  if (Array.isArray(doc))
    return doc.reduce<number>((sum, item) => sum + pendingSuggestions(item), 0);
  if (!isRecord(doc) || isRung(doc)) return 0;
  return Object.entries(doc).reduce(
    (sum, [key, value]) =>
      sum + (key === "suggestion" && isRung(value) ? 1 : pendingSuggestions(value)),
    0,
  );
}

/** One unfinished cell even when both its current edit and suggestion are occupied. */
export function unfinishedCells(doc: unknown): number {
  if (Array.isArray(doc)) return doc.reduce<number>((sum, item) => sum + unfinishedCells(item), 0);
  if (!isRecord(doc) || isRung(doc)) return 0;
  const own = isRung(doc.suggestion) || isRung(doc.edit) ? 1 : 0;
  return (
    own +
    Object.entries(doc).reduce(
      (sum, [key, value]) =>
        sum +
        ((key === "suggestion" || key === "edit") && isRung(value) ? 0 : unfinishedCells(value)),
      0,
    )
  );
}

/*
 * What a rung writes. Every route sets values, and an empty value is a value. Deleting the
 * addressed property is opt-in per route, kept only where a shipped consumer sets it (rulings
 * 2026-09-18 16:00 #3): on a route without it a delete rung is refused by the schema and has no type.
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
const valueCell = <V extends z.ZodType, E extends z.ZodRawShape>(value: V, extra: E) => {
  const rung = valueRung(value)
    .extend(CHANGE_META)
    .extend(extra)
    .strict()
    .refine(oneWrite, ONE_WRITE);
  return z.object({ suggestion: rung.nullish(), edit: rung.nullish() }).strict();
};
const deletableCell = <V extends z.ZodType, E extends z.ZodRawShape>(value: V, extra: E) => {
  const rung = deletableRung(value)
    .extend(CHANGE_META)
    .extend(extra)
    .strict()
    .refine(oneWrite, ONE_WRITE);
  return z.object({ suggestion: rung.nullish(), edit: rung.nullish() }).strict();
};

/** A shared edit and optional suggestion; domain metadata may extend either change. */
export function draftCellSchema<V extends z.ZodType, E extends z.ZodRawShape = {}>(
  value: V,
  options?: { deletable?: false; suggestion?: E },
): ReturnType<typeof valueCell<V, E>>;
export function draftCellSchema<V extends z.ZodType, E extends z.ZodRawShape = {}>(
  value: V,
  options: { deletable: true; suggestion?: E },
): ReturnType<typeof deletableCell<V, E>>;
export function draftCellSchema(
  value: z.ZodType,
  { deletable = false, suggestion = {} }: { deletable?: boolean; suggestion?: z.ZodRawShape } = {},
) {
  return deletable ? deletableCell(value, suggestion) : valueCell(value, suggestion);
}

/* ── the cell state machine (v3 FINAL) ─────────────────────────────────────── */

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
  suggestion?:
    | (Change & {
        note?: string | null | undefined;
        confidence?: "high" | "low" | null | undefined;
      })
    | null
    | undefined;
  edit?: Change | null | undefined;
}

export type Actor = "pea" | "human";

/** Every way a cell changes. `retire` is the host's alone, after proven native success. */
export const cellTransitions = {
  suggest: { binding: "unbound" },
  unsuggest: { binding: "unbound" },
  take: { binding: "bound" },
  set: { binding: "unbound" },
  clear: { binding: "unbound" },
  retire: { binding: "plan" },
} as const;
export type TransitionKind = keyof typeof cellTransitions;

export type Transition =
  | { kind: "suggest"; rung: Rung; note?: string | null; confidence?: "high" | "low" | null }
  | { kind: "unsuggest" | "take" | "clear" }
  /**
   * A value equal to `baseline` sets nothing. No emptiness rule: parsing is the consumer's codec.
   * `baseline` omitted means the caller already diffed against its own baseline (Family's draft).
   */
  | { kind: "set"; rung: Rung; baseline?: Rung }
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

/** A suggestion the person can still act on: present, and not already what is edit. */
const standing = (cell: CellLike) =>
  cell.suggestion != null && !sameValue(cell.suggestion, cell.edit);

export function availableTransitions(
  cell: CellLike,
  _actor: Actor,
  { lock }: { lock: string | null },
): TransitionKind[] {
  const open: Record<TransitionKind, boolean> = {
    suggest: !lock,
    unsuggest: cell.suggestion != null,
    take: standing(cell) && !lock,
    // Clearing review content does not mutate the external resource.

    set: !lock,
    clear: cell.edit != null && !lock,
    retire: false,
  };
  return (Object.keys(cellTransitions) as TransitionKind[]).filter((kind) => open[kind]);
}

/** Bound kinds carry the rendered Work revision; `retire` carries its exact plan binding. */
export const transitionBinding = (kind: TransitionKind) => cellTransitions[kind].binding;

/** The only way anything writes a cell: the rung patches one transition makes. */
export function transitionPatches(
  cellsPath: readonly string[],
  key: string,
  cell: CellLike,
  transition: Transition,
): RouteStatePatch[] {
  const at = (rung: "suggestion" | "edit", value: unknown): RouteStatePatch => ({
    path: [...cellsPath, key, rung],
    value,
  });
  switch (transition.kind) {
    case "suggest":
      return [
        at("suggestion", {
          ...rungOf(transition.rung),
          ...(transition.note != null ? { note: transition.note } : {}),
          ...(transition.confidence != null ? { confidence: transition.confidence } : {}),
        }),
      ];
    case "unsuggest":
      return [at("suggestion", null)];
    case "take":
      // The suggestion as the caller saw it; the bound write refuses if Work moved since.
      return cell.suggestion ? [at("edit", rungOf(cell.suggestion)), at("suggestion", null)] : [];
    case "set":
      return [
        at(
          "edit",
          sameValue(transition.rung, transition.baseline) ? null : rungOf(transition.rung),
        ),
      ];
    case "clear":
      return [at("edit", null)];
    case "retire":
      return [
        ...(sameValue(cell.edit, transition.consumed) ? [at("edit", null)] : []),
        ...(sameValue(cell.suggestion, transition.consumed) ? [at("suggestion", null)] : []),
      ];
  }
}

export type FanOutKind = "take" | "unsuggest" | "clear";
export type SkipReason = "actor" | "locked" | "contested" | "agreed" | "no-suggestion" | "no-edit";

function skipReason(
  cell: CellLike,
  kind: FanOutKind,
  _actor: Actor,
  lock: string | null,
): SkipReason | null {
  if (kind === "clear") return cell.edit == null ? "no-edit" : lock ? "locked" : null;
  if (cell.suggestion == null) return "no-suggestion";
  if (kind === "unsuggest") return null;
  if (!standing(cell)) return "agreed";
  if (lock) return "locked";
  return cell.edit != null ? "contested" : null;
}

/**
 * An aggregate control (header, row, group, "take all N", a Chat count) is only this: one kind
 * over many keys, as ONE write, so one refusal covers every covered key. Keys the kind is not open
 * on are skipped with a reason. An aggregate take also skips contested keys: it never overwrites
 * a value the person edit themselves (a single-cell take on one still lands).
 */
export function fanOut(
  cells: Record<string, CellLike>,
  keys: readonly string[],
  kind: FanOutKind,
  ctx: { cellsPath: readonly string[]; actor: Actor; lockOf?: (key: string) => string | null },
): {
  patches: RouteStatePatch[];
  covered: string[];
  skipped: { key: string; reason: SkipReason }[];
} {
  const patches: RouteStatePatch[] = [];
  const covered: string[] = [];
  const skipped: { key: string; reason: SkipReason }[] = [];
  for (const key of keys) {
    const cell = cells[key] ?? {};
    const reason = skipReason(cell, kind, ctx.actor, ctx.lockOf?.(key) ?? null);
    if (reason) skipped.push({ key, reason });
    else {
      covered.push(key);
      patches.push(...transitionPatches(ctx.cellsPath, key, cell, { kind }));
    }
  }
  return { patches, covered, skipped };
}

export interface CellGroup {
  path: string[];
  /** Standing suggestions with nothing edit: what the group's take or unsuggest acts on. */
  proposed: number;
  /** Cells with a edit value, contested ones included. */
  staged: number;
  /** Staged cells a different, standing suggestion argues with (a subset of `edit`). */
  contested: number;
  locked: number;
  /** Cells with something pending. */
  span: number;
  /**
   * What the group's take would set, over its standing, uncontested, unlocked suggestions only:
   * one value (and one baseline, when every baseline agrees), or how many distinct values there
   * are. Null when no such suggestion stands.
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
 * Chat-scale counts, grouped by the route's own address path. Chat shows these and drills into the
 * route; it never lists cells. Cells with nothing pending are not counted; a deletion reads null.
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
    if (cell.suggestion == null && cell.edit == null) continue;
    const path = ctx.groupOf(key);
    const id = JSON.stringify(path);
    let group = groups.get(id);
    if (!group) {
      group = { path, proposed: 0, staged: 0, contested: 0, locked: 0, span: 0, to: [], from: [] };
      groups.set(id, group);
    }
    const open = standing(cell);
    const locked = Boolean(ctx.lockOf?.(key));
    group.span += 1;
    if (locked) group.locked += 1;
    if (cell.edit != null) {
      group.staged += 1;
      if (open) group.contested += 1;
    } else if (open) {
      group.proposed += 1;
      if (!locked) {
        group.to.push(cell.suggestion!.delete === true ? null : cell.suggestion!.value);
        group.from.push(ctx.baselineOf(key));
      }
    }
  }
  return {
    groups: [...groups.values()]
      .filter((group) => group.proposed + group.staged + group.contested + group.locked > 0)
      .map(({ to, from, ...group }) => {
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
