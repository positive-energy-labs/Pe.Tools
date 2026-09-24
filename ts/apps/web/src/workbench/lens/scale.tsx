import { type ToolCall } from "../chat-state";

/** Document px → dial px. Lower = the whole thread packs into less rail. */
export const SCALE = 0.045;
export const FOCAL = 0.5;
/** A band never draws thinner than this, so a one-line turn still reads as a block. */
export const MIN_BAND = 8;
export const HEAD_H = 40;

export interface Geom {
  key: string;
  turn: number;
  top: number;
  height: number;
}

export interface Moment {
  id: string;
  turn: number;
  role: "user" | "assistant" | "system";
  createdAt?: Date;
  /** The turn's opening text, clipped, shown beside its band on hover. */
  preview?: string;
}

export interface TraceCell {
  key: string;
  call: ToolCall;
  parentId?: string;
}

/** A band's drawn box, and the doc → rail mapping every mark on the rail shares. */
export interface RailLayout {
  bands: Map<string, { top: number; height: number }>;
  /** Doc y → rail y, through the same inflated boxes the bands draw. */
  at: (y: number) => number;
}

/**
 * The rail as a fitted map: each turn's band is its proportional height, but never under
 * `MIN_BAND` (shrunk when there are too many turns to fit), stacked in order. The window, caret
 * and bands all map through `at`, so the window covers exactly the bands on screen.
 */
export function railLayout(geom: readonly Geom[], docHeight: number, rail: number): RailLayout {
  const min = Math.min(MIN_BAND, rail / Math.max(1, geom.length));
  const total = (k: number) => {
    let end = 0;
    let sum = 0;
    for (const g of geom) {
      sum += Math.max(0, g.top - end) * k + Math.max(min, g.height * k);
      end = g.top + g.height;
    }
    return sum + Math.max(0, docHeight - end) * k;
  };
  // The largest k (≤ SCALE) whose inflated stack fits the rail; total grows with k.
  let lo = 0;
  let hi = SCALE;
  if (total(hi) > rail)
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (total(mid) > rail) hi = mid;
      else lo = mid;
    }
  else lo = hi;
  const k = lo;
  const segs: { d0: number; d1: number; p0: number; p1: number }[] = [];
  const bands = new Map<string, { top: number; height: number }>();
  let cursor = 0;
  let end = 0;
  for (const g of geom) {
    cursor += Math.max(0, g.top - end) * k;
    const height = Math.max(min, g.height * k);
    bands.set(g.key, { top: cursor, height });
    segs.push({ d0: g.top, d1: g.top + g.height, p0: cursor, p1: cursor + height });
    cursor += height;
    end = g.top + g.height;
  }
  const at = (y: number) => {
    let prev = { d1: 0, p1: 0 };
    for (const s of segs) {
      if (y < s.d0) return prev.p1 + (y - prev.d1) * k;
      if (y <= s.d1) return s.p0 + ((y - s.d0) / Math.max(1, s.d1 - s.d0)) * (s.p1 - s.p0);
      prev = s;
    }
    return prev.p1 + (y - prev.d1) * k;
  };
  return { bands, at };
}
