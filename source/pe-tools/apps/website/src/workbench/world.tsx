import { useRef, useState } from "react";
import type { WorkbenchContextBreakdown, WorkbenchContextItem } from "@pe/agent-contracts";
import {
  blastOf,
  BLAST_LABEL,
  cacheTotals,
  computeCacheView,
  orderedLayers,
  signatureMap,
  type Blast,
  type CacheState,
  type CacheView,
  type Layer,
} from "./world-cache.ts";

/**
 * The World inspector — "what Pea actually sent the model", ordered by request position
 * (tools → system → messages), the same order that drives prompt-cache reuse. Renders from
 * `inspector.contextBreakdown` (the same data the old chat-top ContextMeter used), now with
 * the tools layer restored at position 0. The cache-position logic lives in `world-cache.ts`.
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
  skills: "var(--moss, #6a9b7a)",
  memory: "var(--clay, #c89b6a)",
  messages: "var(--slate, #8a9199)",
};

function tone(id: string): string {
  return SEGMENT_TONES[id] ?? "var(--slate, #8a9199)";
}

function fmtTok(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
}

function CacheBadge({ state }: { state: CacheState }) {
  if (state === "unknown") return null;
  return (
    <span
      className={`mg-cache ${state}`}
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
  const layers = orderedLayers(breakdown);
  const used = layers.reduce((sum, layer) => sum + layer.tokens, 0) || 1;
  const showHorizon = diff && cache.hasBaseline && cache.horizonRank !== null;
  const totals = cacheTotals(layers, cache);

  if (layers.length === 0) {
    return (
      <div className="mg-world" data-density={density}>
        <div className="mg-world-empty">
          Nothing sent yet. Ask Pea something to populate the context.
        </div>
      </div>
    );
  }

  // cumulative width (%) up to the first reprocessed layer — where the cache broke.
  let horizonPct = 0;
  if (showHorizon) {
    for (const layer of layers) {
      if (layer.rank >= (cache.horizonRank as number)) break;
      horizonPct += (layer.tokens / used) * 100;
    }
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
    <div className="mg-world" data-density={density} data-diff={diff ? "1" : "0"}>
      <div className="mg-world-head">
        <h2 className="mg-world-title">What the agent sends the model</h2>
        <div className="mg-world-controls">
          <div className="mg-world-dial" role="group" aria-label="density">
            <button
              type="button"
              aria-pressed={density === "plain"}
              onClick={() => setDensity("plain")}
            >
              Plain
            </button>
            <button
              type="button"
              aria-pressed={density === "inspect"}
              onClick={() => setDensity("inspect")}
            >
              Inspect
            </button>
          </div>
          <button
            type="button"
            className="mg-world-diff"
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

      <div className="mg-world-sub">
        {sendNumber ? <span className="mg-world-snap">snapshot @ send #{sendNumber}</span> : null}
        <span>resolved from the live agent</span>
      </div>

      {cache.hasBaseline ? (
        <div className="mg-cacheout">
          <div className="mg-cacheout-row">
            <span className="k read" />
            cache-read · 0.1×<span className="v">{fmtTok(totals.cached)}</span>
          </div>
          <div className="mg-cacheout-row">
            <span className="k rep" />
            reprocessed · 1×<span className="v">{fmtTok(totals.reprocessed)}</span>
          </div>
          {diff && cache.changed.size > 0 && cache.horizonRank !== null ? (
            <div className="mg-cacheout-why">
              <b>Δ this send:</b> {whySentence(layers, cache, totals.reprocessed)}
            </div>
          ) : null}
        </div>
      ) : null}

      {breakdown ? <ContextBudgetBar breakdown={breakdown} /> : null}

      <div className="mg-world-bar" role="img" aria-label="Relative context load by layer">
        {layers.map((layer) => (
          <span
            key={layer.id}
            className={`mg-world-fill ${diff && cache.stateOf(layer.id) === "reprocessed" ? "reproc" : ""}`}
            style={{ width: `${(layer.tokens / used) * 100}%`, background: tone(layer.id) }}
            title={`${layer.label} · ${fmtTok(layer.tokens)} tok`}
          />
        ))}
        {showHorizon ? (
          <span className="mg-world-horizon" style={{ left: `${horizonPct}%` }} />
        ) : null}
      </div>
      {showHorizon ? (
        <div className="mg-world-note">
          ⚡ cache broke at <b>{frontLayerName(layers, cache)}</b> — everything below it was
          reprocessed this send.
        </div>
      ) : null}

      <div className="mg-world-layers">
        {layers.map((layer) => {
          const isOpen = open.has(layer.id);
          const changed = diff && cache.changed.has(layer.id);
          const blast = blastOf(layer.rank);
          return (
            <div
              className={`mg-world-layer ${isOpen ? "open" : ""} ${changed ? "delta" : ""}`}
              key={layer.id}
            >
              <button className="mg-world-row" type="button" onClick={() => toggle(layer.id)}>
                <span className="mg-world-dot" style={{ background: tone(layer.id) }} />
                <span className="mg-world-name">
                  {layer.label}
                  <span className="mg-world-pos">pos {layer.rank}</span>
                </span>
                <CacheBadge state={cache.stateOf(layer.id)} />
                <span className="mg-world-tok">{fmtTok(layer.tokens)}</span>
                <span className="mg-world-pct">{((layer.tokens / used) * 100).toFixed(0)}%</span>
                <span className="mg-world-car">▸</span>
              </button>
              {isOpen ? (
                <div className="mg-world-body">
                  <p className="mg-world-cap">{PLAIN_CAP[layer.id] ?? layer.label}</p>
                  {changed ? (
                    <p className="mg-world-drift">
                      ⚡ changed this send → <b>{BLAST_LABEL[blast]}</b>. {driftHint(blast)}
                    </p>
                  ) : null}
                  {layer.items.length > 0 ? (
                    <ul className="mg-world-items">
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

      <div className="mg-world-foot">
        cache state <span className="mg-cache cached">≈ inferred</span> from a frontend snapshot
        diff — the provider only reports aggregate cache totals.
      </div>
    </div>
  );
}

function frontLayerName(layers: Layer[], cache: CacheView): string {
  const front = layers.find((layer) => layer.rank === cache.horizonRank);
  return front?.label ?? "the changed layer";
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
    <li className={`mg-item ${open ? "open" : ""}`}>
      <button
        className="mg-item-head"
        type="button"
        disabled={!hasBody}
        onClick={() => hasBody && onToggle()}
      >
        <span className="mg-item-main">
          <span className="mg-item-name">{item.name}</span>
          {item.src ? <span className="mg-item-src">{item.src}</span> : null}
        </span>
        <span className="mg-item-right">
          {blast ? <span className={`mg-blast ${blast}`}>{BLAST_LABEL[blast]}</span> : null}
          {item.state ? (
            <span className={`mg-pill ${item.state}`}>{PILL_LABEL[item.state]}</span>
          ) : null}
          {item.tokens != null ? <span className="mg-item-tok">{fmtTok(item.tokens)}</span> : null}
          {hasBody ? <span className="mg-item-car">▸</span> : null}
        </span>
      </button>
      {open && hasBody ? <pre className="mg-item-body">{item.body}</pre> : null}
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

/**
 * The standard context bar, folded onto the OM budget. Shows every category — the fixed
 * prefix (tools/system/skills) plus the two observational-memory windows (messages → observe,
 * observations → reflect). Each OM window is allocated its threshold width, so its fill reads
 * directly as "headroom to compaction"; the trigger lines fall at the region boundaries. Only
 * renders when the runtime reports OM windows (`breakdown.memoryWindows`).
 */
