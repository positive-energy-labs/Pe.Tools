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

/** A band's drawn box, and the doc → rail mapping every mark on the rail shares. */
export interface RailLayout {
  bands: Map<string, { top: number; height: number }>;
  /** Doc y → rail y, through the same inflated boxes the bands draw. */
  at: (y: number) => number;
  /** The stack's drawn height: under `rail` until the thread fills it. The rail centres in its
   *  lane, so a short thread is a short stack in the middle of the pane. */
  height: number;
}

/**
 * The rail as a scrollbar track: each band spans its moment plus the gap after it (the first also
 * takes the transcript's lead), so the bands tile the whole document with no dead runs. A band's
 * height is `bandHeight` of that span; once the stack outgrows `rail` every band shrinks by one
 * factor to fit. `at` is linear inside each band and continuous across them, so the thumb glides;
 * it only changes length as it crosses bands of different density.
 */
export function railLayout(geom: readonly Geom[], docHeight: number, rail: number): RailLayout {
  const spans = geom.map((g, i) => ({
    key: g.key,
    d0: i === 0 ? 0 : g.top,
    d1: geom[i + 1]?.top ?? Math.max(docHeight, g.top + g.height),
  }));
  const raw = spans.map((span) => bandHeight(span.d1 - span.d0));
  const total = raw.reduce((sum, h) => sum + h, 0);
  const fit = total > rail ? rail / total : 1;
  const segs: { d0: number; d1: number; p0: number; p1: number }[] = [];
  const bands = new Map<string, { top: number; height: number }>();
  let cursor = 0;
  spans.forEach((span, i) => {
    const height = raw[i]! * fit;
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
  return { bands, at, height: cursor };
}
