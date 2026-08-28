import { token } from "#/lib/token";
import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ContextBreakdown, ContextItem } from "./chat-state";
import { EmptyState } from "#/components/lang/empty";
import { FactChip } from "#/components/lang/chip";
import { Switcher } from "#/components/lang/switcher";
import { cn } from "#/lib/utils";
import { useWorkbench } from "./provider";
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
import { Press } from "#/components/lang/press";

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
 * The chat store owns the baseline so route remounts do not reset page memory.
 */
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

// Per-layer identity hue — TAXONOMY, so it spends the viz ladder (never a meaning role).
// Series identity carries over from the cat-* era: kiln→viz-6 (stable muted tool prefix),
// slate→viz-3 (neutral system core), green→viz-2 (on-demand skills), clay→viz-5 (inferred
// observations window), blue→viz-1 (the focal live tail). Grayscale law: the label and the
// row order carry the distinction; colour only speeds it up.
const SEGMENT_TONES: Record<string, string> = {
  tools: token("viz-6"),
  "system-prompt": token("viz-3"),
  skills: token("viz-2"),
  memory: token("viz-5"),
  messages: token("viz-1"),
};

function tone(id: string): string {
  return SEGMENT_TONES[id] ?? token("viz-3");
}

// Bar-segment fill: the layer's identity hue at a /25 tint, per the approved budget-strip design.
function tint(id: string): string {
  return `color-mix(in srgb, ${tone(id)} 25%, transparent)`;
}

function fmtTok(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
}

