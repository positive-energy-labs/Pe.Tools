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
import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { z } from "zod";
import type { RouteManifest } from "./manifest";

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

const NO_SEARCH: Record<string, unknown> = {};
const none = () => () => {};

/**
 * Two-way sync between the Page and the address, inside the route owner. Reads the router from
 * context when there is one (`useRoute` also runs in tests and chat panes that own no URL).
 * `override` is what the page moves since the last commit asked (`PageMove.history`): null = none,
 * so each changed key's own class decides (`historyOf`). A push wins over a replace.
 */
export function useUrlPage<P>(
  url: UrlPage<P> | null,
  page: P,
  setPage: (next: (current: P) => P) => void,
  override: RefObject<History | null>,
) {
  const router = useRouter({ warn: false });
  const live = router && url ? { router, url } : null;
  const search = useSyncExternalStore(
    (notify) => (live ? live.router.subscribe("onResolved", notify) : none()),
    () => (live ? (live.router.state.location.search as Record<string, unknown>) : NO_SEARCH),
    () => (live ? (live.router.state.location.search as Record<string, unknown>) : NO_SEARCH),
  );
  const fromUrl = live ? live.url.read(search) : null;
  const urlKey = JSON.stringify(live && fromUrl ? live.url.write(fromUrl) : null);
  const pageKey = JSON.stringify(live ? live.url.write(page) : null);
  // The address moved (Back, Forward, a link): the page follows.
  useEffect(() => {
    if (live && urlKey !== pageKey) setPage((current) => ({ ...current, ...fromUrl }));
  }, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The page moved: the address follows, one history entry per place, or the same entry for a gesture.
  // ponytail: both moving in one commit settles on whichever effect ran last; neither has yet.
  useEffect(() => {
    if (!live || urlKey === pageKey) return;
    const history = live.url.history(
      fromUrl ?? {},
      page as Partial<P>,
      override.current ?? undefined,
    );
    if (!history) return;
    const written = live.url.write(page);
    void live.router.navigate({
      to: live.router.state.location.pathname,
      search: (previous: Record<string, unknown>) => ({ ...previous, ...written }),
      replace: history === "replace",
    } as never);
  }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every commit consumes the moves that made it, written or not (a Page-only key writes nothing).
  useEffect(() => {
    override.current = null;
  });
}

/** First render: the page the address names, before any effect runs. */
export function useInitialUrlPage<P>(url: UrlPage<P> | null): Partial<P> {
  const router = useRouter({ warn: false });
  return router && url ? url.read(router.state.location.search as Record<string, unknown>) : {};
}
