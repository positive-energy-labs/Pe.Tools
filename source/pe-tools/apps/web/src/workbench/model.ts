export type TailFollowState = "following" | "detached";

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

export const TAIL_THRESHOLD_PX = 240;

export function lensScrollIntent(turn?: number): LensScrollIntent {
  return typeof turn === "number" ? { kind: "turn", turn } : { kind: "tail" };
}

export function isNearTail(metrics: ScrollMetrics, threshold = TAIL_THRESHOLD_PX): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

export function tailFollowState(metrics: ScrollMetrics): TailFollowState {
  return isNearTail(metrics) ? "following" : "detached";
}

export function nextTailFollowState(
  current: TailFollowState,
  metrics: ScrollMetrics,
  previousScrollTop: number,
): TailFollowState {
  if (isNearTail(metrics)) return "following";
  if (current === "following" && metrics.scrollTop >= previousScrollTop) return "following";
  return "detached";
}

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
