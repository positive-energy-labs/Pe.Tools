/**
 * The projection scrollbar's pure core: spans in scroller pixels → one bin per device pixel row
 * of the strip → fills on a canvas. No DOM per item, so 10k spans cost what 10k loop steps cost.
 * Channels and their aggregation (the kit owns both; a route only supplies the mark):
 *   tone      worst per bin (alarm > caution), full width, at least 2 device px tall
 *   weight    sum per bin, normalised to the densest bin, one ink ramp
 *   tick      any per bin, a 1 px hairline at the span top, inline-start half
 *   hit       any per bin, a 2 px bar on the inline-start edge
 *   selected  any per bin, a 2 px full-width ink bar
 */
export type Tone = "alarm" | "caution";
export interface Mark {
  tone?: Tone | null;
  weight?: number;
  tick?: boolean;
  hit?: boolean;
  selected?: boolean;
}
export interface Span {
  top: number;
  height: number;
  mark: Mark;
}
export interface Bins {
  length: number;
  tone: Uint8Array;
  weight: Float32Array;
  max: number;
  tick: Uint8Array;
  hit: Uint8Array;
  selected: Uint8Array;
}

const TONE_PX = 2;

export function project(spans: Iterable<Span>, fieldHeight: number, bins: number): Bins {
  const n = Math.max(1, bins | 0);
  const k = fieldHeight > 0 ? n / fieldHeight : 0;
  const out: Bins = {
    length: n,
    tone: new Uint8Array(n),
    weight: new Float32Array(n),
    max: 0,
    tick: new Uint8Array(n),
    hit: new Uint8Array(n),
    selected: new Uint8Array(n),
  };
  const clamp = (p: number) => (p < 0 ? 0 : p >= n ? n - 1 : p);
  for (const { top, height, mark } of spans) {
    const a = clamp(Math.floor(top * k));
    const b = clamp(Math.max(a, Math.ceil((top + height) * k) - 1));
    const tone = mark.tone === "alarm" ? 2 : mark.tone === "caution" ? 1 : 0;
    const weight = (mark.weight ?? 0) / (b - a + 1);
    for (let p = a; p <= b; p++) {
      if (weight) {
        out.weight[p]! += weight;
        if (out.weight[p]! > out.max) out.max = out.weight[p]!;
      }
      if (mark.selected) out.selected[p] = 1;
      if (mark.hit) out.hit[p] = 1;
    }
    if (tone)
      for (let p = a; p <= Math.max(b, clamp(a + TONE_PX - 1)); p++)
        if (tone > out.tone[p]!) out.tone[p] = tone;
    if (mark.tick) out.tick[a] = 1;
  }
  return out;
}

export interface Ink {
  alarm: string;
  caution: string;
  ink: string;
  line: string;
}

/** One fillRect per run of equal bins, per channel; weight is quantised to 16 alpha steps. */
export function paint(ctx: CanvasRenderingContext2D, bins: Bins, width: number, ink: Ink) {
  const n = bins.length;
  ctx.clearRect(0, 0, width, n);
  const runs = (
    value: (p: number) => number,
    draw: (from: number, to: number, v: number) => void,
  ) => {
    let from = 0;
    let current = value(0);
    for (let p = 1; p <= n; p++) {
      const next = p < n ? value(p) : -1;
      if (next !== current) {
        if (current) draw(from, p, current);
        from = p;
        current = next;
      }
    }
  };
  const alpha = (step: number) => 0.1 + (0.45 * step) / 16;
  ctx.fillStyle = ink.ink;
  runs(
    (p) => (bins.max ? Math.round((16 * bins.weight[p]!) / bins.max) : 0),
    (from, to, step) => {
      ctx.globalAlpha = alpha(step);
      ctx.fillRect(0, from, width, to - from);
    },
  );
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink.line;
  runs(
    (p) => bins.tick[p]!,
    (from, to) => ctx.fillRect(0, from, width / 2, to - from),
  );
  ctx.fillStyle = ink.ink;
  runs(
    (p) => bins.hit[p]!,
    (from, to) => ctx.fillRect(0, from, Math.max(2, width / 4), to - from),
  );
  runs(
    (p) => bins.selected[p]!,
    (from, to) => ctx.fillRect(0, from, width, to - from),
  );
  runs(
    (p) => bins.tone[p]!,
    (from, to, tone) => {
      ctx.fillStyle = tone === 2 ? ink.alarm : ink.caution;
      ctx.fillRect(0, from, width, to - from);
    },
  );
}