function ContextBudgetBar({ breakdown }: { breakdown: WorkbenchContextBreakdown }) {
  const mw = breakdown.memoryWindows;
  if (!mw || mw.observationThreshold <= 0 || mw.reflectionThreshold <= 0) return null;
  const segTok = (id: string) => breakdown.segments.find((s) => s.id === id)?.tokens ?? 0;
  const tools = segTok("tools");
  const system = segTok("system-prompt");
  const skills = segTok("skills");
  const prefix = tools + system + skills;
  const budget = prefix + mw.observationThreshold + mw.reflectionThreshold;
  const inContext = prefix + mw.messageTokens + mw.observationTokens;
  const fillPct = (value: number, denom: number) =>
    `${Math.max(0, Math.min(100, denom > 0 ? (value / denom) * 100 : 0))}%`;
  const over =
    mw.messageTokens > mw.observationThreshold || mw.observationTokens > mw.reflectionThreshold;
  const observeAt = ((prefix + mw.observationThreshold) / budget) * 100;

  return (
    <div className="mg-budget">
      <div className="mg-budget-head">
        <b>Context budget</b>
        <span>
          {fmtTok(inContext)} / {fmtTok(budget)} · OM windows
        </span>
      </div>
      <div className={`mg-budget-bar ${over ? "over" : ""}`}>
        <span className="mg-bud-seg" style={{ flexGrow: tools, background: tone("tools") }} />
        <span
          className="mg-bud-seg"
          style={{ flexGrow: system, background: tone("system-prompt") }}
        />
        {skills > 0 ? (
          <span className="mg-bud-seg" style={{ flexGrow: skills, background: tone("skills") }} />
        ) : null}
        <span className="mg-bud-region" style={{ flexGrow: mw.observationThreshold }}>
          <span
            className={`mg-bud-rfill ${mw.observing ? "active" : ""}`}
            style={{
              width: fillPct(mw.messageTokens, mw.observationThreshold),
              background: tone("messages"),
            }}
          />
        </span>
        <span className="mg-bud-region" style={{ flexGrow: mw.reflectionThreshold }}>
          <span
            className={`mg-bud-rfill ${mw.reflecting ? "active" : ""}`}
            style={{
              width: fillPct(mw.observationTokens, mw.reflectionThreshold),
              background: tone("memory"),
            }}
          />
          {mw.reflectionFloor ? (
            <span
              className="mg-bud-floor"
              style={{ left: fillPct(mw.reflectionFloor, mw.reflectionThreshold) }}
              title={`reflect floor · ${fmtTok(mw.reflectionFloor)}`}
            />
          ) : null}
        </span>
      </div>
      <div className="mg-budget-ticks">
        <span style={{ left: `${observeAt}%` }}>observe {fmtTok(mw.observationThreshold)}</span>
        <span style={{ left: "100%", transform: "translateX(-100%)" }}>
          budget {fmtTok(budget)}
        </span>
      </div>
      <div className="mg-budget-rows">
        <BudgetRow id="tools" label="Tools" tokens={tools} />
        <BudgetRow id="system-prompt" label="System" tokens={system} />
        {skills > 0 ? <BudgetRow id="skills" label="Skills" tokens={skills} /> : null}
        <BudgetRow
          id="messages"
          label="Messages → observe"
          tokens={mw.messageTokens}
          threshold={mw.observationThreshold}
          active={mw.observing}
        />
        <BudgetRow
          id="memory"
          label="Observations → reflect"
          tokens={mw.observationTokens}
          threshold={mw.reflectionThreshold}
          active={mw.reflecting}
        />
      </div>
    </div>
  );
}

