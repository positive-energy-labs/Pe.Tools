/**
 * TARGETING — the route binding manifest (canon; promoted from targeting-proto round 5,
 * reframed round 7 on kaitpw's notes).
 *
 * A route declares ONE `Product`: a forest of `Link`s, `Stage`s of `Verb`s, and `Pane`s.
 * The forest has two kinds of node:
 *   TERMINAL (has `dir`) — the smallest unit of targeting the user thinks about when using the
 *     route for its purpose (a zoning plan, the zones, an .r10). Terminals ARE the sentence.
 *   TRUNK   (no `dir`)  — how you get to a terminal (world › rvt; folder). Trunks never print
 *     in the sentence; they live inside the terminal's picker as crumbs, and two terminals that
 *     share a trunk share its binding (re-pick from either picker, both update).
 * Direction lives on the terminal only. A write terminal's target is implied by its trunk.
 *
 * The manifest is STATIC data — what the sentence, the census, and a chat-plugin registration
 * all project. Everything live comes in beside it as a `Feed` per link: the legal options, and
 * how fresh they are. Bindings are the CALLER's state (URL search on a route).
 *
 * Seams are declared facts:
 *   feed.seam               → legal-options seam
 *   feed.lane === "fixture" → page-level seam chip
 *   verb.run === null       → verb seam (declared, not wired)
 *   pane.draws ⊄ bound∩demanded → pane disabled with reason (demands gate panes)
 *
 * Authoring questions the shape forces: what are the terminals (fewest nouns)? which trunks do
 * they share (`parent`)? which stage demands which terminal?
 */

import type { Feed } from "#/state/route-store";

export type Dir = "read" | "write" | "sync" | "duplex";
export type Liveness = "attached" | "detached";

export interface Option {
  id: string;
  label: string;
  sub?: string;
}

export interface Link {
  key: string;
  /** Parent link key; undefined = root of a trunk. */
  parent?: string;
  /** Prose joiner before a terminal ("from", "into", "syncing"). Trunks may leave it empty. */
  joiner: string;
  placeholder: string;
  multi?: boolean;
  /** What discharges an empty picker or a seam — the sentence the user reads when options are missing. */
  needs: string;
  /** Terminal-only. Links without one are trunks. */
  dir?: Dir;
  liveness?: Liveness;
}

export type Feeds = Record<string, Feed>;

export type Bound = Record<string, string | null>;
export type Multi = Record<string, ReadonlySet<string>>;

export interface Verb {
  key: string;
  label: string;
  /** Link keys that must be bound before this verb can run. */
  demands: string[];
  /** Page-blast commit verb (the one blue). */
  commit?: boolean;
  /** Nav verb that drives another program (open in RHVAC). */
  nav?: boolean;
  /** null = SEAM: declared, not wired. */
  run: (() => Promise<string | void>) | null;
  /** Only when run === null: what wires it. */
  needs?: string;
  /** Per-option refusal beyond demands (the gate that produced it, in words). */
  refuse?: () => string | null;
}

export interface Stage {
  key: string;
  label: string;
  verbs: Verb[];
}

export interface Pane {
  key: string;
  label: string;
  /** Link keys this pane draws from. Unbound or undemanded ⇒ pane disabled. */
  draws: string[];
}

export interface Product {
  key: string;
  name: string;
  links: Link[];
  stages: Stage[];
  panes: Pane[];
}

/* ------------------------------------------------------------------ derivations */

export const isTerminal = (l: Link) => l.dir !== undefined;

/** Terminals in declaration order — the sentence, big → small. */
export const terminals = (p: Product) => p.links.filter(isTerminal);

/** Root → leaf chain for a link (the picker's crumbs). */
export function pathOf(product: Product, key: string): Link[] {
  const byKey = new Map(product.links.map((l) => [l.key, l]));
  const out: Link[] = [];
  let cur = byKey.get(key);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent ? byKey.get(cur.parent) : undefined;
  }
  return out;
}

export function descendants(product: Product, key: string): string[] {
  const kids = product.links.filter((l) => l.parent === key).map((l) => l.key);
  return kids.flatMap((k) => [k, ...descendants(product, k)]);
}

export const demandedKeys = (stage: Stage) => new Set(stage.verbs.flatMap((v) => v.demands));

export const isBound = (l: Link, bound: Bound, multi: Multi) =>
  l.multi ? (multi[l.key]?.size ?? 0) > 0 : bound[l.key] != null;

/** Re-picking a parent clears everything downstream (the waterfall). */
export function pickInto(
  product: Product,
  bound: Bound,
  multi: Multi,
  link: Link,
  id: string,
): { bound: Bound; multi: Multi } {
  if (link.multi) {
    const next = new Set(multi[link.key] ?? []);
    if (!next.delete(id)) next.add(id);
    return { bound, multi: { ...multi, [link.key]: next } };
  }
  const nb = { ...bound, [link.key]: id };
  const nm = { ...multi };
  for (const k of descendants(product, link.key)) {
    if (k in nb) nb[k] = null;
    if (k in nm) nm[k] = new Set();
  }
  return { bound: nb, multi: nm };
}

/**
 * How far down a chain the picks reach. `complete` = leaf bound. Otherwise `deepest` is the
 * last bound link (null = nothing bound) and `next` the first unbound one — the closed picker
 * prints `<deepest label> › <next placeholder>` so an incomplete pick says where it stopped.
 */
export function progress(
  chain: Link[],
  bound: Bound,
  multi: Multi,
): { complete: boolean; deepest: Link | null; next: Link | null } {
  const next = chain.find((l) => !isBound(l, bound, multi)) ?? null;
  if (!next) return { complete: true, deepest: chain[chain.length - 1] ?? null, next: null };
  const i = chain.indexOf(next);
  return { complete: false, deepest: i > 0 ? chain[i - 1]! : null, next };
}

export interface Seam {
  kind: "options" | "fixture" | "verb";
  subject: string;
  needs: string;
}

/** Every seam a product carries right now — the page chip and the census both read this. */
export function seams(p: Product, feeds: Feeds): Seam[] {
  const out: Seam[] = [];
  for (const l of p.links) {
    const f = feeds[l.key];
    if (f?.seam) out.push({ kind: "options", subject: l.key, needs: f.seam.needs });
    if (f?.lane === "fixture")
      out.push({ kind: "fixture", subject: l.key, needs: l.needs });
  }
  for (const s of p.stages)
    for (const v of s.verbs)
      if (v.run === null)
        out.push({ kind: "verb", subject: `${s.key}/${v.key}`, needs: v.needs ?? "a handler" });
  return out;
}

/** Why a verb cannot run, or null when it can. Unwired → unbound demand → stale demand → gate. */
export function refusal(
  product: Product,
  v: Verb,
  bound: Bound,
  multi: Multi,
  feeds: Feeds,
): string | null {
  if (v.run === null) return `not wired — needs ${v.needs ?? "a handler"}`;
  const missing = v.demands.filter((k) => {
    const link = product.links.find((l) => l.key === k);
    return link ? !isBound(link, bound, multi) : true;
  });
  if (missing.length > 0) {
    const first = product.links.find((l) => l.key === missing[0]);
    return `needs ${missing.join(", ")} bound${first ? ` — ${first.needs}` : ""}`;
  }
  const stale = v.demands.find((k) => feeds[k]?.stale);
  if (stale) return `${stale} is stale — refresh before ${v.label}`;
  return v.refuse?.() ?? null;
}
