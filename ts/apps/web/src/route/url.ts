/**
 * The URL half of a route's Page, derived from the manifest. A route with an `address` reads and
 * writes through its contract fields (agent-contracts `routeAddresses`: `readLink`, `writeSearch`,
 * `historyOf`); a route not yet in the contract names its `url` keys and the page schema says how
 * to read them. TanStack Router owns the rest: `validateSearch` takes the derived reader, the
 * middleware keeps a bare route URL bare, and each change of place is one history entry, so Back
 * and Forward step through what the Situation targeted; a gesture replaces the entry instead.
 * Nothing here hand-rolls `new URL().searchParams`.
 */
import {
  historyOf,
  readLink,
  routeAddresses,
  urlKeys,
  writeSearch,
  type History,
  type RouteField,
  type RouteKey,
} from "@pe/agent-contracts";
import { useRouter, type SearchMiddleware } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import type { RouteManifest } from "./manifest";
import type { ViewOwner } from "./view-owner";
import { causeRefusal } from "./refusal";

export interface UrlPage<P> {
  readonly keys: readonly (keyof P & string)[];
  /** Search → the Page fields the URL names, defaults applied; a value the schema refuses falls to its default. */
  readonly read: (search: Record<string, unknown>) => Partial<P>;
  /** Page → search values; a contract route writes a default as `undefined`, a `url` route includes it. */
  readonly write: (page: Partial<P>) => Record<string, unknown>;
  /** How a move from `before` to `after` lands in history; null = no URL key changed. */
  readonly history: (before: Partial<P>, after: Partial<P>, override?: History) => History | null;
  /** The route file's `search.middlewares`: defaults never reach the address. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one middleware fits every route schema
  readonly middlewares: readonly SearchMiddleware<any>[];
}

type Shape = Record<string, z.ZodType>;

/** An object's shape, through the intersections the entity kernel builds. */
const shapeOf = (schema: z.ZodType): Shape => {
  const def = schema.def as { type: string; left?: z.ZodType; right?: z.ZodType };
  if (def.type === "object") return (schema as z.ZodObject).shape as Shape;
  if (def.type === "intersection") return { ...shapeOf(def.left!), ...shapeOf(def.right!) };
  throw Error(`a page schema is an object or an intersection of objects, not ${def.type}`);
};

/**
 * A contract route's URL page. The contract field is the one default: a Page field the address
 * carries must default to the same value, or the address could not stay bare (fails at load).
 */
function addressPage<P>(key: string, route: RouteKey, page: z.ZodType<P> | undefined): UrlPage<P> {
  if (!page) throw Error(`${key} names an address without a page schema`);
  const shape = shapeOf(page);
  const fields = routeAddresses[route].fields as Record<string, RouteField>;
  const keys = urlKeys(route) as (keyof P & string)[];
  for (const name of keys) {
    if (!shape[name]) throw Error(`${key}: address key ${name} is not a page field`);
    const field = fields[name]!;
    const encode = (value: unknown) =>
      value === undefined ? undefined : field.codec.encode(value);
    if (encode(shape[name]!.parse(undefined)) !== encode(field.schema.parse(undefined)))
      throw Error(`${key}: page default for ${name} differs from its contract field's`);
  }
  const read = (search: Record<string, unknown>) => readLink(route, search).page as Partial<P>;
  const write = (value: Partial<P>): Record<string, string | undefined> =>
    writeSearch(route, value as never);
  // Every way into the address (a navigate, a Link) writes the URL keys as their codec does.
  const encode: SearchMiddleware<Record<string, unknown>> = ({ search, next }) => {
    const out = { ...next(search) };
    for (const [name, text] of Object.entries(write(out as Partial<P>)))
      if (text === undefined) delete out[name];
      else out[name] = text;
    return out;
  };
  return {
    keys,
    read,
    write,
    history: (before, after, override) =>
      historyOf(route, before as never, after as never, override),
    middlewares: [encode],
  };
}

/** The manifest's URL page; null when the manifest names no contract address. */
export function urlPage<W, R extends string, P, A extends string>(
  manifest: RouteManifest<W, R, P, A>,
): UrlPage<P> | null {
  return manifest.address ? addressPage(manifest.key, manifest.address, manifest.page) : null;
}

/**
 * The router is an adapter to the external Page owner. History notifications restore synchronously,
 * before a pending write can flush. A restore never produces a navigation or runs a route action.
 */
export function useUrlPage<P>(url: UrlPage<P> | null, owner: ViewOwner<P>) {
  const router = useRouter({ warn: false });
  useEffect(() => {
    if (!router || !url) return;
    const token = crypto.randomUUID();
    const marker = "__pePageMove";
    let generation = 0;
    let active = true;
    let queued = false;
    let writing = false;
    let pending: History | null = null;
    let previous = owner.read();
    const location = () => router.parseLocation(router.history.location);
    const pathname = location().pathname;
    const stamp = (state: object) =>
      (state as Record<string, unknown>)[marker] as
        | { token: string; generation: number }
        | undefined;
    const restore = () => {
      generation += 1;
      pending = null;
      const next = location();
      if (next.pathname === pathname) owner.move(url.read(next.search), {}, "url");
      previous = owner.read();
    };
    const unhistory = router.history.subscribe(({ location: next, action }) => {
      const move = stamp(next.state);
      if (
        (action.type === "PUSH" || action.type === "REPLACE") &&
        move?.token === token &&
        move.generation === generation
      )
        return;
      restore();
    });
    const schedule = () => {
      if (queued || writing || !pending || !active) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!active || !pending || location().pathname !== pathname) return;
        const history = pending;
        pending = null;
        const current = owner.read().page;
        const fromUrl = url.read(location().search);
        if (!url.history(fromUrl, current)) return;
        const written = url.write(current);
        const at = generation;
        writing = true;
        void router
          .navigate({
            to: pathname,
            search: (search: Record<string, unknown>) => ({ ...search, ...written }),
            state: (state: Record<string, unknown>) => ({
              ...state,
              [marker]: { token, generation: at },
            }),
            replace: history === "replace",
            // Like the router's canonicalization, this projects the current same-path Page.
            // Blockers yield before committing; a delayed projection could overwrite a later link.
            ignoreBlocker: true,
          } as never)
          .catch((cause: unknown) => {
            if (active && generation === at) owner.fail(causeRefusal(cause));
          })
          .finally(() => {
            writing = false;
            schedule();
          });
      });
    };
    const unpage = owner.subscribe(() => {
      const next = owner.read();
      const history =
        next.origin === "url" ? null : url.history(previous.page, next.page, next.history);
      previous = next;
      if (!history) return;
      pending = history === "push" || pending === "push" ? "push" : history;
      schedule();
    });
    // Catch navigation between initialization and subscription without rewriting a bare URL.
    if (url.history(url.read(location().search), previous.page)) restore();
    return () => {
      active = false;
      generation += 1;
      pending = null;
      unpage();
      unhistory();
    };
  }, [router, url, owner]);
}

/** First render: the page the address names, before any effect runs. */
export function useInitialUrlPage<P>(url: UrlPage<P> | null): Partial<P> {
  const router = useRouter({ warn: false });
  return router && url ? url.read(router.state.location.search as Record<string, unknown>) : {};
}
