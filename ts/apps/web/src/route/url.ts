/**
 * The URL half of a route's Page, derived from the manifest: `url` names the Page keys the address
 * carries, the page schema says how to read them. TanStack Router owns the rest — `validateSearch`
 * takes the derived reader, `stripSearchParams(defaults)` keeps a bare route URL bare, and every
 * change of place is one history entry, so Back and Forward step through what the Situation
 * targeted. Nothing here hand-rolls `new URL().searchParams`.
 */
import { stripSearchParams, useRouter, type SearchMiddleware } from "@tanstack/react-router";
import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import type { RouteManifest } from "./manifest";

export interface UrlPage<P> {
  readonly keys: readonly (keyof P & string)[];
  /** Search → the Page fields the URL names, defaults applied; a value the schema refuses falls to its default. */
  readonly read: (search: Record<string, unknown>) => Partial<P>;
  /** Page → search values, defaults included; arrays ride comma-joined. */
  readonly write: (page: Partial<P>) => Record<string, unknown>;
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

/** The manifest's URL page; null when the manifest names no `url` keys. */
export function urlPage<W, R extends string, P, A extends string>(
  manifest: RouteManifest<W, R, P, A>,
): UrlPage<P> | null {
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
  return { keys, read, write, middlewares: [stripSearchParams(write(read({})))] };
}

const NO_SEARCH: Record<string, unknown> = {};
const none = () => () => {};

/**
 * Two-way sync between the Page and the address, inside the route owner. Reads the router from
 * context when there is one (`useRoute` also runs in tests and chat panes that own no URL).
 */
export function useUrlPage<P>(
  url: UrlPage<P> | null,
  page: P,
  setPage: (next: (current: P) => P) => void,
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
  // The page moved: the address follows, one history entry per place.
  // ponytail: both moving in one commit settles on whichever effect ran last; neither has yet.
  useEffect(() => {
    if (!live || urlKey === pageKey) return;
    const written = live.url.write(page);
    void live.router.navigate({
      to: live.router.state.location.pathname,
      search: (previous: Record<string, unknown>) => ({ ...previous, ...written }),
    } as never);
  }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** First render: the page the address names, before any effect runs. */
export function useInitialUrlPage<P>(url: UrlPage<P> | null): Partial<P> {
  const router = useRouter({ warn: false });
  return router && url ? url.read(router.state.location.search as Record<string, unknown>) : {};
}
