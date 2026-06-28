import { useRef, useState } from "react";
import type { WorkbenchContextBreakdown, WorkbenchContextItem } from "@pe/agent-contracts";
import { cn } from "#/lib/utils";
import {
  blastOf,
  BLAST_LABEL,
  budgetBarModel,
  budgetFillPct,
  cacheTotals,
  computeCacheView,
  orderedLayers,
  signatureMap,
  type Blast,
  type CacheState,
  type CacheView,
  type Layer,
} from "./world-cache";

/**
 * The World inspector — "what Pea actually sent the model", ordered by request position
 * (tools → system → messages), the same order that drives prompt-cache reuse. Renders from
 * `inspector.contextBreakdown` (the same data the old chat-top ContextMeter used), now with
 * the tools layer restored at position 0. The cache-position logic lives in `world-cache.ts`.
 *
 * Styling is plain Tailwind on the elements — no lens.css classes. Density (Plain vs Inspect)
 * is a render switch (`inspect` below), not a CSS `[data-density]` hide: Plain simply doesn't
 * render the dev chrome (tokens, %, pills, items, cache readout, budget). Only the JS-positioned
 * budget-bar geometry + the `mg-bud-pulse` keyframe still live in CSS.
 */

/** Lay-reader sentence per layer, shown in Plain density instead of the dev chrome. */
const PLAIN_CAP: Record<string, string> = {
  tools:
    "The actions the agent can take — reading and editing files, running commands, plus any connected outside tools. Expand a tool to see its input/output schema.",
  "system-prompt":
    "The agent's core identity, your environment, and the project rules it started with.",
  skills: "On-demand playbooks the agent can load mid-task — markdown corpus, not a stable prefix.",
  memory:
    "What the agent remembers about you and this project — your name, preferences, past decisions.",
  messages: "The conversation tail — always uncached, reprocessed every send.",
};

/**
 * Tracks the previous send's breakdown as the diff baseline. The baseline only advances when
 * a new user turn lands (a "send"), so streaming pushes within a turn don't flicker the diff.
 * Refs-in-render derived state: idempotent given the same inputs.
 */
export function useCacheView(
  breakdown: WorkbenchContextBreakdown | undefined,
  userTurns: number,
): CacheView {
  const lastTurn = useRef<number>(userTurns);
  const prevSig = useRef<Map<string, string>>(signatureMap(breakdown));
  const baseline = useRef<Map<string, string> | null>(null);

  if (userTurns !== lastTurn.current) {
    baseline.current = prevSig.current; // the prior send's layers
    lastTurn.current = userTurns;
  }
  const view = computeCacheView(breakdown, baseline.current);
  prevSig.current = signatureMap(breakdown);
  return view;
}

const SEGMENT_TONES: Record<string, string> = {
  tools: "var(--pe-blue-soft, #1f6fa8)",
  "system-prompt": "var(--pe-blue)",
  skills: "var(--pe-green)",
  memory: "var(--clay, #c89b6a)",
  messages: "var(--slate, #8a9199)",
};

function tone(id: string): string {
  return SEGMENT_TONES[id] ?? "var(--slate, #8a9199)";
}

function fmtTok(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
}

// Cache badge (≈ inferred) — base + per-state tone. Reused by the per-row badge and the foot.
const CACHE_BASE =
  "rounded-[3px] border-[0.5px] px-[5px] py-px font-mono text-[8.5px] tracking-[0.02em] whitespace-nowrap";
const CACHE_TONE = {
  cached:
    "text-[var(--lichen)] border-[color-mix(in_srgb,var(--lichen)_50%,transparent)] bg-[color-mix(in_srgb,var(--pe-green)_16%,transparent)]",
  reproc:
    "text-[var(--clay-ink)] border-[color-mix(in_srgb,var(--clay)_55%,transparent)] bg-[var(--clay-tint)]",
} as const;

