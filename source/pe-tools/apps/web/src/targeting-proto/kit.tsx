/**
 * PROTOTYPE — round-5 shared kit. Throwaway with the round.
 *
 * Every view uses these so variants compare RENDERING, never mechanics:
 *   useBindings  — bound ids per link; picking a parent clears its descendants (waterfall).
 *   useRunner    — mock in-flight state per verb (the pulse source of truth).
 *   PathInput    — ONE input per path; closed = leaf, open = segmented | columns | search.
 *   StageStrip   — stage tabs carrying the readiness meter (board's round-4 win, shared).
 *   PaneStrip    — Q4 ruling: a pane whose `draws` are unbound or undemanded is disabled.
 *   SeamChip     — the page-level derived seam chip ("reads a fixture until …").
 *   peaNote      — pea's line, only when a demand is missing.
 *
 * GLANCE LAW (kaitpw, round 4): first glance = leaf noun · unbound caution · in-flight pulse;
 * second look = the small mute caption (direction · liveness); hover = full path + needs.
 * The in-flight mark is an OPACITY pulse — dashed stays the seam slot (R13b).
 */
import { Button as ChoicePrimitive } from "@base-ui/react/button";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { FactChip } from "#/components/lang/chip";

import {
  demandedKeys,
  optionsFor,
  pathOf,
  seams,
  type Link,
  type Option,
  type Pane,
  type Product,
  type Stage,
  type Verb,
} from "#/targeting-proto/model";

function Choice({
  children,
  reason,
  selected,
  busy,
  onClick,
  className,
  style,
}: {
  children: ReactNode;
  reason: string;
  selected?: boolean;
  busy?: boolean;
  onClick: () => void;
  className?: string;
  style?: ChoicePrimitive.Props["style"];
}) {
  const props: ChoicePrimitive.Props = {
    type: "button",
    "aria-pressed": selected,
    "aria-busy": busy || undefined,
    title: reason,
    onClick,
    className,
    style,
    children,
  };
  return createElement(ChoicePrimitive, props);
}

/* ------------------------------------------------------------------ bindings */

export type Bound = Record<string, string | null>;
export type Multi = Record<string, Set<string>>;

export interface Bindings {
  bound: Bound;
  multi: Multi;
  labelOf: (link: Link) => string | null;
  optionsOf: (link: Link) => Option[] | null;
  isPicked: (link: Link, id: string) => boolean;
  pick: (link: Link, id: string) => void;
  /** Bind several links of one path at once (search input); clears below the deepest. */
  pickPath: (picks: { link: Link; id: string }[]) => void;
  isBound: (link: Link) => boolean;
  open: string | null;
  setOpen: (key: string | null) => void;
  stage: Stage;
  setStage: (key: string) => void;
  demanded: Set<string>;
}

function descendants(product: Product, key: string): string[] {
  const kids = product.links.filter((l) => l.parent === key).map((l) => l.key);
  return kids.flatMap((k) => [k, ...descendants(product, k)]);
}

