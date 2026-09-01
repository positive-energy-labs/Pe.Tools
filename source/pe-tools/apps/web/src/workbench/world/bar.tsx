import type { ContextBreakdown } from "../chat-state";
import { cn } from "#/lib/utils";
import {
  blastOf,
  BLAST_LABEL,
  budgetBarModel,
  budgetFillPct,
  type CacheView,
  type Layer,
} from "../world-cache";
import { Press } from "#/components/lang/press";
import { fmtTok, tint, tone } from "./cap";
import { PressContent } from "#/components/anatomy/press-content";
import { Tooltip, UiTooltipProvider } from "#/components/lang/tooltip";

export function whySentence(layers: Layer[], cache: CacheView, reprocessed: number): string {
  const front = layers.find((layer) => layer.rank === cache.horizonRank);
  const blast = blastOf(cache.horizonRank ?? 2);
  return `${front?.label ?? "a layer"} changed → ${BLAST_LABEL[blast]} (~${fmtTok(
    reprocessed,
  )} reprocessed at full price). Layers above the horizon stayed cache-warm.`;
}

export const BAR =
  "relative flex h-[13px] items-stretch overflow-hidden rounded-sm border-[0.5px] border-line-2 bg-page";

export const BAR_WIN = "relative min-w-[2px] border-l-[0.5px] border-line";

export const BAR_FILL = "absolute inset-y-0 left-0";

export const BAR_TRIG = "absolute inset-y-0 right-0 w-0 border-r-[0.5px] border-line-2";

export function BudgetBar({
  breakdown,
  cache,
  className = BAR,
}: {
  breakdown: ContextBreakdown;
  cache: CacheView;
  className?: string;
}) {
  const mw = breakdown.memoryWindows;
  if (!mw) return null;
  const segTok = (id: string) =>
    breakdown.segments.find((segment) => segment.id === id)?.tokens ?? 0;
  const tools = segTok("tools");
  const system = segTok("system-prompt");
  const { obsCap, msgCap, horizon } = budgetBarModel(tools, system, mw, cache);
  const fill = (value: number, cap: number) => `${budgetFillPct(value, cap)}%`;
  const pulse = "mg-bud-pulse";

  return (
    <span className={className}>
      <span className="min-w-px" style={{ flexGrow: tools, backgroundColor: tint("tools") }} />
      <span
        className="min-w-px"
        style={{ flexGrow: system, backgroundColor: tint("system-prompt") }}
      />
      <span className={BAR_WIN} style={{ flexGrow: obsCap }}>
        <span
          className={cn(BAR_FILL, mw.reflecting && pulse)}
          style={{ width: fill(mw.observationTokens, obsCap), backgroundColor: tint("memory") }}
        />

        {mw.reflectionFloor ? (
          <span
            className="absolute inset-y-0 w-0"
            style={{ left: fill(mw.reflectionFloor, obsCap) }}
          />
        ) : null}
        <span className={BAR_TRIG} title={`reflect at ${fmtTok(obsCap)}`} />
      </span>
      <span className={BAR_WIN} style={{ flexGrow: msgCap }}>
        <span
          className={cn(BAR_FILL, mw.observing && pulse)}
          style={{ width: fill(mw.messageTokens, msgCap), backgroundColor: tint("messages") }}
        />
        <span className={BAR_TRIG} title={`observe at ${fmtTok(msgCap)}`} />
      </span>

      {horizon !== null ? (
        <span
          className="pointer-events-none absolute -inset-y-0.5 w-0"
          style={{ left: `${horizon}%` }}
        />
      ) : null}
    </span>
  );
}

export function ContextBudgetBar({
  breakdown,
  cache,
}: {
  breakdown: ContextBreakdown;
  cache: CacheView;
}) {
  const mw = breakdown.memoryWindows;
  if (!mw || mw.observationThreshold <= 0 || mw.reflectionThreshold <= 0) return null;
  const segTok = (id: string) =>
    breakdown.segments.find((segment) => segment.id === id)?.tokens ?? 0;
  const prefix = segTok("tools") + segTok("system-prompt") + segTok("skills");
  const budget = prefix + mw.observationThreshold + mw.reflectionThreshold;
  const inContext = prefix + mw.messageTokens + mw.observationTokens;
  return (
    <div className="mx-3 mt-3">
      <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
        <span className="t-label text-ink">Context budget</span>
        <span className="text-right t-caption face-mono">
          {fmtTok(inContext)} / {fmtTok(budget)} · OM windows
        </span>
      </div>
      <BudgetBar breakdown={breakdown} cache={cache} />

      <div className="mt-1 grid grid-cols-2 gap-3 t-caption face-mono text-ink-2">
        <span className="whitespace-nowrap">reflect {fmtTok(mw.reflectionThreshold)}</span>
        <span className="text-right whitespace-nowrap">
          observe {fmtTok(mw.observationThreshold)}
        </span>
      </div>
    </div>
  );
}

export function ContextRibbon({
  breakdown,
  cache,
  onOpenWorld,
}: {
  breakdown: ContextBreakdown | undefined;
  cache: CacheView;
  onOpenWorld?: () => void;
}) {
  const mw = breakdown?.memoryWindows;
  if (!breakdown || !mw || mw.observationThreshold <= 0 || mw.reflectionThreshold <= 0) return null;
  const segTok = (id: string) =>
    breakdown.segments.find((segment) => segment.id === id)?.tokens ?? 0;
  const tools = segTok("tools");
  const system = segTok("system-prompt");
  const inContext = tools + system + mw.observationTokens + mw.messageTokens;

  const rows: { id: string; label: string; tok: number; cap?: number; active?: boolean }[] = [
    { id: "tools", label: "Tools", tok: tools },
    { id: "system-prompt", label: "System", tok: system },
    {
      id: "memory",
      label: "Observations → reflect",
      tok: mw.observationTokens,
      cap: mw.reflectionThreshold,
      active: mw.reflecting,
    },
    {
      id: "messages",
      label: "Messages → observe",
      tok: mw.messageTokens,
      cap: mw.observationThreshold,
      active: mw.observing,
    },
  ];

  return (
    <UiTooltipProvider>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={<Press type="button" onClick={onOpenWorld} style={{ width: "100%" }} />}
          aria-label="Context budget. Click to inspect."
        >
          <PressContent geometry="block">
            <BudgetBar
              breakdown={breakdown}
              cache={cache}
              className="relative flex h-1.5 items-stretch overflow-hidden"
            />
          </PressContent>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" align="end" sideOffset={6}>
            <Tooltip.Popup>
              <span className="flex w-[280px] max-w-full flex-col gap-1">
                {rows.map((row) => (
                  <span
                    className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-2"
                    key={row.id}
                  >
                    <span className="size-2 flex-none" style={{ backgroundColor: tone(row.id) }} />
                    <span className="min-w-0 truncate">
                      {row.label}
                      {row.active ? " · active" : ""}
                    </span>
                    <span className="text-right face-mono whitespace-nowrap">
                      {fmtTok(row.tok)}
                      {row.cap ? ` / ${fmtTok(row.cap)}` : ""}
                    </span>
                  </span>
                ))}
                <span className="hairline-t-faint mt-0.5 pt-1.5 t-caption text-ink-2">
                  {fmtTok(inContext)} in context · tinted = loaded, empty = headroom to compaction
                </span>
              </span>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </UiTooltipProvider>
  );
}
