import type { ContextBreakdown, ContextItem, ContextSegment } from "./chat-state";

/** Request position of each segment the harness reports (`usage_update`): used, then free. */
const REQUEST_RANK: Record<string, number> = {
  messages: 2,
  free: 9,
};

function rankOf(id: string): number {
  return REQUEST_RANK[id] ?? 1;
}

export type CacheState = "cached" | "reprocessed" | "unknown";

export interface CacheView {
  hasBaseline: boolean;
  changed: Set<string>;
  horizonRank: number | null;
  stateOf: (id: string) => CacheState;
}

function segSignature(segment: ContextSegment): string {
  const items = (segment.items ?? []).map((item) => `${item.name}:${item.tokens ?? ""}`).join("~");
  return `${Math.round(segment.tokens)}|${items}`;
}

export function signatureMap(breakdown: ContextBreakdown | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const segment of breakdown?.segments ?? []) map.set(segment.id, segSignature(segment));
  return map;
}

export function computeCacheView(
  breakdown: ContextBreakdown | undefined,
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
  items: ContextItem[];
}

export function orderedLayers(breakdown: ContextBreakdown | undefined): Layer[] {
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
