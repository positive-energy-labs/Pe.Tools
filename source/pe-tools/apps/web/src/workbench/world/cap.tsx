import { token } from "#/lib/token";
import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ContextBreakdown, ContextItem } from "../chat-state";
import { cn } from "#/lib/utils";
import { useWorkbench } from "../provider";
import {
  computeCacheView,
  signatureMap,
  type Blast,
  type CacheState,
  type CacheView,
} from "../world-cache";

export const PLAIN_CAP: Record<string, string> = {
  tools:
    "The actions the agent can take — reading and editing files, running commands, plus any connected outside tools. Expand a tool to see its input/output schema.",
  "system-prompt":
    "The agent's core identity, your environment, and the project rules it started with.",
  skills: "On-demand playbooks the agent can load mid-task — markdown corpus, not a stable prefix.",
  memory:
    "What the agent remembers about you and this project — your name, preferences, past decisions.",
  messages: "The conversation tail — always uncached, reprocessed every send.",
};

export function useCacheView(
  breakdown: ContextBreakdown | undefined,
  userTurns: number,
): CacheView {
  const { store } = useWorkbench();
  const cache = useAtomValue(store.atoms.worldCache);
  const baseline =
    cache.lastTurn !== null && userTurns !== cache.lastTurn ? cache.prevSig : cache.baseline;
  useEffect(() => {
    store.actions.setWorldCache((previous) => ({
      lastTurn: userTurns,
      prevSig: signatureMap(breakdown),
      baseline:
        previous.lastTurn === null
          ? null
          : previous.lastTurn === userTurns
            ? previous.baseline
            : previous.prevSig,
    }));
  }, [store, breakdown, userTurns]);
  return computeCacheView(breakdown, baseline);
}

export const SEGMENT_TONES: Record<string, string> = {
  tools: token("viz-6"),
  "system-prompt": token("viz-3"),
  skills: token("viz-2"),
  memory: token("viz-5"),
  messages: token("viz-1"),
};

export function tone(id: string): string {
  return SEGMENT_TONES[id] ?? token("viz-3");
}

export function tint(id: string): string {
  return `color-mix(in srgb, ${tone(id)} 25%, transparent)`;
}

export function fmtTok(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
}

export const CACHE_BASE =
  "rounded-sm border-[0.5px] px-[5px] py-px t-caption face-mono whitespace-nowrap";

export const CACHE_TONE = {
  cached: "text-done border-done/50 bg-done/12",
  reproc: "text-caution border-caution/55 bg-caution/10",
} as const;

export function CacheBadge({ state }: { state: CacheState }) {
  if (state === "unknown") return null;
  return (
    <span
      className={cn(CACHE_BASE, state === "cached" ? CACHE_TONE.cached : CACHE_TONE.reproc)}
      title="≈ inferred from a frontend snapshot diff, not provider usage"
    >
      {state === "cached" ? "≈ cached" : "≈ reproc"}
    </span>
  );
}

export const PILL_LABEL: Record<NonNullable<ContextItem["state"]>, string> = {
  in: "in context",
  "on-demand": "on demand",
  off: "not loaded",
};

export const PILL_BASE =
  "rounded-sm border-[0.5px] px-[5px] py-px t-caption face-mono whitespace-nowrap";

export const PILL_TONE: Record<NonNullable<ContextItem["state"]>, string> = {
  in: "text-ink-2 border-line-2",
  "on-demand": "text-ink-2 border-line-2",
  off: "text-ink-mute border-line",
};

export const BLAST_BASE = "rounded-sm border-[0.5px] px-1 t-caption face-mono whitespace-nowrap";

export const BLAST_TONE: Record<Blast, string> = {
  prefix: "text-caution border-caution/50 bg-caution/8",
  system: "text-ink-2 border-line-2",
  free: "text-done border-done/50 bg-done/10",
};

export const WORLD_ROW =
  "grid w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-1.5 text-left [font:inherit] hover:veil";
