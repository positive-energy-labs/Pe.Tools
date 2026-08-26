/** A route-local UI manifest. Live facts are total feeds; bindings stay in the route document. */
import type { Feed } from "#/state/route-store";

export type Dir = "read" | "write" | "sync" | "duplex";
export type Liveness = "attached" | "detached";

export interface Option {
  id: string;
  label: string;
  sub?: string;
}

export interface Link<K extends string = string> {
  key: K;
  under: K | null;
  joiner: string;
  placeholder: string;
  multi: boolean;
  needs: string;
  dir: Dir | null;
  liveness: Liveness | null;
}

export type Feeds<K extends string> = Readonly<Record<K, Feed>>;
export type Bound<K extends string> = Record<K, string | null>;
export type Multi<K extends string> = Partial<Record<K, ReadonlySet<string>>>;

export interface Verb<K extends string> {
  key: string;
  label: string;
  demands: readonly K[];
  kind: "act" | "commit" | "nav" | "panel" | "seam";
  run: (bound: Bound<K>, feeds: Feeds<K>) => Promise<string | void>;
  refuse: (bound: Bound<K>, feeds: Feeds<K>) => string | null;
  needs: string;
}

export interface Stage<K extends string> {
  key: string;
  label: string;
  verbs: readonly Verb<K>[];
}

export interface Pane<K extends string> {
  key: string;
  label: string;
  draws: readonly K[];
}

export interface Product<K extends string> {
  key: string;
  name: string;
  slots: Readonly<Record<K, Link<K>>>;
  feeds: Feeds<K>;
  stages: readonly Stage<K>[];
  panes: readonly Pane<K>[];
}

/** Infer the slot-key union once, then check feeds, demands, and draws against it. */
export const product =
  <const S extends Record<string, Link>>(key: string, name: string, slots: S) =>
  (rest: Omit<Product<keyof S & string>, "key" | "name" | "slots">): Product<keyof S & string> => ({
    key,
    name,
    slots,
    ...rest,
  });

const slotValues = <K extends string>(manifest: Product<K>): readonly Link<K>[] =>
  Object.values(manifest.slots) as Link<K>[];

export const targetMode = (link: Link) => link.dir ?? "manage";

/** Terminals print; a trunk prints only when this product declares no child beneath it. */
export const prints = <K extends string>(manifest: Product<K>, key: K) =>
  manifest.slots[key].dir !== null || !slotValues(manifest).some((slot) => slot.under === key);

export const targets = <K extends string>(manifest: Product<K>) =>
  slotValues(manifest).filter((slot) => prints(manifest, slot.key));

/** Root to leaf chain for a slot. */
export function pathOf<K extends string>(manifest: Product<K>, key: K): Link<K>[] {
  const out: Link<K>[] = [];
  let cursor: Link<K> | undefined = manifest.slots[key];
  while (cursor) {
    out.unshift(cursor);
    cursor = cursor.under === null ? undefined : manifest.slots[cursor.under];
  }
  return out;
}

export function descendants<K extends string>(manifest: Product<K>, key: K): K[] {
  const children = slotValues(manifest)
    .filter((slot) => slot.under === key)
    .map((slot) => slot.key);
  return children.flatMap((child) => [child, ...descendants(manifest, child)]);
}

export const demandedKeys = <K extends string>(stage: Stage<K>) =>
  new Set<K>(stage.verbs.flatMap((verb) => verb.demands));

export const isBound = <K extends string>(link: Link<K>, bound: Bound<K>, multi: Multi<K>) =>
  link.multi ? (multi[link.key]?.size ?? 0) > 0 : bound[link.key] != null;

/** Re-picking a parent clears everything downstream. */
export function pickInto<K extends string>(
  manifest: Product<K>,
  bound: Bound<K>,
  multi: Multi<K>,
  link: Link<K>,
  id: string,
): { bound: Bound<K>; multi: Multi<K> } {
  if (link.multi) {
    const next = new Set(multi[link.key] ?? []);
    if (!next.delete(id)) next.add(id);
    return { bound, multi: { ...multi, [link.key]: next } };
  }
  const nextBound: Bound<K> = { ...bound, [link.key]: id };
  const nextMulti: Multi<K> = { ...multi };
  for (const key of descendants(manifest, link.key)) {
    nextBound[key] = null;
    if (key in nextMulti) nextMulti[key] = new Set();
  }
  return { bound: nextBound, multi: nextMulti };
}

export function progress<K extends string>(
  chain: readonly Link<K>[],
  bound: Bound<K>,
  multi: Multi<K>,
): { complete: boolean; deepest: Link<K> | null; next: Link<K> | null } {
  const next = chain.find((link) => !isBound(link, bound, multi)) ?? null;
  if (!next) return { complete: true, deepest: chain.at(-1) ?? null, next: null };
  const index = chain.indexOf(next);
  return { complete: false, deepest: index > 0 ? chain[index - 1]! : null, next };
}

/** Why a verb cannot run. Ordered: unwired, unbound, stale, route gate. */
export function refusal<K extends string>(
  manifest: Product<K>,
  verb: Verb<K>,
  bound: Bound<K>,
  multi: Multi<K>,
): string | null {
  if (verb.kind === "seam") return `not wired — needs ${verb.needs}`;
  const missing = verb.demands.filter((key) => !isBound(manifest.slots[key], bound, multi));
  if (missing.length > 0)
    return `needs ${missing.join(", ")} bound — ${manifest.slots[missing[0]!].needs}`;
  const stale = verb.demands.find((key) => manifest.feeds[key].stale);
  if (stale) return `${stale} is stale — refresh before ${verb.label}`;
  return verb.refuse(bound, manifest.feeds);
}
