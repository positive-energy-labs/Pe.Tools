import { token } from "@pe/kit/lib/token";
import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ContextBreakdown, ContextItem } from "@pe/agent-contracts/chat-state";
import { useCurrentThreadView } from "../thread-view";
import {
  computeCacheView,
  signatureMap,
  type CacheState,
  type CacheView,
} from "../world-cache";
import { TooltipHint } from "@pe/kit/lang/tooltip";

export const PLAIN_CAP: Record<string, string> = {
  messages: "The context this thread has used, as the harness counts it.",
};

export function useCacheView(
  breakdown: ContextBreakdown | undefined,
  userTurns: number,
): CacheView {
  const view = useCurrentThreadView();
  const cache = useAtomValue(view.atoms.worldCache);
  const baseline =
    cache.lastTurn !== null && userTurns !== cache.lastTurn ? cache.prevSig : cache.baseline;
  useEffect(() => {
    view.actions.setWorldCache((previous) => ({
      lastTurn: userTurns,
      prevSig: signatureMap(breakdown),
      baseline:
        previous.lastTurn === null
          ? null
          : previous.lastTurn === userTurns
            ? previous.baseline
            : previous.prevSig,
    }));
  }, [view, breakdown, userTurns]);
  return computeCacheView(breakdown, baseline);
}

const SEGMENT_TONES: Record<string, string> = {
  messages: token("viz-1"),
};

export function tone(id: string): string {
  return SEGMENT_TONES[id] ?? token("viz-3");
}

export function fmtTok(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
}

export const CACHE_BASE =
  "rounded-sm border-[0.5px] px-[5px] py-px t-small face-mono whitespace-nowrap";

export const CACHE_TONE = {
  cached: "done",
  reprocessed: "caution",
} as const;

export function CacheBadge({ state }: { state: CacheState }) {
  if (state === "unknown") return null;
  return (
    <TooltipHint content="≈ inferred from a frontend snapshot diff, not provider usage">
      <span className={CACHE_BASE} data-tone={CACHE_TONE[state]} data-wash>
        {state === "cached" ? "≈ cached" : "≈ reproc"}
      </span>
    </TooltipHint>
  );
}

export const PILL_LABEL: Record<NonNullable<ContextItem["state"]>, string> = {
  in: "in context",
  "on-demand": "on demand",
  off: "not loaded",
};

export const WORLD_ROW =
  "veil grid w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3 py-1 text-left tabular-nums [font:inherit]";
