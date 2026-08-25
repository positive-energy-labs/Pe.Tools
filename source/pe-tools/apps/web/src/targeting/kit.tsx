/**
 * TARGETING kit — the mechanics every rendering shares.
 *
 *   useBindings  — bound ids per link over CALLER-OWNED state (a route's URL search);
 *                  picking a trunk clears its descendants (waterfall).
 *   Picker       — ONE control per terminal. Closed: the leaf, or where the pick stopped.
 *                  Open: crumbs (the trunk) · search · the current level's list.
 *   StageStrip   — stage tabs carrying the readiness meter.
 *   PaneStrip    — a pane whose `draws` are unbound or undemanded is disabled, and says why.
 *   SeamChip     — the page-level derived seam chip ("r10 unsourced · 2 verbs unwired").
 *   peaNote      — pea's line, only when a wired verb is blocked by an unbound demand.
 *
 * GLANCE LAW: first glance = leaf noun · unbound caution · in-flight pulse; second look = the
 * small mute caption (direction · liveness · freshness); hover = full path + needs.
 * The in-flight mark is an OPACITY pulse — dashed stays the seam slot.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

import { FactChip } from "#/components/lang/chip";

import {
  demandedKeys,
  isBound as isBoundIn,
  pathOf,
  pickInto,
  progress,
  refusal,
  seams,
  type Bound,
  type Feeds,
  type Link,
  type Multi,
  type Option,
  type Pane,
  type Product,
  type Stage,
  type Verb,
} from "#/targeting/model";

/* ------------------------------------------------------------------ bindings */

export interface Bindings {
  bound: Bound;
  multi: Multi;
  feeds: Feeds;
  labelOf: (link: Link) => string | null;
  optionsOf: (link: Link) => Option[] | null;
  isPicked: (link: Link, id: string) => boolean;
  pick: (link: Link, id: string) => void;
  isBound: (link: Link) => boolean;
  open: string | null;
  setOpen: (key: string | null) => void;
  pickerLevel: string | null;
  setPickerLevel: (key: string) => void;
  pickerQuery: string;
  setPickerQuery: (query: string) => void;
  stage: Stage;
  setStage: (key: string) => void;
  demanded: Set<string>;
}

export interface BindingState {
  bound: Bound;
  multi: Multi;
  stage: string;
}

/**
 * The caller owns the state and hands in its setters; this hook owns the waterfall and derived
 * reads. Options come from `feeds`, so the hook never invents them.
 */
export function useBindings(
  product: Product,
  feeds: Feeds,
  state: BindingState,
  setState: (patch: Partial<BindingState>) => void,
  open: string | null,
  setOpen: (key: string | null) => void,
  pickerLevel: string | null,
  setPickerLevel: (key: string) => void,
  pickerQuery: string,
  setPickerQuery: (query: string) => void,
): Bindings {
  const stage = product.stages.find((s) => s.key === state.stage) ?? product.stages[0]!;
  const demanded = useMemo(() => demandedKeys(stage), [stage]);
  const { bound, multi } = state;

  const optionsOf = useCallback((link: Link) => feeds[link.key]?.options ?? null, [feeds]);
  const labelOf = useCallback(
    (link: Link) => {
      if (link.multi) {
        const picked = multi[link.key];
        const all = optionsOf(link);
        return picked && picked.size > 0
          ? `${picked.size} of ${all?.length ?? "?"} ${link.key}`
          : null;
      }
      const id = bound[link.key];
      if (id == null) return null;
      return optionsOf(link)?.find((o) => o.id === id)?.label ?? id;
    },
    [bound, multi, optionsOf],
  );
  const isBound = useCallback((link: Link) => isBoundIn(link, bound, multi), [bound, multi]);
  const isPicked = useCallback(
    (link: Link, id: string) =>
      link.multi ? (multi[link.key]?.has(id) ?? false) : bound[link.key] === id,
    [bound, multi],
  );
  const pick = useCallback(
    (link: Link, id: string) => setState(pickInto(product, bound, multi, link, id)),
    [product, bound, multi, setState],
  );

  return {
    bound,
    multi,
    feeds,
    labelOf,
    optionsOf,
    isPicked,
    pick,
    isBound,
    open,
    setOpen,
    pickerLevel,
    setPickerLevel,
    pickerQuery,
    setPickerQuery,
    stage,
    setStage: (key) => setState({ stage: key }),
    demanded,
  };
}

