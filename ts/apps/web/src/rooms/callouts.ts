/**
 * Numbered callouts for the rooms plan, placed in screen pixels: w16's search
 * (`.artifacts/runs/rails/w16/annotate.py`). Each pin tries its anchor, then rings of 3r, 5r, 8r,
 * 11r, 15r, 20r at eight compass offsets (scaled 0.8); the first box inside the viewport that
 * overlaps no earlier box wins. Earlier items win ties, so the caller's order is the priority.
 */
import type { Point2, Viewport2 } from "#/lib/affine-frame";

export interface CalloutItem {
  label: string;
  /** Where the region is, in screen px: the pin sits here when it can. */
  anchor: Point2;
  /** The words beside the pin (`{sqft} sf`, the held reason). */
  text: string;
  /** False when the polygon is too small to hold the pin: the pin always leaves on a leader. */
  fits: boolean;
}

export interface Callout {
  label: string;
  anchor: Point2;
  /** The pin's centre in screen px. */
  pin: Point2;
  /** True when the pin left its anchor and a leader line joins them. */
  leader: boolean;
  /** The pin's width in px: a circle for short labels, a pill for names. */
  pinWidth: number;
  /** The occupied box [minX, minY, maxX, maxY]: pin, gap and text. */
  box: readonly [number, number, number, number];
}

const RINGS = [0, 3, 5, 8, 11, 15, 20] as const;
const COMPASS = [
  [1, -1],
  [1, 1],
  [-1, -1],
  [-1, 1],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
] as const;
// ponytail: text width is estimated at 0.6 em per character, not measured in the DOM.
const CHAR_EM = 0.6;
/** The callout type size for a pin radius. */
export const calloutFont = (pinRadiusPx: number) => pinRadiusPx * 1.1;

const overlaps = (a: Callout["box"], b: Callout["box"]) =>
  !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

export function placeCallouts(
  items: readonly CalloutItem[],
  viewportPx: Viewport2,
  pinRadiusPx: number,
): Callout[] {
  const r = pinRadiusPx;
  const charPx = CHAR_EM * calloutFont(r);
  const placed: Callout[] = [];
  for (const item of items) {
    const [ax, ay] = item.anchor;
    if (ax < 0 || ay < 0 || ax > viewportPx.width || ay > viewportPx.height) continue;
    const pinWidth = Math.max(2 * r, item.label.length * charPx + r);
    const textWidth = item.text.length * charPx;
    const boxAt = (cx: number, cy: number) =>
      [
        cx - pinWidth / 2 - 4,
        cy - r - 4,
        cx + pinWidth / 2 + 8 + textWidth + 8,
        cy + r + 4,
      ] as const;
    let found: Callout | null = null;
    for (const ring of RINGS) {
      if (ring === 0 && !item.fits) continue;
      for (const [dx, dy] of COMPASS) {
        const cx = ax + dx * ring * r * 0.8;
        const cy = ay + dy * ring * r * 0.8;
        const box = boxAt(cx, cy);
        if (box[0] < 0 || box[1] < 0 || box[2] > viewportPx.width || box[3] > viewportPx.height)
          continue;
        if (placed.some((other) => overlaps(box, other.box))) continue;
        found = {
          label: item.label,
          anchor: item.anchor,
          pin: [cx, cy],
          leader: ring > 0,
          pinWidth,
          box,
        };
        break;
      }
      if (found) break;
    }
    // Nowhere free: the pin sits on its anchor over its neighbours, as w16 does.
    placed.push(
      found ?? {
        label: item.label,
        anchor: item.anchor,
        pin: item.anchor,
        leader: false,
        pinWidth,
        box: [ax, ay, ax, ay],
      },
    );
  }
  return placed;
}
