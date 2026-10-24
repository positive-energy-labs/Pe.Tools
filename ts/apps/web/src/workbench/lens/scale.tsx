export const FOCAL = 0.5;
/** A band's height grows with the log of its turn's length: a one-liner still reads as a block,
 *  and a wall of output stops at `MAX_BAND` instead of eating the rail. */
const MIN_BAND = 3;
const MAX_BAND = 24;
/** Rail px per doubling of a turn's length, counted in 40px steps of transcript (two lines). */
const LOG_STEP = 2.5;
const LINE_PX = 40;

function bandHeight(docPx: number): number {
  return Math.min(MAX_BAND, MIN_BAND + LOG_STEP * Math.log2(1 + Math.max(0, docPx) / LINE_PX));
}

/*
 * TEMPORARY — protoui round (wave 10, 2026-10-24), pending kaitpw's pick. `today` is the shipped
 * rule; the rest are the lineup behind `?lens=` / Alt+L. The winner gets rewritten to canon and the
 * losers deleted, with this comment.
 *   today  — the log rule above, then shrunk by one factor if the stack outgrows the rail.
 *   share  — each slot is its turn's share of the transcript's height, 2px floor.
 *   floor  — the same share, `SLOT_FLOOR` floor; the rest is distributed by height.
 *   sqrt   — distributed by the square root of the turn's height, `SLOT_FLOOR` floor.
 *   blocks — distributed by the turn's rendered block count, `SLOT_FLOOR` floor.
 *   marks  — `sqrt` sizing; inside each slot a page-coloured notch at every rendered block's top.
 */
export const LENS_VARIANTS = ["today", "share", "floor", "sqrt", "blocks", "marks"] as const;
export type LensVariant = (typeof LENS_VARIANTS)[number];

/** The readable, pressable slot: `--gutter` (8px) from the space ladder, which is the bar's 2px gap
 *  plus 6px of ink, the peek's tick hit (peek.tsx HIT) inside one slot. */
export const SLOT_FLOOR = 8;
/** Px between notches below which they thin out: a 1px notch and two of bar. */
const NOTCH_SPACING = 3;

export interface Geom {
  key: string;
  turn: number;
  top: number;
  height: number;
  /** Doc y of each rendered block's top inside the turn, in order. A collapsed tool run is one
   *  block, as the transcript draws it. The first is the turn's own top. */
  blocks: number[];
}

export interface Moment {
  id: string;
  turn: number;
  role: "user" | "assistant" | "system";
  createdAt?: Date;
  /** The turn's opening text, clipped, shown beside its band on hover. */
  preview?: string;
}

/** A band's drawn box, and the doc → rail mapping every mark on the rail shares. */
export interface RailLayout {
  bands: Map<string, { top: number; height: number }>;
  /** Doc y → rail y, through the same inflated boxes the bands draw. */
  at: (y: number) => number;
  /** Rail y → doc y: the inverse of `at`, for a scrub. */
  inv: (y: number) => number;
  /** Per band, the notch offsets (band-relative rail y) at rendered block tops; only `marks`. */
  notches: Map<string, number[]>;
  /** The stack's drawn height: under `rail` until the thread fills it. The rail centres in its
   *  lane, so a short thread is a short stack in the middle of the pane. */
  height: number;
}

/**
 * Distribute `rail` over slots in proportion to `weights`, no slot under `floor`. A slot whose
 * share falls under the floor is pinned there and the rest is re-shared among the others, until
 * every free slot clears the floor. More slots than the floor allows: every slot gets `rail / n`.
 */
export function fill(weights: readonly number[], rail: number, floor: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const f = Math.min(floor, rail / n);
  const heights = new Array<number>(n).fill(f);
  const pinned = new Set<number>();
  for (;;) {
    const free = weights.map((_, i) => i).filter((i) => !pinned.has(i));
    if (free.length === 0) break;
    const budget = rail - f * pinned.size;
    const sum = free.reduce((s, i) => s + weights[i]!, 0);
    let changed = false;
    for (const i of free) {
      const share = sum > 0 ? (budget * weights[i]!) / sum : budget / free.length;
      if (share < f) {
        pinned.add(i);
        changed = true;
      } else heights[i] = share;
    }
    if (!changed) break;
  }
  return heights;
}

/** Notch offsets inside one band: every block top after the first, in order, dropping any that would
 *  sit closer than `NOTCH_SPACING` to the one kept before it, or on the slot's edge. A kept notch
 *  then stands for itself and the crowded blocks right behind it, never for nothing. */
export function notchesFor(ys: readonly number[], height: number): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (const raw of ys) {
    const y = Math.floor(raw);
    if (y < 1 || y > height - 2 || y - last < NOTCH_SPACING) continue;
    out.push(y);
    last = y;
  }
  return out;
}

/**
 * The rail as a scrollbar track: each band spans its moment plus the gap after it (the first also
 * takes the transcript's lead), so the bands tile the whole document with no dead runs. The
 * variant picks each band's height from its span; `at` is linear inside each band and continuous
 * across them, so the thumb glides; it only changes length as it crosses bands of different density.
 */
export function railLayout(
  geom: readonly Geom[],
  docHeight: number,
  rail: number,
  variant: LensVariant = "today",
): RailLayout {
  const spans = geom.map((g, i) => ({
    key: g.key,
    d0: i === 0 ? 0 : g.top,
    d1: geom[i + 1]?.top ?? Math.max(docHeight, g.top + g.height),
  }));
  const px = spans.map((span) => Math.max(0, span.d1 - span.d0));
  let heights: number[];
  if (variant === "today") {
    const raw = px.map(bandHeight);
    const total = raw.reduce((sum, h) => sum + h, 0);
    const fit = total > rail ? rail / total : 1;
    heights = raw.map((h) => h * fit);
  } else if (variant === "share") heights = fill(px, rail, 2);
  else if (variant === "floor") heights = fill(px, rail, SLOT_FLOOR);
  else if (variant === "blocks")
    heights = fill(
      geom.map((g) => Math.max(1, g.blocks.length)),
      rail,
      SLOT_FLOOR,
    );
  else heights = fill(px.map(Math.sqrt), rail, SLOT_FLOOR);

  const segs: { d0: number; d1: number; p0: number; p1: number }[] = [];
  const bands = new Map<string, { top: number; height: number }>();
  let cursor = 0;
  spans.forEach((span, i) => {
    const height = heights[i]!;
    bands.set(span.key, { top: cursor, height });
    segs.push({ ...span, p0: cursor, p1: cursor + height });
    cursor += height;
  });
  const at = (y: number) => {
    for (const s of segs)
      if (y <= s.d1)
        return (
          s.p0 + Math.min(1, Math.max(0, (y - s.d0) / Math.max(1, s.d1 - s.d0))) * (s.p1 - s.p0)
        );
    return cursor;
  };
  const inv = (y: number) => {
    for (const s of segs)
      if (y <= s.p1)
        return (
          s.d0 + Math.min(1, Math.max(0, (y - s.p0) / Math.max(1e-9, s.p1 - s.p0))) * (s.d1 - s.d0)
        );
    return segs.at(-1)?.d1 ?? 0;
  };
  const notches = new Map<string, number[]>();
  if (variant === "marks")
    geom.forEach((g, i) => {
      const box = bands.get(g.key)!;
      const ys = g.blocks.slice(1).map((b) => at(b) - box.top);
      notches.set(g.key, notchesFor(ys, segs[i]!.p1 - segs[i]!.p0));
    });
  return { bands, at, inv, notches, height: cursor };
}
