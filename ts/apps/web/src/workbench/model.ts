export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface FocalGeometry {
  key: string;
  turn: number;
  top: number;
  height: number;
}

export type LensScrollIntent = { kind: "turn"; turn: number } | { kind: "tail" };

export function scrollTopForIntent(
  intent: LensScrollIntent,
  geometry: FocalGeometry[],
  metrics: ScrollMetrics,
  focal = 0.6,
): number {
  const max = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (intent.kind === "tail") return max;

  // ponytail: unknown/deleted turns fall back to latest; add a missing-focus UI if users care.
  const item = geometry.find((entry) => entry.turn === intent.turn);
  if (!item) return max;
  return clamp(item.top - focal * metrics.clientHeight, 0, max);
}

export function turnAtFocalPoint(
  geometry: FocalGeometry[],
  metrics: ScrollMetrics,
  focal = 0.6,
): number | undefined {
  const focalTop = metrics.scrollTop + focal * metrics.clientHeight;
  let current: FocalGeometry | undefined;
  for (const entry of geometry) {
    if (entry.top <= focalTop && focalTop < entry.top + entry.height) return entry.turn;
    if (entry.top <= focalTop) current = entry;
  }
  return current?.turn;
}

/**
 * The position a reload reopens: the tail while the view sits at the bottom (within `slack` px),
 * so a reader following the newest turn comes back to the newest; else the turn on the focal axis.
 */
export function intentAt(
  geometry: FocalGeometry[],
  metrics: ScrollMetrics,
  focal = 0.6,
  slack = 24,
): LensScrollIntent | undefined {
  if (metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < slack)
    return { kind: "tail" };
  const turn = turnAtFocalPoint(geometry, metrics, focal);
  return turn === undefined ? undefined : { kind: "turn", turn };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