// Cache badge (≈ inferred) — base + per-state meaning role: a warm cache read LANDED (done);
// a reprocess is a cost owed this send (caution). Machine-measured, so mono.
const CACHE_BASE = "rounded-sm border-[0.5px] px-[5px] py-px t-caption face-mono whitespace-nowrap";
const CACHE_TONE = {
  cached: "text-done border-done/50 bg-done/12",
  reproc: "text-caution border-caution/55 bg-caution/10",
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
const PILL_LABEL: Record<NonNullable<ContextItem["state"]>, string> = {
  in: "in context",
  "on-demand": "on demand",
  off: "not loaded",
};

// Item load-state pill — a neutral machine fact; the LABEL carries the state, colour buys
// nothing. The old dashed "on demand" edge is gone: dashed means seam (a stand-in), and an
// on-demand skill is real, just not loaded.
const PILL_BASE = "rounded-sm border-[0.5px] px-[5px] py-px t-caption face-mono whitespace-nowrap";
const PILL_TONE: Record<NonNullable<ContextItem["state"]>, string> = {
  in: "text-ink-2 border-line-2",
  "on-demand": "text-ink-2 border-line-2",
  off: "text-ink-mute border-line",
};
// Delta blast badge — cost severity is the caution family, never the alarm (a cache miss is
// not the model disagreeing). prefix = whole context reprocessed (caution) · system = partial
// (neutral) · free = the cached prefix survived (done).
const BLAST_BASE = "rounded-sm border-[0.5px] px-1 t-caption face-mono whitespace-nowrap";
const BLAST_TONE: Record<Blast, string> = {
  prefix: "text-caution border-caution/50 bg-caution/8",
  system: "text-ink-2 border-line-2",
  free: "text-done border-done/50 bg-done/10",
};

// Row chrome shared by every layer row; grid-cols differ by density (see WorldLane).
// Hover is the one veil (a background-image, so it composits over any fill).
const WORLD_ROW =
  "grid w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-1.5 text-left [font:inherit] hover:veil";

export function WorldLane({
  breakdown,
  cache,
  sendNumber,
}: {
  breakdown: ContextBreakdown | undefined;
  cache: CacheView;
  sendNumber?: number;
}) {
  const { store } = useWorkbench();
  const { density, diff, open, openItems } = useAtomValue(store.atoms.world);
  const setWorld = store.actions.setWorld;
  const inspect = density === "inspect";
  const layers = orderedLayers(breakdown);
  const used = layers.reduce((sum, layer) => sum + layer.tokens, 0) || 1;
  const totals = cacheTotals(layers, cache);

  if (layers.length === 0) {
    return (
      <div className="flex min-h-0 flex-col [font-variant-numeric:tabular-nums] px-4 py-5">
        <EmptyState story="scope" exit="ask pea something — the first send populates the context">
          nothing sent to the model yet
        </EmptyState>
      </div>
    );
  }

  const toggle = (id: string) =>
    setWorld((previous) => {
      const next = new Set(previous.open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...previous, open: next };
    });
  const toggleItem = (key: string) =>
    setWorld((previous) => {
      const next = new Set(previous.openItems);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...previous, openItems: next };
    });

  return (
    <div className="flex min-h-0 flex-col [font-variant-numeric:tabular-nums]">
      <div className="sticky top-0 z-[2] flex items-center gap-2.5 border-b-[0.5px] border-line on-artifact px-3.5 pt-3 pb-2.5">
        <h2 className="t-label t-upper m-0 text-ink-2">What the agent sends the model</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {/* mode = a fill, never a hue — the lang Switcher replaces the hand-rolled dial */}
          <Switcher
            ariaLabel="density"
            value={density}
            onChange={(density) => setWorld((previous) => ({ ...previous, density }))}
            options={[
              {
                value: "plain",
                label: "Plain",
                title: "Lay-reader view — layer names and what each one is, no dev chrome",
              },
              {
                value: "inspect",
                label: "Inspect",
                title: "Dev view — tokens, shares, cache state, budget bar, item bodies",
              },
            ]}
          />
          {/* Δ is a mode toggle too: pressed = the selection fill, never a hue. */}
          <Press
            type="button"
            className="h-6 w-[26px] cursor-pointer rounded-sm border-[0.5px] border-line-2 bg-transparent text-ink-2 hover:veil aria-pressed:bg-select aria-pressed:text-ink disabled:cursor-default disabled:italic disabled:opacity-40"
            aria-pressed={diff}
            onClick={() => setWorld((previous) => ({ ...previous, diff: !previous.diff }))}
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
          </Press>
        </div>
      </div>

      {inspect ? (
        <div className="flex flex-wrap items-center gap-[7px] px-3.5 pt-[7px] t-caption text-ink-2">
          {sendNumber ? (
            <FactChip title="This breakdown was captured at the last user send; streaming pushes within the turn do not advance it">
              snapshot @ send #{sendNumber}
            </FactChip>
          ) : null}
          <span>resolved from the live agent</span>
        </div>
      ) : null}

      {inspect && cache.hasBaseline ? (
        <div className="mx-3.5 mt-2.5 grid gap-1.5 rounded-sm border-[0.5px] border-line on-page px-3 py-2.5 t-label">
          <div className="flex items-center gap-[7px] t-caption face-mono [font-variant-numeric:tabular-nums]">
            <span className="size-[9px] flex-none rounded-[2px] bg-done" />
            cache-read · 0.1×
            <span className="ml-auto text-ink-2">{fmtTok(totals.cached)}</span>
          </div>
          <div className="flex items-center gap-[7px] t-caption face-mono [font-variant-numeric:tabular-nums]">
            <span className="size-[9px] flex-none rounded-[2px] bg-caution [background-image:repeating-linear-gradient(-45deg,rgba(255,255,255,0.4)_0_2px,transparent_2px_4px)]" />
            reprocessed · 1×
            <span className="ml-auto text-ink-2">{fmtTok(totals.reprocessed)}</span>
          </div>
          {diff && cache.changed.size > 0 && cache.horizonRank !== null ? (
            <div className="rounded-sm border-[0.5px] border-caution/40 bg-caution/8 px-2 py-1.5 t-caption leading-[1.45] text-caution">
              Δ this send: {whySentence(layers, cache, totals.reprocessed)}
            </div>
          ) : null}
        </div>
      ) : null}

      {inspect && breakdown ? <ContextBudgetBar breakdown={breakdown} cache={cache} /> : null}

      <div className="mt-2.5 border-t-[0.5px] border-line">
        {layers.map((layer) => {
          const isOpen = open.has(layer.id);
          const changed = diff && cache.changed.has(layer.id);
          const blast = blastOf(layer.rank);
          return (
            <div
              className={cn("border-b-[0.5px] border-line", changed && "caution-wash-artifact")}
              key={layer.id}
            >
              <Press
                className={cn(
                  WORLD_ROW,
                  inspect ? "grid-cols-[9px_1fr_auto_auto_auto_auto]" : "grid-cols-[9px_1fr_auto]",
                )}
                type="button"
                onClick={() => toggle(layer.id)}
              >
                <span className="size-[9px] rounded-[2px]" style={{ background: tone(layer.id) }} />
                <span className="t-value text-ink">
                  {layer.label}
                  {inspect ? (
                    <span className="ml-1.5 t-caption face-mono text-ink-2">pos {layer.rank}</span>
                  ) : null}
                </span>
                {inspect ? <CacheBadge state={cache.stateOf(layer.id)} /> : null}
                {inspect ? (
                  <span className="t-value face-mono text-ink-2">{fmtTok(layer.tokens)}</span>
                ) : null}
                {inspect ? (
                  <span className="min-w-[30px] text-right t-value face-mono text-ink-2">
                    {((layer.tokens / used) * 100).toFixed(0)}%
                  </span>
                ) : null}
                <span
                  className={cn("t-label text-ink-2 transition-transform", isOpen && "rotate-90")}
                >
                  ▸
                </span>
              </Press>
              {isOpen ? (
                <div className="pt-0 pr-3.5 pb-[11px] pl-[31px]">
                  <p className="mt-0 mb-1.5 t-label leading-[1.5] text-ink-2">
                    {PLAIN_CAP[layer.id] ?? layer.label}
                  </p>
                  {inspect && changed ? (
                    <p className="mt-0 mb-1.5 t-caption face-mono leading-[1.45] text-caution">
                      ⚡ changed this send → {BLAST_LABEL[blast]}. {driftHint(blast)}
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
        <div className="px-3.5 pt-[11px] pb-4 t-caption leading-[1.5] text-ink-2">
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
  item: ContextItem;
  open: boolean;
  onToggle: () => void;
  blast: Blast | null;
}) {
  const hasBody = Boolean(item.body);
  return (
    <li
      className={cn(
        "overflow-hidden rounded-sm border-[0.5px] on-page",
        // delta layers tint their item borders caution
        blast ? "border-caution/45" : "border-line",
      )}
    >
      <Press
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-[9px] py-1.5 text-left [font:inherit] enabled:hover:veil disabled:cursor-default"
        type="button"
        disabled={!hasBody}
        onClick={() => hasBody && onToggle()}
      >
        <span className="min-w-0 flex-1">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap t-value text-ink">
            {item.name}
          </span>
          {item.src ? (
            <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap t-caption face-mono text-ink-2">
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
            <span className="t-value face-mono text-ink-2">{fmtTok(item.tokens)}</span>
          ) : null}
          {hasBody ? (
            <span className={cn("t-caption text-ink-2 transition-transform", open && "rotate-90")}>
              ▸
            </span>
          ) : null}
        </span>
      </Press>
      {open && hasBody ? (
        <pre className="m-0 max-h-[220px] overflow-auto border-t-[0.5px] border-line on-recess px-[9px] py-2 t-caption face-mono leading-[1.5] break-words whitespace-pre-wrap text-ink-2">
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
// The one budget strip: segmented horizontal bar, layer hues at /25 tint, hairline compartment
// separators. Prefix layers are solid token-width segments; each OM window is threshold-wide with
// a tinted live fill and plain-paper headroom, its right edge a thin hairline threshold tick.
const BAR =
  "relative flex h-[13px] items-stretch overflow-hidden rounded-sm border-[0.5px] border-line-2 bg-page";
const BAR_WIN = "relative min-w-[2px] border-l-[0.5px] border-line";
const BAR_FILL = "absolute inset-y-0 left-0";
// Threshold tick: thin neutral hairline at the window's right edge (reflect / observe trigger).
const BAR_TRIG = "absolute inset-y-0 right-0 w-0 border-r-[0.5px] border-line-2";

function BudgetBar({
  breakdown,
  cache,
  className = BAR,
}: {
  breakdown: ContextBreakdown;
  cache: CacheView;
  /** Override the bar shell — composer ribbon passes a flush, thin progress-bar shape. */
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
  const pulse = "animate-[mg-bud-pulse_1.5s_ease-in-out_infinite]";

  return (
    <span className={className}>
      <span
        className="min-w-px border-r-[0.5px] border-line"
        style={{ flexGrow: tools, background: tint("tools") }}
      />
      <span
        className="min-w-px border-r-[0.5px] border-line"
        style={{ flexGrow: system, background: tint("system-prompt") }}
      />
      <span className={BAR_WIN} style={{ flexGrow: obsCap }}>
        <span
          className={cn(BAR_FILL, mw.reflecting && pulse)}
          style={{ width: fill(mw.observationTokens, obsCap), background: tint("memory") }}
        />
        {/* reflect floor: a recorded low-water mark — a real measured fact, so a SOLID
            caution hairline (dashed is reserved for seam). */}
        {mw.reflectionFloor ? (
          <span
            className="absolute inset-y-0 w-0 border-r-[0.5px] border-caution opacity-65"
            style={{ left: fill(mw.reflectionFloor, obsCap) }}
          />
        ) : null}
        <span className={BAR_TRIG} title={`reflect at ${fmtTok(obsCap)}`} />
      </span>
      <span className={BAR_WIN} style={{ flexGrow: msgCap }}>
        <span
          className={cn(BAR_FILL, mw.observing && pulse)}
          style={{ width: fill(mw.messageTokens, msgCap), background: tint("messages") }}
        />
        <span className={BAR_TRIG} title={`observe at ${fmtTok(msgCap)}`} />
      </span>
      {/* cache horizon: an inferred boundary over real content — a locate mark, so neutral
          ink and SOLID (it was dashed blue: two law violations in one stroke). */}
      {horizon !== null ? (
        <span
          className="pointer-events-none absolute -inset-y-0.5 w-0 border-r-[1.5px] border-ink opacity-70"
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
function ContextBudgetBar({ breakdown, cache }: { breakdown: ContextBreakdown; cache: CacheView }) {
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
      <div className="mb-1.5 flex justify-between t-label text-ink-2 [font-variant-numeric:tabular-nums]">
        <span className="t-label t-upper text-ink-2">Context budget</span>
        <span className="t-value face-mono">
          {fmtTok(inContext)} / {fmtTok(budget)} · OM windows
        </span>
      </div>
      <BudgetBar breakdown={breakdown} cache={cache} />
      {/* trigger labels: machine-measured thresholds — mono, secondary ink */}
      <div className="relative mt-px h-[14px] t-caption face-mono text-ink-2">
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
    <Press
      type="button"
      className="group/ribbon relative block w-full cursor-pointer border-0 bg-transparent p-0"
      onClick={onOpenWorld}
      title="What the agent sends the model — request order, token budget. Click to inspect."
      aria-label="Context budget"
    >
      <BudgetBar
        breakdown={breakdown}
        cache={cache}
        className="relative flex h-1.5 items-stretch overflow-hidden bg-recess"
      />
      <span className="absolute bottom-[calc(100%+8px)] left-0 hidden w-max max-w-[220px] flex-col gap-[3px] rounded-sm border-[0.5px] border-line-2 on-page px-2.5 py-2 t-label text-ink-2 group-hover/ribbon:flex group-focus-visible/ribbon:flex">
        {rows.map((row) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap" key={row.id}>
            <span className="size-2 flex-none rounded-[2px]" style={{ background: tone(row.id) }} />
            {row.label}
            {/* an active compaction is BUSY — neutral ink, not blue */}
            {row.active ? <span className="ml-1 text-ink-2">⟲</span> : null}
            <span className="ml-auto t-value face-mono text-ink-2">
              {fmtTok(row.tok)}
              {row.cap ? ` / ${fmtTok(row.cap)}` : ""}
            </span>
          </span>
        ))}
        <span className="mt-0.5 t-caption text-ink-2">
          {fmtTok(inContext)} in context · tinted = loaded, empty = headroom to compaction
        </span>
      </span>
    </Press>
  );
}