export function useBindings(product: Product): Bindings {
  const [bound, setBound] = useState<Bound>(() =>
    Object.fromEntries(product.links.filter((l) => !l.multi).map((l) => [l.key, l.bound])),
  );
  const [multi, setMulti] = useState<Multi>(() =>
    Object.fromEntries(product.links.filter((l) => l.multi).map((l) => [l.key, new Set<string>()])),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [stageKey, setStage] = useState(product.stages[0]!.key);
  const stage = product.stages.find((s) => s.key === stageKey) ?? product.stages[0]!;
  const demanded = useMemo(() => demandedKeys(stage), [stage]);

  const optionsOf = useCallback((link: Link) => optionsFor(product, link, bound), [product, bound]);
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
  const isBound = useCallback(
    (link: Link) => (link.multi ? (multi[link.key]?.size ?? 0) > 0 : bound[link.key] != null),
    [bound, multi],
  );
  const isPicked = useCallback(
    (link: Link, id: string) =>
      link.multi ? (multi[link.key]?.has(id) ?? false) : bound[link.key] === id,
    [bound, multi],
  );
  const pick = useCallback(
    (link: Link, id: string) => {
      if (link.multi) {
        setMulti((prev) => {
          const next = new Set(prev[link.key] ?? []);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { ...prev, [link.key]: next };
        });
        return;
      }
      // waterfall: re-picking a parent clears everything downstream
      const downstream = descendants(product, link.key);
      setBound((prev) => {
        const next = { ...prev, [link.key]: id };
        for (const k of downstream) if (k in next) next[k] = null;
        return next;
      });
      setMulti((prev) => {
        const next = { ...prev };
        for (const k of downstream) if (k in next) next[k] = new Set();
        return next;
      });
    },
    [product],
  );
  const pickPath = useCallback(
    (picks: { link: Link; id: string }[]) => {
      const deepest = picks[picks.length - 1];
      const downstream = deepest ? descendants(product, deepest.link.key) : [];
      setBound((prev) => {
        const next = { ...prev };
        for (const p of picks) if (!p.link.multi) next[p.link.key] = p.id;
        for (const k of downstream) if (k in next) next[k] = null;
        return next;
      });
      setMulti((prev) => {
        const next = { ...prev };
        for (const k of downstream) if (k in next) next[k] = new Set();
        for (const p of picks)
          if (p.link.multi) {
            const set = new Set(next[p.link.key] ?? []);
            if (set.has(p.id)) set.delete(p.id);
            else set.add(p.id);
            next[p.link.key] = set;
          }
        return next;
      });
      if (!deepest?.link.multi) setOpen(null);
    },
    [product],
  );

  return {
    bound,
    multi,
    labelOf,
    optionsOf,
    isPicked,
    pick,
    pickPath,
    isBound,
    open,
    setOpen,
    stage,
    setStage,
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
  busy: Set<string>;
  /** Link keys being read/written right now — the pulse source. */
  active: Set<string>;
  last: { verb: string; ok: boolean; at: number } | null;
  run: (verb: Verb) => void;
  canRun: (verb: Verb) => { ok: boolean; reason: string };
}

export function useRunner(product: Product, b: Bindings): Runner {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<Runner["last"]>(null);

  const canRun = useCallback(
    (verb: Verb) => {
      if (verb.run === null)
        return { ok: false, reason: `not wired — needs ${verb.needs ?? "a handler"}` };
      const missing = verb.demands.filter((k) => {
        const link = product.links.find((l) => l.key === k);
        return link ? !b.isBound(link) : true;
      });
      if (missing.length > 0) return { ok: false, reason: `needs ${missing.join(", ")} bound` };
      return { ok: true, reason: `${verb.label} on ${verb.demands.join(", ") || "nothing"}` };
    },
    [product, b],
  );

  const run = useCallback(
    (verb: Verb) => {
      if (!verb.run || busy.has(verb.key)) return;
      setBusy((s) => new Set(s).add(verb.key));
      setActive((s) => {
        const n = new Set(s);
        verb.demands.forEach((k) => n.add(k));
        return n;
      });
      void verb.run().then(() => {
        setBusy((s) => {
          const n = new Set(s);
          n.delete(verb.key);
          return n;
        });
        setActive((s) => {
          const n = new Set(s);
          verb.demands.forEach((k) => n.delete(k));
          return n;
        });
        setLast({ verb: verb.key, ok: true, at: Date.now() });
      });
    },
    [busy],
  );

  return { busy, active, last, run, canRun };
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

export function SeamChip({ product }: { product: Product }) {
  const list = seams(product);
  if (list.length === 0) return null;
  const fixtures = list.filter((s) => s.kind !== "verb");
  const verbs = list.filter((s) => s.kind === "verb");
  const text = [
    fixtures.length ? `${fixtures.map((s) => s.subject).join(", ")} from fixture` : null,
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

/* ------------------------------------------------------------------ path input */

export type InputMode = "segmented" | "columns" | "search";

/** The ONE in-flight mark. Opacity only — dashed stays the seam slot (R13b). */
export const PULSE_CSS = "@keyframes tp-pulse{0%,100%{opacity:.15}50%{opacity:1}}";

const POP: React.CSSProperties = {
  border: "1px solid var(--r-line-2)",
  background: "var(--r-page)",
  boxShadow: "0 2px 8px color-mix(in srgb, var(--r-ink) 8%, transparent)",
};

/** Every option path through `chain` given the id bound ABOVE the chain (for search). */
function enumeratePaths(chain: Link[], aboveId: string): { link: Link; opt: Option }[][] {
  const walk = (i: number, parentId: string): { link: Link; opt: Option }[][] => {
    const link = chain[i];
    if (!link) return [[]];
    const opts = link.options?.[parentId] ?? [];
    return opts.flatMap((opt) => walk(i + 1, opt.id).map((rest) => [{ link, opt }, ...rest]));
  };
  return walk(0, aboveId);
}

/** The option list for one link — segmented shows one at a time, columns shows all. */
function OptionList({
  link,
  b,
  compact,
  onPicked,
}: {
  link: Link;
  b: Bindings;
  compact?: boolean;
  onPicked?: () => void;
}) {
  const opts = b.optionsOf(link);
  return (
    <div className="max-h-56 overflow-y-auto py-1">
      {opts === null ? (
        <div className="t-caption px-2 py-1" style={{ color: "var(--r-caution)" }}>
          no legal options — needs {link.needs}
        </div>
      ) : opts.length === 0 ? (
        <div className="t-caption px-2 py-1" style={{ color: "var(--r-ink-2)" }}>
          {link.parent ? `bind ${link.parent} first` : link.needs}
        </div>
      ) : (
        opts.map((o) => {
          const on = b.isPicked(link, o.id);
          return (
            <Choice
              key={o.id}
              selected={on}
              reason={`Pick ${o.label}.`}
              onClick={() => {
                b.pick(link, o.id);
                onPicked?.();
              }}
              className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left"
              style={{ background: on ? "var(--r-select)" : undefined }}
            >
              {link.multi ? <span className="face-mono t-caption">{on ? "☑" : "☐"}</span> : null}
              <span className="t-value" style={{ color: "var(--r-ink)" }}>
                {o.label}
              </span>
              {o.sub && !compact ? (
                <span className="t-caption" style={{ color: "var(--r-ink-2)" }}>
                  {o.sub}
                </span>
              ) : null}
            </Choice>
          );
        })
      )}
    </div>
  );
}

/**
 * ONE INPUT PER PATH. Closed: the leaf. Open: the whole chain, in one of three shapes.
 * Keyed by the leaf, so a link two chains share (world) re-picks from either — kit state is
 * per link, both chains update. A sub-chain (prefix hoisted elsewhere) passes `chain` as the
 * tail only; its options still resolve against the real parent binding.
 */
export function PathInput({
  product,
  chain,
  b,
  runner,
  mode,
  showAll,
  tone = "ink",
}: {
  product: Product;
  chain: Link[];
  b: Bindings;
  runner?: Runner;
  mode: InputMode;
  /** Closed state prints every segment (identity prefix) instead of the leaf only. */
  showAll?: boolean;
  tone?: "ink" | "mute";
}) {
  const leaf = chain[chain.length - 1]!;
  const slot = `path:${leaf.key}`;
  const open = b.open === slot;
  const close = useCallback(() => b.setOpen(null), [b.setOpen]);
  const ref = useClickAway(open, close);
  const [seg, setSeg] = useState<string>(leaf.key);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    // land on the first unbound segment — "is this slot picked all the way through?"
    const firstUnbound = chain.find((l) => !b.isBound(l));
    setSeg((firstUnbound ?? leaf).key);
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fullPath = pathOf(product, leaf.key);
  const unboundAncestor = fullPath.slice(0, -1).find((l) => !b.isBound(l));
  const leafLabel = b.labelOf(leaf);
  const lit = runner?.active.has(leaf.key) ?? false;
  const flight = runner
    ? product.stages
        .flatMap((s) => s.verbs)
        .find((v) => runner.busy.has(v.key) && v.demands.includes(leaf.key))
    : undefined;
  const title = [
    fullPath.map((l) => `${l.key}: ${b.labelOf(l) ?? "unbound"}`).join(" › "),
    leaf.dir ? `${leaf.dir}${leaf.liveness ? ` · ${leaf.liveness}` : ""}` : null,
    leafLabel == null ? `needs ${leaf.needs}` : null,
    leaf.options === null ? "seam — no legal option source yet" : null,
    flight ? `in flight: ${flight.label}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const caution = leafLabel == null || unboundAncestor !== undefined;
  const color = caution ? "var(--r-caution)" : tone === "mute" ? "var(--r-ink-2)" : "var(--r-ink)";
  const closedText = showAll
    ? chain.map((l) => b.labelOf(l) ?? l.placeholder).join(" › ")
    : unboundAncestor
      ? `${unboundAncestor.placeholder} first`
      : (leafLabel ?? leaf.placeholder);

  /* ---- open shapes */
  const segLink = chain.find((l) => l.key === seg) ?? leaf;
  const segmented = (
    <>
      <div
        className="flex flex-wrap items-baseline gap-1 px-2 pt-1.5 pb-1"
        style={{ borderBottom: "1px solid var(--r-line-2)" }}
      >
        {chain.map((l, i) => {
          const on = l.key === seg;
          const lab = b.labelOf(l);
          return (
            <span key={l.key} className="inline-flex items-baseline gap-1">
              {i > 0 ? (
                <span className="face-mono t-caption" style={{ color: "var(--r-ink-mute)" }}>
                  ›
                </span>
              ) : null}
              <Choice
                selected={on}
                reason={`Select ${lab ?? l.placeholder}.`}
                onClick={() => setSeg(l.key)}
                className="face-mono t-caption"
                style={{
                  padding: "0 3px",
                  background: on ? "var(--r-select)" : "transparent",
                  color: lab == null ? "var(--r-caution)" : "var(--r-ink)",
                  borderBottom: on ? "1px solid var(--r-ink)" : "1px solid transparent",
                }}
              >
                {lab ?? l.placeholder}
              </Choice>
            </span>
          );
        })}
      </div>
      <OptionList
        link={segLink}
        b={b}
        onPicked={() => {
          if (segLink.multi) return;
          const next = chain[chain.findIndex((l) => l.key === segLink.key) + 1];
          if (next) setSeg(next.key);
          else b.setOpen(null);
        }}
      />
    </>
  );

  const columns = (
    <div className="flex">
      {chain.map((l, i) => (
        <div
          key={l.key}
          style={{ width: 176, borderLeft: i > 0 ? "1px solid var(--r-line-2)" : undefined }}
        >
          <div
            className="face-mono t-caption t-upper px-2 pt-1.5"
            style={{ color: "var(--r-ink-2)" }}
          >
            {l.key}
          </div>
          <OptionList
            link={l}
            b={b}
            compact
            onPicked={() => {
              if (!l.multi && i === chain.length - 1) b.setOpen(null);
            }}
          />
        </div>
      ))}
    </div>
  );

  const above = chain[0]?.parent ? b.bound[chain[0].parent] : "*";
  const paths = useMemo(() => (above == null ? [] : enumeratePaths(chain, above)), [chain, above]);
  const hits = paths
    .map((p) => ({ p, text: p.map((x) => x.opt.label).join(" / ") }))
    .filter((h) => h.text.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);
  const search = (
    <>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`search ${chain.map((l) => l.key).join(" / ")}`}
        className="t-value w-full px-2 py-1"
        style={{
          background: "transparent",
          borderBottom: "1px solid var(--r-line-2)",
          outline: "none",
          color: "var(--r-ink)",
        }}
      />
      <div className="max-h-64 overflow-y-auto py-1">
        {above == null ? (
          <div className="t-caption px-2 py-1" style={{ color: "var(--r-caution)" }}>
            bind {chain[0]?.parent} first
          </div>
        ) : paths.length === 0 ? (
          <div className="t-caption px-2 py-1" style={{ color: "var(--r-caution)" }}>
            no legal paths — needs {leaf.needs}
          </div>
        ) : hits.length === 0 ? (
          <div className="t-caption px-2 py-1" style={{ color: "var(--r-ink-2)" }}>
            no match
          </div>
        ) : (
          hits.map(({ p, text }) => {
            const picked = p.every((x) => b.isPicked(x.link, x.opt.id));
            const last = p[p.length - 1]!;
            return (
              <Choice
                key={text}
                selected={picked}
                reason={`Pick path ${text}.`}
                onClick={() => b.pickPath(p.map((x) => ({ link: x.link, id: x.opt.id })))}
                className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left"
                style={{ background: picked ? "var(--r-select)" : undefined }}
              >
                {last.link.multi ? (
                  <span className="face-mono t-caption">{picked ? "☑" : "☐"}</span>
                ) : null}
                {p.length > 1 ? (
                  <span className="t-caption" style={{ color: "var(--r-ink-mute)" }}>
                    {p
                      .slice(0, -1)
                      .map((x) => x.opt.label)
                      .join(" / ")}{" "}
                    /
                  </span>
                ) : null}
                <span className="t-value" style={{ color: "var(--r-ink)" }}>
                  {last.opt.label}
                </span>
                {last.opt.sub ? (
                  <span className="t-caption" style={{ color: "var(--r-ink-2)" }}>
                    {last.opt.sub}
                  </span>
                ) : null}
              </Choice>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <span ref={ref} className="relative inline-flex items-baseline">
      <style>{PULSE_CSS}</style>
      <Choice
        selected={open}
        busy={lit}
        reason={title}
        onClick={() => b.setOpen(open ? null : slot)}
        className={showAll ? "face-mono t-caption" : "face-mono t-label"}
        style={{
          padding: 0,
          background: open ? "var(--r-select)" : "transparent",
          borderBottom: `1px solid ${caution ? "var(--r-caution)" : tone === "mute" ? "var(--r-line-2)" : "var(--r-ink)"}`,
          color,
          whiteSpace: "nowrap",
          cursor: "pointer",
          animation: lit ? "tp-pulse 0.9s ease-in-out infinite" : undefined,
        }}
      >
        {closedText}
      </Choice>
      {open ? (
        <span
          className="absolute left-0 top-full z-40 mt-1 block overflow-hidden"
          style={{ ...POP, minWidth: mode === "columns" ? 176 * chain.length : 300 }}
        >
          {mode === "segmented" ? segmented : mode === "columns" ? columns : search}
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
}: {
  product: Product;
  b: Bindings;
  runner: Runner;
  meter?: boolean;
}) {
  return (
    <div
      className="flex"
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
    </div>
  );
}

/** Pane strip — Q4 made visible. Disabled panes read as locked text and say why on hover. */
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
            aria-disabled={!st.ok}
            className="face-mono t-caption"
            style={{
              padding: 0,
              color: st.ok ? "var(--r-ink)" : "var(--r-ink-mute)",
              fontStyle: st.ok ? undefined : "italic",
              borderBottom: st.ok ? "1px solid var(--r-line-2)" : "1px solid transparent",
              cursor: st.ok ? "pointer" : "not-allowed",
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