/** Close-on-outside-click for a popover root. Stabilise `onAway` with useCallback. */
export function useClickAway(open: boolean, onAway: () => void) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onAway();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onAway]);
  return ref;
}

/* ------------------------------------------------------------------ runner */

export interface Runner {
  /** Verb key in flight, if any (the host runs one transaction at a time). */
  busy: string | null;
  /** Link keys being read/written right now — the pulse source. */
  active: Set<string>;
  run: (verb: Verb) => void;
  canRun: (verb: Verb) => { ok: boolean; reason: string };
}

/**
 * Projects the store's serialized verb bracket so the head knows which verb is in flight and which
 * links it touches. `exec` invokes the verb; the store owns busy, failure, receipt, and timing.
 */
export function useRunner(
  product: Product,
  b: Bindings,
  exec: (label: string, work: () => Promise<string | void>) => Promise<void>,
  busyLabel: string | null,
): Runner {
  const busyVerb = product.stages
    .flatMap((stage) => stage.verbs)
    .find((verb) => verb.key === busyLabel);
  const active = useMemo(() => new Set(busyVerb?.demands ?? []), [busyVerb]);

  const canRun = useCallback(
    (verb: Verb) => {
      const why = refusal(product, verb, b.bound, b.multi, b.feeds);
      if (why) return { ok: false, reason: why };
      if (busyLabel !== null) return { ok: false, reason: `${busyLabel} is in flight` };
      return { ok: true, reason: `${verb.label} on ${verb.demands.join(", ") || "nothing"}` };
    },
    [product, b, busyLabel],
  );

  const run = useCallback(
    (verb: Verb) => {
      if (!verb.run || !canRun(verb).ok) return;
      void exec(verb.label, verb.run);
    },
    [canRun, exec],
  );

  return { busy: busyVerb?.key ?? null, active, run, canRun };
}

/* ------------------------------------------------------------------ panes */

export function paneState(
  product: Product,
  pane: Pane,
  b: Bindings,
): { ok: boolean; reason: string } {
  for (const k of pane.draws) {
    const link = product.links.find((l) => l.key === k);
    if (!link) continue;
    if (!b.isBound(link)) return { ok: false, reason: `${pane.label} draws from ${k} — unbound` };
    if (!b.demanded.has(k) && link.dir !== undefined)
      return {
        ok: false,
        reason: `${pane.label} draws from ${k} — out of scope at ${b.stage.label}`,
      };
  }
  return { ok: true, reason: `${pane.label} draws from ${pane.draws.join(", ") || "nothing"}` };
}

/* ------------------------------------------------------------------ seam chip */