function BudgetRow({
  id,
  label,
  tokens,
  threshold,
  active,
}: {
  id: string;
  label: string;
  tokens: number;
  threshold?: number;
  active?: boolean;
}) {
  return (
    <div className="mg-budget-row">
      <span className="mg-budget-dot" style={{ background: tone(id) }} />
      <span>
        {label}
        {active ? <span className="mg-budget-flag">⟲ active</span> : null}
      </span>
      <span className="mg-budget-rtok">
        {fmtTok(tokens)}
        {threshold ? ` / ${fmtTok(threshold)}` : ""}
      </span>
      {threshold ? (
        <span className="mg-budget-rpct">{Math.round((tokens / threshold) * 100)}%</span>
      ) : (
        <span className="mg-budget-rpct" />
      )}
    </div>
  );
}

/**
 * The gutter companion: a tiny request-ordered stack pinned at the top of the MapDial, with a
 * cache-horizon tick and a delta pulse. Hover reveals the layer list; click opens World mode.
 */
export function ContextGutter({
  breakdown,
  cache,
  onOpenWorld,
}: {
  breakdown: WorkbenchContextBreakdown | undefined;
  cache: CacheView;
  onOpenWorld?: () => void;
}) {
  const layers = orderedLayers(breakdown);
  if (layers.length === 0) return null;
  const used = layers.reduce((sum, layer) => sum + layer.tokens, 0) || 1;
  const pulsing = cache.changed.size > 0;
  const mw = breakdown?.memoryWindows;

  let horizonPct: number | null = null;
  if (cache.hasBaseline && cache.horizonRank !== null) {
    horizonPct = 0;
    for (const layer of layers) {
      if (layer.rank >= cache.horizonRank) break;
      horizonPct += (layer.tokens / used) * 100;
    }
  }

  return (
    <button
      type="button"
      className={`mg-gut ${pulsing ? "pulse" : ""}`}
      onClick={onOpenWorld}
      title="What Pea sent the model — click to open"
      aria-label="Context composition"
    >
      <span className="mg-gut-cols">
        <span className="mg-gut-stack">
          {layers.map((layer) => (
            <span
              key={layer.id}
              className="mg-gut-seg"
              style={{ height: `${(layer.tokens / used) * 100}%`, background: tone(layer.id) }}
            />
          ))}
          {horizonPct !== null ? (
            <span className="mg-gut-horizon" style={{ top: `${horizonPct}%` }} />
          ) : null}
        </span>
        {mw ? <GutterStrata mw={mw} /> : null}
      </span>
      <span className="mg-gut-pop">
        {layers.map((layer) => (
          <span className="mg-gut-poprow" key={layer.id}>
            <span className="mg-gut-popdot" style={{ background: tone(layer.id) }} />
            {layer.label}
            <span className="mg-gut-poptok">{fmtTok(layer.tokens)}</span>
          </span>
        ))}
        <span className="mg-gut-pophint">click to inspect</span>
      </span>
    </button>
  );
}