function CacheBadge({ state }: { state: CacheState }) {
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

/**
 * The world lane: a relative-load bar (no window %, meaningless under observational memory)
 * over the request-ordered layers, each expandable to its named contents.
 */
const PILL_LABEL: Record<NonNullable<WorkbenchContextItem["state"]>, string> = {
  in: "in context",
  "on-demand": "on demand",
  off: "not loaded",
};

// Density segmented-control button — the Plain / Inspect toggle.
const WORLD_DIAL_BTN =
  "cursor-pointer rounded-md border-[0.5px] border-transparent bg-transparent px-[9px] py-[3px] text-[11px] font-semibold whitespace-nowrap text-muted-foreground aria-pressed:border-[rgba(183,141,106,0.5)] aria-pressed:bg-[var(--paper)] aria-pressed:text-[var(--clay-ink)] aria-pressed:shadow-[0_1px_1px_rgba(138,94,59,0.15)]";

// Item load-state pill + delta blast badge (ported; standalone, not part of any cascade).
const PILL_BASE =
  "rounded border-[0.5px] px-[5px] py-px font-mono text-[8.5px] tracking-[0.02em] whitespace-nowrap";
const PILL_TONE: Record<NonNullable<WorkbenchContextItem["state"]>, string> = {
  in: "text-[var(--pe-blue)] border-[rgba(0,86,149,0.4)] bg-[rgba(0,86,149,0.05)]",
  "on-demand": "text-[var(--clay-ink)] border-dashed border-[rgba(183,141,106,0.5)]",
  off: "text-muted-foreground border-[var(--line-2)]",
};
const BLAST_BASE = "rounded-[3px] border-[0.5px] px-1 font-mono text-[8.5px] whitespace-nowrap";
const BLAST_TONE: Record<Blast, string> = {
  prefix:
    "text-[var(--fail)] border-[color-mix(in_srgb,var(--fail)_50%,transparent)] bg-[color-mix(in_srgb,var(--fail)_8%,transparent)]",
  system: "text-[var(--clay-ink)] border-[rgba(183,141,106,0.55)] bg-[var(--clay-tint)]",
  free: "text-[var(--lichen)] border-[rgba(124,139,107,0.5)] bg-[rgba(114,198,162,0.1)]",
};

// Row chrome shared by every layer row; grid-cols differ by density (see WorldLane).
const WORLD_ROW =
  "grid w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-[9px] text-left [font:inherit] hover:bg-[var(--paper-2)]";

export function WorldLane({
  breakdown,
  cache,
  sendNumber,
}: {
  breakdown: WorkbenchContextBreakdown | undefined;
  cache: CacheView;
  sendNumber?: number;
}) {
  const [density, setDensity] = useState<"inspect" | "plain">("inspect");
  const [diff, setDiff] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["system-prompt"]));
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set());
  const inspect = density === "inspect";
  const layers = orderedLayers(breakdown);
  const used = layers.reduce((sum, layer) => sum + layer.tokens, 0) || 1;
  const totals = cacheTotals(layers, cache);

  if (layers.length === 0) {
    return (
      <div className="flex min-h-0 flex-col [font-variant-numeric:tabular-nums]">
        <div className="px-4 py-5 text-[13px] leading-normal text-muted-foreground">
          Nothing sent yet. Ask Pea something to populate the context.
        </div>
      </div>
    );
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleItem = (key: string) =>
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-col [font-variant-numeric:tabular-nums]">
      <div className="sticky top-0 z-[2] flex items-center gap-2.5 border-b-[0.5px] border-[var(--line)] bg-[var(--paper-3)] px-3.5 pt-3 pb-2.5">
        <h2 className="m-0 font-[var(--font-display)] text-[15px] font-semibold text-foreground">
          What the agent sends the model
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          <div
            className="flex gap-0.5 rounded-lg border-[0.5px] border-[var(--line-2)] bg-muted p-0.5"
            role="group"
            aria-label="density"
          >
            <button
              type="button"
              className={WORLD_DIAL_BTN}
              aria-pressed={density === "plain"}
              onClick={() => setDensity("plain")}
            >
              Plain
            </button>
            <button
              type="button"
              className={WORLD_DIAL_BTN}
              aria-pressed={density === "inspect"}
              onClick={() => setDensity("inspect")}
            >
              Inspect
            </button>
          </div>
          <button
            type="button"
            className="h-6 w-[26px] cursor-pointer rounded-[7px] border-[0.5px] border-[var(--line-2)] bg-[var(--paper)] font-bold text-muted-foreground aria-pressed:border-[rgba(183,141,106,0.5)] aria-pressed:bg-[var(--clay-tint)] aria-pressed:text-[var(--clay-ink)] disabled:cursor-default disabled:opacity-40"
            aria-pressed={diff}
            onClick={() => setDiff((value) => !value)}
            title={
              cache.hasBaseline && sendNumber
                ? `Highlight what changed vs send #${sendNumber - 1}`
                : cache.hasBaseline
                  ? "Highlight what changed since the last send"
                  : "No previous send to compare yet"
            }
            disabled={!cache.hasBaseline}
          >
            Δ
          </button>
        </div>
      </div>

      {inspect ? (
        <div className="flex flex-wrap items-center gap-[7px] px-3.5 pt-[7px] font-mono text-[10px] text-muted-foreground">
          {sendNumber ? (
            <span className="rounded-[4px] border-[0.5px] border-[color-mix(in_srgb,var(--clay)_40%,transparent)] bg-[var(--clay-tint)] px-1.5 py-px text-[var(--clay-ink)]">
              snapshot @ send #{sendNumber}
            </span>
          ) : null}
          <span>resolved from the live agent</span>
        </div>
      ) : null}

      {inspect && cache.hasBaseline ? (
        <div className="mx-3.5 mt-2.5 grid gap-1.5 rounded-lg border-[0.5px] border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-[11px]">
          <div className="flex items-center gap-[7px] [font-variant-numeric:tabular-nums]">
            <span className="size-[9px] flex-none rounded-[2px] bg-[var(--pe-green)]" />
            cache-read · 0.1×
            <span className="ml-auto font-mono text-muted-foreground">{fmtTok(totals.cached)}</span>
          </div>
          <div className="flex items-center gap-[7px] [font-variant-numeric:tabular-nums]">
            <span className="size-[9px] flex-none rounded-[2px] bg-[var(--clay)] [background-image:repeating-linear-gradient(-45deg,rgba(255,255,255,0.4)_0_2px,transparent_2px_4px)]" />
            reprocessed · 1×
            <span className="ml-auto font-mono text-muted-foreground">
              {fmtTok(totals.reprocessed)}
            </span>
          </div>
          {diff && cache.changed.size > 0 && cache.horizonRank !== null ? (
            <div className="rounded-md border-[0.5px] border-[color-mix(in_srgb,var(--clay)_40%,transparent)] bg-[var(--clay-tint)] px-2 py-1.5 text-[10.5px] leading-[1.45] text-[var(--clay-ink)]">
              <b>Δ this send:</b> {whySentence(layers, cache, totals.reprocessed)}
            </div>
          ) : null}
        </div>
      ) : null}

      {inspect && breakdown ? <ContextBudgetBar breakdown={breakdown} cache={cache} /> : null}

      <div className="mt-2.5 border-t-[0.5px] border-[var(--line-soft)]">
        {layers.map((layer) => {
          const isOpen = open.has(layer.id);
          const changed = diff && cache.changed.has(layer.id);
          const blast = blastOf(layer.rank);
          return (
            <div
              className={cn(
                "border-b-[0.5px] border-[var(--line-soft)]",
                changed && "[background:linear-gradient(var(--paper-3),var(--clay-tint))]",
              )}
              key={layer.id}
            >
              <button
                className={cn(
                  WORLD_ROW,
                  inspect ? "grid-cols-[9px_1fr_auto_auto_auto_auto]" : "grid-cols-[9px_1fr_auto]",
                )}
                type="button"
                onClick={() => toggle(layer.id)}
              >
                <span className="size-[9px] rounded-[2px]" style={{ background: tone(layer.id) }} />
                <span className="text-[12.5px] font-semibold text-foreground">
                  {layer.label}
                  {inspect ? (
                    <span className="ml-1.5 font-mono text-[9px] font-normal text-muted-foreground">
                      pos {layer.rank}
                    </span>
                  ) : null}
                </span>
                {inspect ? <CacheBadge state={cache.stateOf(layer.id)} /> : null}
                {inspect ? (
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {fmtTok(layer.tokens)}
                  </span>
                ) : null}
                {inspect ? (
                  <span className="min-w-[30px] text-right font-mono text-[10px] text-muted-foreground">
                    {((layer.tokens / used) * 100).toFixed(0)}%
                  </span>
                ) : null}
                <span
                  className={cn(
                    "text-[11px] text-muted-foreground transition-transform",
                    isOpen && "rotate-90",
                  )}
                >
                  ▸
                </span>
              </button>
              {isOpen ? (
                <div className="pt-0 pr-3.5 pb-[11px] pl-[31px]">
                  <p className="mt-0 mb-1.5 text-[11.5px] leading-[1.5] text-muted-foreground">
                    {PLAIN_CAP[layer.id] ?? layer.label}
                  </p>
                  {inspect && changed ? (
                    <p className="mt-0 mb-1.5 font-mono text-[10.5px] leading-[1.45] text-[var(--clay-ink)]">
                      ⚡ changed this send → <b>{BLAST_LABEL[blast]}</b>. {driftHint(blast)}
                    </p>
                  ) : null}
                  {inspect && layer.items.length > 0 ? (
                    <ul className="m-0 grid list-none gap-[5px] p-0">
                      {layer.items.map((item, index) => (
                        <ItemRow
                          key={index}
                          item={item}
                          open={openItems.has(`${layer.id}:${index}`)}
                          onToggle={() => toggleItem(`${layer.id}:${index}`)}
                          blast={changed ? blast : null}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {inspect ? (
        <div className="px-3.5 pt-[11px] pb-4 text-[10.5px] leading-[1.5] text-muted-foreground">
          cache state <span className={cn(CACHE_BASE, CACHE_TONE.cached)}>≈ inferred</span> from a
          frontend snapshot diff — the provider only reports aggregate cache totals.
        </div>
      ) : null}
    </div>
  );
}

/** A single context item — name + provenance + tokens, expandable to its content body. */
function ItemRow({
  item,
  open,
  onToggle,
  blast,
}: {
  item: WorkbenchContextItem;
  open: boolean;
  onToggle: () => void;
  blast: Blast | null;
}) {
  const hasBody = Boolean(item.body);
  return (
    <li
      className={cn(
        "overflow-hidden rounded-md border-[0.5px] bg-[var(--paper)]",
        // delta layers tint their item borders clay
        blast ? "border-[color-mix(in_srgb,var(--clay)_45%,transparent)]" : "border-[var(--line)]",
      )}
    >
      <button
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-[9px] py-1.5 text-left [font:inherit] enabled:hover:bg-[var(--paper-2)] disabled:cursor-default"
        type="button"
        disabled={!hasBody}
        onClick={() => hasBody && onToggle()}
      >
        <span className="min-w-0 flex-1">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-foreground">
            {item.name}
          </span>
          {item.src ? (
            <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9.5px] text-[var(--lichen)]">
              {item.src}
            </span>
          ) : null}
        </span>
        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
          {blast ? (
            <span className={`${BLAST_BASE} ${BLAST_TONE[blast]}`}>{BLAST_LABEL[blast]}</span>
          ) : null}
          {item.state ? (
            <span className={`${PILL_BASE} ${PILL_TONE[item.state]}`}>
              {PILL_LABEL[item.state]}
            </span>
          ) : null}
          {item.tokens != null ? (
            <span className="font-mono text-[9.5px] text-muted-foreground">
              {fmtTok(item.tokens)}
            </span>
          ) : null}
          {hasBody ? (
            <span
              className={cn(
                "text-[10px] text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            >
              ▸
            </span>
          ) : null}
        </span>
      </button>
      {open && hasBody ? (
        <pre className="m-0 max-h-[220px] overflow-auto border-t-[0.5px] border-[var(--line)] bg-muted px-[9px] py-2 font-mono text-[10.5px] leading-[1.5] break-words whitespace-pre-wrap text-muted-foreground">
          {item.body}
        </pre>
      ) : null}
    </li>
  );
}

function driftHint(blast: Blast): string {
  if (blast === "prefix") return "A change here re-sends the entire context.";
  if (blast === "system") return "The cached tools prefix survives; system down is reprocessed.";
  return "New tail only — the cached prefix above is untouched.";
}

function whySentence(layers: Layer[], cache: CacheView, reprocessed: number): string {
  const front = layers.find((layer) => layer.rank === cache.horizonRank);
  const blast = blastOf(cache.horizonRank ?? 2);
  return `${front?.label ?? "a layer"} changed → ${BLAST_LABEL[blast]} (~${fmtTok(
    reprocessed,
  )} reprocessed at full price). Layers above the horizon stayed cache-warm.`;
}

/* ── The one budget bar ──────────────────────────────────────────────────────
   Shared by the composer ribbon and the World inspector so they read identically.
   Request/cache order: tools → system → observations window → messages window.
   Absolute token scale; each OM window is threshold-wide with hatched headroom and a
   trigger at its right edge; reflect floor + cache horizon are honest marks. The bar's
   geometry is inline (flex-grow / width / left are data-driven); the only CSS hook is the
   `mg-bud-pulse` keyframe driving the active-fill pulse. */
const BAR =
  "relative flex h-[13px] items-stretch overflow-hidden rounded-[7px] border-[0.5px] border-[var(--line-2)] bg-[var(--paper)]";
const BAR_WIN =
  "relative min-w-[2px] border-l-[0.5px] border-[var(--line)] [background:repeating-linear-gradient(45deg,var(--paper-2)_0_5px,var(--paper-3)_5px_10px)]";
const BAR_FILL = "absolute inset-y-0 left-0";
const BAR_TRIG = "absolute -inset-y-px right-0 w-0 border-r-[1.5px] border-[var(--clay-ink)]";

function BudgetBar({
  breakdown,
  cache,
}: {
  breakdown: WorkbenchContextBreakdown;
  cache: CacheView;
}) {
  const mw = breakdown.memoryWindows;
  if (!mw) return null;
  const segTok = (id: string) =>
    breakdown.segments.find((segment) => segment.id === id)?.tokens ?? 0;
  const tools = segTok("tools");
  const system = segTok("system-prompt");
  const { obsCap, msgCap, horizon } = budgetBarModel(tools, system, mw, cache);
  const fill = (value: number, cap: number) => `${budgetFillPct(value, cap)}%`;
  const pulse = "animate-[mg-bud-pulse_1.5s_ease-in-out_infinite]";

  return (
    <span className={BAR}>
      <span className="min-w-px" style={{ flexGrow: tools, background: tone("tools") }} />
      <span className="min-w-px" style={{ flexGrow: system, background: tone("system-prompt") }} />
      <span className={BAR_WIN} style={{ flexGrow: obsCap }}>
        <span
          className={cn(BAR_FILL, mw.reflecting && pulse)}
          style={{ width: fill(mw.observationTokens, obsCap), background: tone("memory") }}
        />
        {mw.reflectionFloor ? (
          <span
            className="absolute inset-y-0 w-0 border-r border-dashed border-[var(--clay-ink)] opacity-65"
            style={{ left: fill(mw.reflectionFloor, obsCap) }}
          />
        ) : null}
        <span className={BAR_TRIG} title={`reflect at ${fmtTok(obsCap)}`} />
      </span>
      <span className={BAR_WIN} style={{ flexGrow: msgCap }}>
        <span
          className={cn(BAR_FILL, mw.observing && pulse)}
          style={{ width: fill(mw.messageTokens, msgCap), background: tone("messages") }}
        />
        <span className={BAR_TRIG} title={`observe at ${fmtTok(msgCap)}`} />
      </span>
      {horizon !== null ? (
        <span
          className="pointer-events-none absolute -inset-y-0.5 w-0 border-r-[1.5px] border-dashed border-primary"
          style={{ left: `${horizon}%` }}
        />
      ) : null}
    </span>
  );
}

/**
 * The World inspector's budget panel: the shared BudgetBar with a visible head + trigger labels.
 * Composition fidelity lives in the per-layer rows below (exact tokens + share); this panel is the
 * budget/headroom view. Only renders when the runtime reports OM windows.
 */
function ContextBudgetBar({
  breakdown,
  cache,
}: {
  breakdown: WorkbenchContextBreakdown;
  cache: CacheView;
}) {
  const mw = breakdown.memoryWindows;
  if (!mw || mw.observationThreshold <= 0 || mw.reflectionThreshold <= 0) return null;
  const segTok = (id: string) =>
    breakdown.segments.find((segment) => segment.id === id)?.tokens ?? 0;
  const prefix = segTok("tools") + segTok("system-prompt") + segTok("skills");
  const budget = prefix + mw.observationThreshold + mw.reflectionThreshold;
  const inContext = prefix + mw.messageTokens + mw.observationTokens;
  // Request order puts the observations window before messages, so reflect falls mid-bar and
  // observe sits at the budget end.
  const reflectAt =
    ((segTok("tools") + segTok("system-prompt") + mw.reflectionThreshold) / budget) * 100;

  return (
    <div className="mx-3.5 mt-3">
      <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground [font-variant-numeric:tabular-nums]">
        <b className="font-semibold text-foreground">Context budget</b>
        <span>
          {fmtTok(inContext)} / {fmtTok(budget)} · OM windows
        </span>
      </div>
      <BudgetBar breakdown={breakdown} cache={cache} />
      <div className="relative mt-px h-[13px] font-mono text-[8px] text-[var(--clay-ink)]">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${reflectAt}%` }}
        >
          reflect {fmtTok(mw.reflectionThreshold)}
        </span>
        <span
          className="absolute whitespace-nowrap"
          style={{ left: "100%", transform: "translateX(-100%)" }}
        >
          observe {fmtTok(mw.observationThreshold)}
        </span>
      </div>
    </div>
  );
}

/**
 * The unified context ribbon — the "single request-ordered token bar" that the cap + OM gauges
 * fold into, now that it lives at the composer (flat token-space, no scroll strip to fight). The
 * whole bar is ONE linear token scale: the budget = fixed prefix (tools + system) + the two OM
 * window capacities (observations→reflect, messages→observe), laid out in request/cache order.
 *
 * Because it's absolute token space, every claim is honest with no shared-denominator trick:
 *   • prefix segments are real token widths (always in-context);
 *   • each OM window is its threshold-wide, filled to its live tokens — so the empty remainder
 *     reads directly as "headroom to compaction" and the window's right edge IS the trigger;
 *   • the reflect floor is the post-reflect low-water mark inside the observations window;
 *   • the cache horizon falls on a real rank boundary (≈ inferred, like everywhere).
 * Approximations are the same inherited ones: char/4 token estimates, frontend-inferred cache.
 * Only renders when the runtime reports OM windows. A hover/focus flyout breaks out the segments.
 */
export function ContextRibbon({
  breakdown,
  cache,
  onOpenWorld,
}: {
  breakdown: WorkbenchContextBreakdown | undefined;
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
    <button
      type="button"
      className="group/ribbon relative block w-full cursor-pointer border-0 bg-transparent p-0"
      onClick={onOpenWorld}
      title="What the agent sends the model — request order, token budget. Click to inspect."
      aria-label="Context budget"
    >
      <BudgetBar breakdown={breakdown} cache={cache} />
      <span className="absolute bottom-[calc(100%+8px)] left-0 hidden w-max max-w-[220px] flex-col gap-[3px] rounded-lg border-[0.5px] border-[var(--line-2)] bg-[var(--paper)] px-2.5 py-2 text-[11px] text-muted-foreground shadow-[0_8px_24px_color-mix(in_srgb,var(--foreground)_16%,transparent)] group-hover/ribbon:flex group-focus-visible/ribbon:flex">
        {rows.map((row) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap" key={row.id}>
            <span className="size-2 flex-none rounded-[2px]" style={{ background: tone(row.id) }} />
            {row.label}
            {row.active ? <span className="ml-1 text-primary">⟲</span> : null}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {fmtTok(row.tok)}
              {row.cap ? ` / ${fmtTok(row.cap)}` : ""}
            </span>
          </span>
        ))}
        <span className="mt-0.5 text-[9.5px] text-muted-foreground">
          {fmtTok(inContext)} in context · solid = loaded, hatched = headroom to compaction
        </span>
      </span>
    </button>
  );
}