export function SeamChip({ product, feeds }: { product: Product; feeds: Feeds }) {
  const list = seams(product, feeds);
  if (list.length === 0) return null;
  const fixtures = list.filter((s) => s.kind === "fixture");
  const gaps = list.filter((s) => s.kind === "options");
  const verbs = list.filter((s) => s.kind === "verb");
  const text = [
    fixtures.length ? `${fixtures.map((s) => s.subject).join(", ")} from fixture` : null,
    gaps.length ? `${gaps.map((s) => s.subject).join(", ")} unsourced` : null,
    verbs.length ? `${verbs.length} verb${verbs.length > 1 ? "s" : ""} unwired` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = list.map((s) => `${s.subject}: needs ${s.needs}`).join("\n");
  return (
    <FactChip dashed title={title}>
      {text}
    </FactChip>
  );
}

/* ------------------------------------------------------------------ freshness */

/** Second-look caption for a feed: freshness in one word, mute. */
export function freshnessWord(b: Bindings, link: Link): string | null {
  const f = b.feeds[link.key];
  if (!f) return null;
  switch (f.state) {
    case "live":
      return "live";
    case "fresh":
      return f.at ? `read at ${new Date(f.at).toLocaleTimeString()}` : "read";
    case "stale":
      return "stale";
    case "loading":
      return "reading…";
    case "error":
      return "read failed";
    case "fixture":
      return "fixture";
  }
}

/* ------------------------------------------------------------------ picker */

/** The ONE in-flight mark. Opacity only — dashed stays the seam slot. */
export const PULSE_CSS = "@keyframes tp-pulse{0%,100%{opacity:.15}50%{opacity:1}}";

const POP: React.CSSProperties = {
  border: "1px solid var(--r-line-2)",
  background: "var(--r-page)",
  boxShadow: "0 2px 8px color-mix(in srgb, var(--r-ink) 8%, transparent)",
  minWidth: 320,
};

/**
 * ONE PICKER PER TERMINAL. Closed: the leaf label when the chain is picked through, else
 * `<deepest bound> › <next placeholder>` in caution (where the pick stopped). Open: the whole
 * chain as crumbs, a search field, and the current level's list; picking a level auto-advances.
 * Keyed by the terminal; a trunk two terminals share re-picks from either (state is per link).
 * `extra(link)` lets a route append its own control to a level's list (an "add folder" field).
 */
export function Picker({
  product,
  link,
  b,
  runner,
  extra,
  inert,
}: {
  product: Product;
  link: Link;
  b: Bindings;
  runner?: Runner;
  extra?: (link: Link) => React.ReactNode;
  /** Out of scope at this stage: renders dim and inert (no picker opens). */
  inert?: boolean;
}) {
  const chain = pathOf(product, link.key);
  const slot = `pick:${link.key}`;
  const open = b.open === slot;
  const close = useCallback(() => b.setOpen(null), [b.setOpen]);
  const ref = useClickAway(open, close);
  const level = b.pickerLevel ?? link.key;
  const setLevel = b.setPickerLevel;
  const q = b.pickerQuery;
  const setQ = b.setPickerQuery;
  const p = progress(chain, b.bound, b.multi);
  useEffect(() => {
    if (!open) return;
    setLevel((p.next ?? link).key);
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lit = runner?.active.has(link.key) ?? false;
  const feed = b.feeds[link.key];
  const broken = feed?.state === "stale" || feed?.state === "error";
  const leafLabel = b.labelOf(link);
  const caution = !p.complete || broken;
  // incomplete: only the next placeholder prints; the caution colour says "not through yet"
  // and the title carries where it stopped (kaitpw, round 7 verdict)
  const closedText = p.complete ? (leafLabel ?? link.placeholder) : p.next!.placeholder;
  const title = [
    chain.map((l) => `${l.key}: ${b.labelOf(l) ?? "unbound"}`).join(" › "),
    `${link.dir}${link.liveness ? ` · ${link.liveness}` : ""}`,
    freshnessWord(b, link),
    feed?.note ?? null,
    p.complete ? null : `needs ${p.next!.needs}`,
    feed?.options === null ? "seam — no legal option source yet" : null,
    lit ? "in flight" : null,
  ]
    .filter(Boolean)
    .join("\n");

  const cur = chain.find((l) => l.key === level) ?? link;
  const curFeed = b.feeds[cur.key];
  const opts = b.optionsOf(cur);
  const match = (o: Option) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const hits = (opts ?? []).filter(match);
  // one level down, only from the feed already in hand (the bound parent's children) — a
  // deeper search would fan out one host read per option (kaitpw: waterfall risk)
  const below = chain[chain.indexOf(cur) + 1];
  const belowHits =
    q && below && b.isBound(cur) && !cur.multi ? (b.optionsOf(below) ?? []).filter(match) : [];
  const advance = () => {
    if (cur.multi) return;
    const next = chain[chain.indexOf(cur) + 1];
    if (next) setLevel(next.key);
    else b.setOpen(null);
    setQ("");
  };

  return (
    <span ref={ref} className="relative inline-flex items-baseline">
      <style>{PULSE_CSS}</style>
      <button
        type="button"
        onClick={() => {
          if (!open) setLevel(link.key);
          b.setOpen(open ? null : slot);
        }}
        disabled={inert}
        title={title}
        className="face-mono t-label"
        style={{
          padding: 0,
          cursor: inert ? "not-allowed" : "pointer",
          background: open ? "var(--r-select)" : "transparent",
          borderBottom: `1px solid ${caution ? "var(--r-caution)" : "var(--r-ink)"}`,
          color: caution ? "var(--r-caution)" : "var(--r-ink)",
          whiteSpace: "nowrap",
          animation: lit ? "tp-pulse 0.9s ease-in-out infinite" : undefined,
        }}
      >
        {closedText}
      </button>
      {open ? (
        <span className="absolute left-0 top-full z-40 mt-1 block overflow-hidden" style={POP}>
          {/* crumbs — the trunk, one segment per level; the current level is underlined */}
          <div
            className="flex flex-wrap items-baseline gap-1 px-2 pt-1.5 pb-1"
            style={{ borderBottom: "1px solid var(--r-line-2)" }}
          >
            {chain.map((l, i) => {
              const on = l.key === level;
              const lab = b.labelOf(l);
              return (
                <span key={l.key} className="inline-flex items-baseline gap-1">
                  {i > 0 ? (
                    <span className="face-mono t-caption" style={{ color: "var(--r-ink-mute)" }}>
                      ›
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => (setLevel(l.key), setQ(""))}
                    className="face-mono t-caption"
                    style={{
                      padding: "0 3px",
                      background: on ? "var(--r-select)" : "transparent",
                      color: lab == null ? "var(--r-caution)" : "var(--r-ink)",
                      borderBottom: on ? "1px solid var(--r-ink)" : "1px solid transparent",
                    }}
                  >
                    {lab ?? l.placeholder}
                  </button>
                </span>
              );
            })}
          </div>
          {/* search — the current level only; the crumbs are how you move levels */}
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) {
                b.pick(cur, hits[0].id);
                advance();
              }
              if (e.key === "Escape") b.setOpen(null);
            }}
            placeholder={`search ${cur.key}${opts ? ` · ${opts.length}` : ""}`}
            className="t-value w-full px-2 py-1"
            style={{
              background: "transparent",
              borderBottom: "1px solid var(--r-line-2)",
              outline: "none",
              color: "var(--r-ink)",
            }}
          />
          <div className="max-h-64 overflow-y-auto py-1">
            {opts === null ? (
              <div className="t-caption px-2 py-1" style={{ color: "var(--r-caution)" }}>
                no legal options — needs {cur.needs}
              </div>
            ) : curFeed?.state === "error" ? (
              <div className="t-caption px-2 py-1" style={{ color: "var(--r-caution)" }}>
                {curFeed.note ?? "read failed"}
              </div>
            ) : opts.length === 0 ? (
              <div className="t-caption px-2 py-1" style={{ color: "var(--r-ink-2)" }}>
                {curFeed?.state === "loading"
                  ? "reading…"
                  : cur.parent && b.bound[cur.parent] == null
                    ? `bind ${cur.parent} first`
                    : cur.needs}
              </div>
            ) : hits.length === 0 ? (
              <div className="t-caption px-2 py-1" style={{ color: "var(--r-ink-2)" }}>
                no match
              </div>
            ) : (
              hits.map((o) => {
                const on = b.isPicked(cur, o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      b.pick(cur, o.id);
                      advance();
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left"
                    style={{ background: on ? "var(--r-select)" : undefined }}
                  >
                    {cur.multi ? (
                      <span className="face-mono t-caption">{on ? "☑" : "☐"}</span>
                    ) : null}
                    <span className="t-value" style={{ color: "var(--r-ink)" }}>
                      {o.label}
                    </span>
                    {o.sub ? (
                      <span className="t-caption" style={{ color: "var(--r-ink-2)" }}>
                        {o.sub}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
            {belowHits.length > 0 ? (
              <>
                <div
                  className="face-mono t-caption t-upper px-2 pt-1.5"
                  style={{ color: "var(--r-ink-mute)", borderTop: "1px solid var(--r-line-2)" }}
                >
                  {b.labelOf(cur)} › {below!.key}
                </div>
                {belowHits.map((o) => (
                  <button
                    key={`below:${o.id}`}
                    type="button"
                    onClick={() => {
                      b.pick(below!, o.id);
                      const after = chain[chain.indexOf(below!) + 1];
                      if (after && !below!.multi) setLevel(after.key);
                      else if (!below!.multi) b.setOpen(null);
                      setQ("");
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left"
                    style={{ background: b.isPicked(below!, o.id) ? "var(--r-select)" : undefined }}
                  >
                    {below!.multi ? (
                      <span className="face-mono t-caption">
                        {b.isPicked(below!, o.id) ? "☑" : "☐"}
                      </span>
                    ) : null}
                    <span className="t-value" style={{ color: "var(--r-ink)" }}>
                      {o.label}
                    </span>
                    {o.sub ? (
                      <span className="t-caption" style={{ color: "var(--r-ink-2)" }}>
                        {o.sub}
                      </span>
                    ) : null}
                  </button>
                ))}
              </>
            ) : null}
            {extra?.(cur)}
          </div>
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ shared strips */

/** Stage tabs carrying the readiness meter. Brutalist: hard cells, one ink rule, no radius. */
export function StageStrip({
  product,
  b,
  runner,
  meter = true,
  trailing,
}: {
  product: Product;
  b: Bindings;
  runner: Runner;
  meter?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-stretch"
      role="tablist"
      style={{ borderTop: "1px solid var(--r-ink)", borderBottom: "1px solid var(--r-line-2)" }}
    >
      {product.stages.map((s, i) => {
        const ready = s.verbs.filter((v) => runner.canRun(v).ok).length;
        const on = b.stage.key === s.key;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => b.setStage(s.key)}
            title={`${s.label}: ${ready} of ${s.verbs.length} verbs runnable — ${s.verbs
              .map((v) => {
                const c = runner.canRun(v);
                return c.ok ? `${v.label}: ready` : `${v.label}: ${c.reason}`;
              })
              .join(" · ")}`}
            className="face-mono t-caption t-upper flex items-baseline gap-2 px-2.5 py-1"
            style={{
              borderLeft: i > 0 ? "1px solid var(--r-line-2)" : undefined,
              background: on ? "var(--r-select)" : "transparent",
              boxShadow: on ? "inset 0 -2px 0 var(--r-ink)" : undefined,
              color: on ? "var(--r-ink)" : "var(--r-ink-2)",
            }}
          >
            <span>{s.label}</span>
            {meter ? (
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  color: ready === 0 ? "var(--r-ink-mute)" : "var(--r-ink)",
                }}
              >
                {ready}/{s.verbs.length}
              </span>
            ) : null}
          </button>
        );
      })}
      <span className="flex-1" />
      {trailing}
    </div>
  );
}

/** Pane strip — demands gate panes, made visible. Disabled panes read as locked text and say why. */
export function PaneStrip({ product, b }: { product: Product; b: Bindings }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="face-mono t-caption t-upper" style={{ color: "var(--r-ink-mute)" }}>
        panes
      </span>
      {product.panes.map((p) => {
        const st = paneState(product, p, b);
        return (
          <span
            key={p.key}
            title={st.reason}
            className="face-mono t-caption"
            style={{
              color: st.ok ? "var(--r-ink)" : "var(--r-ink-mute)",
              fontStyle: st.ok ? undefined : "italic",
              borderBottom: st.ok ? "1px solid var(--r-line-2)" : "1px solid transparent",
            }}
          >
            {p.label}
          </span>
        );
      })}
    </span>
  );
}

/** Pea's line — ONLY when a wired verb is blocked by an unbound demand. Null otherwise. */
export function peaNote(product: Product, b: Bindings, runner: Runner): string | null {
  const missing = new Set<string>();
  for (const v of b.stage.verbs) {
    if (v.run === null || runner.canRun(v).ok) continue;
    for (const k of v.demands) {
      const l = product.links.find((x) => x.key === k);
      if (l && !b.isBound(l)) missing.add(l.placeholder);
    }
  }
  if (missing.size === 0) return null;
  const verbs = b.stage.verbs.map((v) => v.label).join(" or ");
  return `before I can ${verbs} I still need you to ${[...missing].join(" and ")}.`;
}
