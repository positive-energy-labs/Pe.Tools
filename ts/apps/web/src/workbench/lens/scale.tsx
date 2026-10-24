export const FOCAL = 0.5;
/** Slot height follows turn height to this power: 1 is the plain share, above 1 a long turn outgrows
 *  its share and a short one sinks to the floor. kaitpw's pick (2026-10-24); tune it here only. */
export const SLOT_POWER = 1.5;
/** The readable, pressable slot: `--gutter` (8px) from the space ladder, which is the bar's 2px gap
 *  plus 6px of ink, the peek's tick hit (peek.tsx HIT) inside one slot. */
export const SLOT_FLOOR = 8;
/** The tallest slot: `--rail-h` (40px), the ladder's rung above the old 24px (`--control-h`) cap.
 *  It caps the scale, not each slot, so a short thread is a short stack still in proportion, and a
 *  long one fills the rail with every slot under it. */
export const SLOT_CAP = 40;
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
  /** Per band, the notch offsets (band-relative rail y) at rendered block tops. */
  notches: Map<string, number[]>;
  /** The stack's drawn height: under `rail` until the thread fills it. The rail centres in its
   *  lane, so a short thread is a short stack in the middle of the pane. */
  height: number;
}

/**
 * Each slot is `max(floor, k · px^SLOT_POWER)`, with the one scale `k` as large as the rail allows
 * but never past the point where the tallest slot reaches `SLOT_CAP`. The sum never exceeds `rail`;
 * more slots than the floor allows get `rail / n` each.
 */
export function slotHeights(px: readonly number[], rail: number): number[] {
  if (px.length === 0) return [];
  const w = px.map((p) => Math.max(0, p) ** SLOT_POWER);
  const floor = Math.min(SLOT_FLOOR, rail / px.length);
  const total = (k: number) => w.reduce((sum, x) => sum + Math.max(floor, k * x), 0);
  const top = Math.max(...w);
  let lo = 0;
  let hi = top > 0 ? SLOT_CAP / top : 0;
  if (total(hi) <= rail) lo = hi;
  else
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (total(mid) <= rail) lo = mid;
      else hi = mid;
    }
  return w.map((x) => Math.max(floor, lo * x));
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
 * takes the transcript's lead), so the bands tile the whole document with no dead runs. Each band's
 * height comes from its span (`slotHeights`); `at` is linear inside each band and continuous
 * across them, so the thumb glides; it only changes length as it crosses bands of different density.
 */
export function railLayout(geom: readonly Geom[], docHeight: number, rail: number): RailLayout {
  const spans = geom.map((g, i) => ({
    key: g.key,
    d0: i === 0 ? 0 : g.top,
    d1: geom[i + 1]?.top ?? Math.max(docHeight, g.top + g.height),
  }));
  const heights = slotHeights(
    spans.map((span) => span.d1 - span.d0),
    rail,
  );

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
  geom.forEach((g, i) => {
    const box = bands.get(g.key)!;
    const ys = g.blocks.slice(1).map((b) => at(b) - box.top);
    notches.set(g.key, notchesFor(ys, segs[i]!.p1 - segs[i]!.p0));
  });
  return { bands, at, inv, notches, height: cursor };
}