/**
 * The memory strata — the two OM windows as a budget column beside the layer stack. Lower
 * region = messages window (height = observation threshold), upper = observations window
 * (height = reflection threshold). Each fills toward its compaction trigger; the clay floor
 * mark is the last reflect's low-water. Reflect is an in-place shrink (a pulse), not a tier.
 */
function GutterStrata({ mw }: { mw: NonNullable<WorkbenchContextBreakdown["memoryWindows"]> }) {
  const budget = mw.observationThreshold + mw.reflectionThreshold;
  if (budget <= 0) return null;
  const pct = (value: number, denom: number) =>
    `${Math.max(0, Math.min(100, denom > 0 ? (value / denom) * 100 : 0))}%`;
  const title =
    `memory windows · messages ${fmtTok(mw.messageTokens)} / ${fmtTok(mw.observationThreshold)} (observe) · ` +
    `observations ${fmtTok(mw.observationTokens)} / ${fmtTok(mw.reflectionThreshold)} (reflect)`;
  return (
    <span className={`mg-gut-strata ${mw.reflecting ? "reflecting" : ""}`} title={title}>
      <span
        className="mg-gut-region obs"
        style={{ flexBasis: `${(mw.reflectionThreshold / budget) * 100}%` }}
      >
        <span
          className={`mg-gut-rfill ${mw.reflecting ? "active" : ""}`}
          style={{
            height: pct(mw.observationTokens, mw.reflectionThreshold),
            background: tone("memory"),
          }}
        />
        {mw.reflectionFloor ? (
          <span
            className="mg-gut-floor"
            style={{ bottom: pct(mw.reflectionFloor, mw.reflectionThreshold) }}
          />
        ) : null}
      </span>
      <span
        className="mg-gut-region msg"
        style={{ flexBasis: `${(mw.observationThreshold / budget) * 100}%` }}
      >
        <span
          className={`mg-gut-rfill ${mw.observing ? "active" : ""}`}
          style={{
            height: pct(mw.messageTokens, mw.observationThreshold),
            background: tone("messages"),
          }}
        />
      </span>
    </span>
  );
}
