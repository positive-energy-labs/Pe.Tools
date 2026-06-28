import type {
  WorkbenchContextBreakdown,
  WorkbenchContextItem,
  WorkbenchContextSegment,
} from "@pe/agent-contracts";

/**
 * Pure cache-position logic for the World inspector — no JSX, so it's unit-testable.
 *
 * Request order is `tools → system → messages`, the same order that drives prompt-cache
 * reuse. Cache state is a FRONTEND inference: we diff this send's breakdown against the
 * previous send's and mark the highest layer that changed as the "cache horizon" —
 * everything from there down was reprocessed, everything above stayed cache-warm. The
 * provider only returns aggregate cache token counts, never a per-layer split, so this is
 * approximate by nature (surfaced with an "≈" marker, never as ground truth).
 */

// Lower rank = closer to the front of the request = more cache-volatile. A change at rank r
// busts r and everything below it (higher rank). Memory is treated as system-adjacent.
export const REQUEST_RANK: Record<string, number> = {
  tools: 0,
  "system-prompt": 1,
  skills: 1,
  memory: 1,
  messages: 2,
  free: 9,
};

export function rankOf(id: string): number {
  return REQUEST_RANK[id] ?? 1;
}

export type CacheState = "cached" | "reprocessed" | "unknown";

export interface CacheView {
  hasBaseline: boolean;
  changed: Set<string>;
  /** Topmost (lowest) rank that changed this send; null if nothing changed / no baseline. */
  horizonRank: number | null;
  stateOf: (id: string) => CacheState;
}

/** Signature that changes whenever a layer's bytes change — tokens + named contents. */
export function segSignature(segment: WorkbenchContextSegment): string {
  const items = (segment.items ?? []).map((item) => `${item.name}:${item.tokens ?? ""}`).join("~");
  return `${Math.round(segment.tokens)}|${items}`;
}

export function signatureMap(
  breakdown: WorkbenchContextBreakdown | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const segment of breakdown?.segments ?? []) map.set(segment.id, segSignature(segment));
  return map;
}

/** Diff the current segments against the prior send's signatures to infer cache state. */
export function computeCacheView(
  breakdown: WorkbenchContextBreakdown | undefined,
  baseline: Map<string, string> | null,
): CacheView {
  const hasBaseline = baseline !== null;
  const changed = new Set<string>();
  if (hasBaseline) {
    const current = signatureMap(breakdown);
    for (const [id, sig] of current) if (baseline.get(id) !== sig) changed.add(id);
    for (const id of baseline.keys()) if (!current.has(id)) changed.add(id);
  }
  let horizonRank: number | null = null;
  for (const id of changed) {
    if (id === "free") continue;
    const rank = rankOf(id);
    horizonRank = horizonRank === null ? rank : Math.min(horizonRank, rank);
  }
  const stateOf = (id: string): CacheState => {
    if (!hasBaseline) return "unknown";
    if (horizonRank === null) return "cached";
    return rankOf(id) >= horizonRank ? "reprocessed" : "cached";
  };
  return { hasBaseline, changed, horizonRank, stateOf };
}

export interface Layer {
  id: string;
  label: string;
  tokens: number;
  rank: number;
  items: WorkbenchContextItem[];
}

/** Real layers (drops free), ordered by request position then size. */
export function orderedLayers(breakdown: WorkbenchContextBreakdown | undefined): Layer[] {
  return (breakdown?.segments ?? [])
    .filter((segment) => segment.id !== "free")
    .map((segment) => ({
      id: segment.id,
      label: segment.label,
      tokens: segment.tokens,
      rank: rankOf(segment.id),
      items: segment.items ?? [],
    }))
    .sort((a, b) => a.rank - b.rank || b.tokens - a.tokens);
}

/**
 * Blast radius of a change at a given request rank — how far down the cache it busts.
 * rank 0 (tools) busts the whole prefix; rank 1 (system/memory) busts system+messages;
 * rank ≥2 (messages) only adds new uncached tail. Frontend-only convenience.
 */
export type Blast = "prefix" | "system" | "free";

export function blastOf(rank: number): Blast {
  if (rank <= 0) return "prefix";
  if (rank === 1) return "system";
  return "free";
}

export const BLAST_LABEL: Record<Blast, string> = {
  prefix: "busts all",
  system: "busts sys+msg",
  free: "~free",
};

/** Sum tokens that stayed cache-warm vs were reprocessed this send (≈ inferred). */
export function cacheTotals(
  layers: Layer[],
  cache: CacheView,
): { cached: number; reprocessed: number } {
  let cached = 0;
  let reprocessed = 0;
  for (const layer of layers) {
    if (cache.stateOf(layer.id) === "reprocessed") reprocessed += layer.tokens;
    else cached += layer.tokens;
  }
  return { cached, reprocessed };
}

type MemoryWindows = NonNullable<WorkbenchContextBreakdown["memoryWindows"]>;

/** Fill width (%) of a window, clamped to [0,100]. cap<=0 → 0 (avoids divide-by-zero). */
export function budgetFillPct(value: number, cap: number): number {
  return Math.max(0, Math.min(100, cap > 0 ? (value / cap) * 100 : 0));
}

/**
 * Geometry for the one budget bar (composer ribbon + World inspector). The bar is one linear
 * token scale in request/cache order: tools → system → observations window → messages window.
 * obsCap/msgCap are the window capacities (threshold-wide); horizon is the cache-break position
 * as a % of total, mapped from the inferred rank: 0/before tools, after tools (rank 1 = system
 * adjacent), or after the observations window (rank ≥ 2 = messages-only break). Pure — tested.
 */
export function budgetBarModel(
  tools: number,
  system: number,
  mw: MemoryWindows,
  cache: Pick<CacheView, "hasBaseline" | "horizonRank">,
): { obsCap: number; msgCap: number; total: number; horizon: number | null } {
  const obsCap = mw.reflectionThreshold;
  const msgCap = mw.observationThreshold;
  const total = tools + system + obsCap + msgCap || 1;
  const horizon =
    cache.hasBaseline && cache.horizonRank !== null
      ? ((cache.horizonRank <= 0 ? 0 : cache.horizonRank === 1 ? tools : tools + system + obsCap) /
          total) *
        100
      : null;
  return { obsCap, msgCap, total, horizon };
}
