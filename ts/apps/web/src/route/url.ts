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
import { stripSearchParams, useRouter, type SearchMiddleware } from "@tanstack/react-router";
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

const WRAPPERS = new Set(["default", "optional", "nullable", "readonly", "catch"]);
const bare = (schema: z.ZodType): z.ZodType => {
  let inner = schema;
  while (WRAPPERS.has(inner.def.type))
    inner = (inner.def as unknown as { innerType: z.ZodType }).innerType;
  return inner;
};

/** The router JSON-parses `selected=8081605` into a number; the schema says what it meant. */
const coerce = (field: z.ZodType, raw: unknown): unknown => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const kind = bare(field).def.type;
  const text = String(raw as string | number | boolean);
  if (kind === "array")
    return Array.isArray(raw) ? raw.map(String) : text.split(",").filter(Boolean);
  return kind === "string" || kind === "enum" ? text : raw;
};

/**
 * A contract route's URL page. A Page default that differs from its field's (families' `query`)
 * stays the bare address: absent reads as the Page default, and the Page default writes nothing.
 */
function addressPage<P>(key: string, route: RouteKey, page: z.ZodType<P> | undefined): UrlPage<P> {
  if (!page) throw Error(`${key} names an address without a page schema`);
  const shape = shapeOf(page);
  const fields = routeAddresses[route].fields as Record<string, RouteField>;
  const keys = urlKeys(route) as (keyof P & string)[];
  for (const name of keys)
    if (!shape[name]) throw Error(`${key}: address key ${name} is not a page field`);
  // ponytail: one drifted default today (families' query); moving its clauses into the contract field empties this.
  const drift = keys.flatMap((name) => {
    const field = fields[name]!;
    const encode = (value: unknown) =>
      value === undefined ? undefined : field.codec.encode(value);
    const initial = shape[name]!.parse(undefined);
    return encode(initial) === encode(field.schema.parse(undefined))
      ? []
      : [{ name, initial, bare: encode(initial), encode }];
  });
  const read = (search: Record<string, unknown>) => {
    const linked = { ...readLink(route, search).page } as Record<string, unknown>;
    for (const { name, initial } of drift) if (search[name] === undefined) linked[name] = initial;
    return linked as Partial<P>;
  };
  const write = (value: Partial<P>) => {
    const written: Record<string, string | undefined> = writeSearch(route, value as never);
    for (const { name, bare, encode } of drift)
      if (name in value) {
        const text = encode((value as Record<string, unknown>)[name]);
        written[name] = text === bare ? undefined : text;
      }
    return written;
  };
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

/** The manifest's URL page; null when the manifest names no address or `url` keys. */
export function urlPage<W, R extends string, P, A extends string>(
  manifest: RouteManifest<W, R, P, A>,
): UrlPage<P> | null {
  if (manifest.address) return addressPage(manifest.key, manifest.address, manifest.page);
  const keys = manifest.url ?? [];
  if (keys.length === 0) return null;
  if (!manifest.page) throw Error(`${manifest.key} names url keys without a page schema`);
  const shape = shapeOf(manifest.page);
  for (const key of keys) {
    const field = shape[key];
    if (!field) throw Error(`${manifest.key}: url key ${key} is not a page field`);
    if (!field.safeParse(undefined).success)
      throw Error(`${manifest.key}: url key ${key} needs a default, so a bare URL has a page`);
  }
  const read = (search: Record<string, unknown>) =>
    Object.fromEntries(
      keys.map((key) => {
        const field = shape[key]!;
        const parsed = field.safeParse(coerce(field, search[key]));
        return [key, parsed.success ? parsed.data : field.parse(undefined)];
      }),
    ) as Partial<P>;
  const write = (page: Partial<P>) =>
    Object.fromEntries(
      keys.map((key) => {
        const value = page[key];
        return [key, Array.isArray(value) ? value.join(",") : value];
      }),
    );
  // A route outside the contract has no history classes: every move pushes unless it says otherwise.
  const history = (before: Partial<P>, after: Partial<P>, override?: History) =>
    JSON.stringify(write(before)) === JSON.stringify(write(after)) ? null : (override ?? "push");
  return { keys, read, write, history, middlewares: [stripSearchParams(write(read({})))] };
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
