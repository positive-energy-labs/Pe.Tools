import { token } from "#/lib/token";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { FactChip } from "#/components/lang/chip";
import {
  demandedKeys,
  isBound as isBoundIn,
  pickInto,
  refusal,
  type Bound,
  type Dir,
  type Feeds,
  type Link,
  type Multi,
  type Option,
  type Pane,
  type Product,
  type Stage,
  type Verb,
} from "#/targeting/model";

export const DIR_GLYPH: Record<Dir, string> = { read: "←", write: "→", sync: "⇄", duplex: "⇆" };

export interface Bindings<K extends string> {
  bound: Bound<K>;
  multi: Multi<K>;
  feeds: Feeds<K>;
  labelOf: (link: Link<K>) => string | null;
  optionsOf: (link: Link<K>) => Option[] | null;
  isPicked: (link: Link<K>, id: string) => boolean;
  pick: (link: Link<K>, id: string) => void;
  isBound: (link: Link<K>) => boolean;
  open: string | null;
  setOpen: (key: string | null) => void;
  pickerLevel: string | null;
  setPickerLevel: (key: string) => void;
  pickerQuery: string;
  setPickerQuery: (query: string) => void;
  stage: Stage<K>;
  setStage: (key: string) => void;
  demanded: Set<K>;
}

export interface BindingState<K extends string> {
  bound: Bound<K>;
  multi: Multi<K>;
  stage: string;
}

export interface BindingPatch<K extends string> {
  bound?: Partial<Bound<K>>;
  multi?: Multi<K>;
  stage?: string;
}

export function useBindings<K extends string>(
  product: Product<K>,
  state: BindingState<K>,
  setState: (patch: BindingPatch<K>) => void,
  open: string | null,
  setOpen: (key: string | null) => void,
  pickerLevel: string | null,
  setPickerLevel: (key: string) => void,
  pickerQuery: string,
  setPickerQuery: (query: string) => void,
): Bindings<K> {
  const stage = product.stages.find((s) => s.key === state.stage) ?? product.stages[0]!;
  const demanded = useMemo(() => demandedKeys(stage), [stage]);
  const { bound, multi } = state;
  const { feeds } = product;

  const optionsOf = useCallback((link: Link<K>) => feeds[link.key].options, [feeds]);
  const labelOf = useCallback(
    (link: Link<K>) => {
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
  const isBound = useCallback((link: Link<K>) => isBoundIn(link, bound, multi), [bound, multi]);
  const isPicked = useCallback(
    (link: Link<K>, id: string) =>
      link.multi ? (multi[link.key]?.has(id) ?? false) : bound[link.key] === id,
    [bound, multi],
  );
  const pick = useCallback(
    (link: Link<K>, id: string) => setState(pickInto(product, bound, multi, link, id)),
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

export interface Runner<K extends string> {
  busy: string | null;
  active: Set<string>;
  run: (verb: Verb<K>) => void;
  canRun: (verb: Verb<K>) => { ok: boolean; reason: string };
}

export function useRunner<K extends string>(
  product: Product<K>,
  b: Bindings<K>,
  busyLabel: string | null = null,
): Runner<K> {
  const busyVerb = product.stages
    .flatMap((stage) => stage.verbs)
    .find((verb) => verb.key === busyLabel);
  const active = useMemo(() => new Set(busyVerb?.demands ?? []), [busyVerb]);

  const canRun = useCallback(
    (verb: Verb<K>) => {
      const why = refusal(product, verb, b.bound, b.multi);
      if (why) return { ok: false, reason: why };
      if (busyLabel !== null) return { ok: false, reason: `${busyLabel} is in flight` };
      return { ok: true, reason: `${verb.label} on ${verb.demands.join(", ") || "nothing"}` };
    },
    [product, b, busyLabel],
  );

  const run = useCallback(
    (verb: Verb<K>) => {
      if (!canRun(verb).ok) return;
      void verb.run(b.bound, b.feeds);
    },
    [b.bound, b.feeds, canRun],
  );

  return { busy: busyVerb?.key ?? null, active, run, canRun };
}

export function paneState<K extends string>(
  product: Product<K>,
  pane: Pane<K>,
  b: Pick<Bindings<K>, "isBound" | "demanded" | "stage">,
): { ok: boolean; reason: string } {
  for (const k of pane.draws) {
    const link = product.slots[k];
    if (!b.isBound(link)) return { ok: false, reason: `${pane.label} draws from ${k} — unbound` };
    if (!b.demanded.has(k) && link.dir !== undefined)
      return {
        ok: false,
        reason: `${pane.label} draws from ${k} — out of scope at ${b.stage.label}`,
      };
  }
  return { ok: true, reason: `${pane.label} draws from ${pane.draws.join(", ") || "nothing"}` };
}

export function SeamChip<K extends string>({ product }: { product: Product<K> }) {
  const list: { kind: "options" | "fixture" | "verb"; subject: string; needs: string }[] = [];
  for (const slot of Object.values(product.slots) as Link<K>[]) {
    const feed = product.feeds[slot.key];
    if (feed.seam) list.push({ kind: "options", subject: slot.key, needs: feed.seam.needs });
    if (feed.lane === "fixture")
      list.push({ kind: "fixture", subject: slot.key, needs: slot.needs });
  }
  for (const stage of product.stages)
    for (const verb of stage.verbs)
      if (verb.kind === "seam")
        list.push({ kind: "verb", subject: `${stage.key}/${verb.key}`, needs: verb.needs });
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

export function freshnessWord<K extends string>(b: Bindings<K>, link: Link<K>): string | null {
  const f = b.feeds[link.key];
  if (!f) return null;
  const state = f.stale
    ? "stale"
    : f.state === "loading"
      ? "reading…"
      : f.state === "error"
        ? "read failed"
        : f.at
          ? `read at ${new Date(f.at).toLocaleTimeString()}`
          : null;
  return [f.lane, state].filter(Boolean).join(" · ");
}

export const PULSE_CSS = "@keyframes tp-pulse{0%,100%{opacity:.15}50%{opacity:1}}";

export const POP: React.CSSProperties = {
  border: `1px solid ${token("line-2")}`,
  backgroundColor: token("page"),
  width: 320,
  maxWidth: "calc(100vw - 16px)",
};
