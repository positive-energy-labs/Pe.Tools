/**
 * The URL half of a route's Page, derived from the manifest: a route with an `address` reads and
 * writes through its contract (agent-contracts `routeAddress(route)`: `read`, `write`, `history`).
 * TanStack Router owns the rest: `validateSearch` takes the derived reader, the
 * middleware keeps a bare route URL bare, and each change of place is one history entry, so Back
 * and Forward step through what the Situation targeted; a gesture replaces the entry instead.
 * Nothing here hand-rolls `new URL().searchParams`.
 */
import {
  routeAddress,
  THREAD_TABS_MAX,
  threadTabSchema,
  type History,
  type RouteKey,
  type RoutePage,
} from "@pe/agent-contracts";
import { fromStandardSchema } from "@pe/host-contracts/contracts";
import { Cause, Exit, Schema } from "effect";
import { useRouter, useRouterState, type SearchMiddleware } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { z } from "zod";
import type { ViewOwner } from "./view-owner";
import { causeRefusal } from "./refusal";
import { useRouteActivity } from "./activity";

type AnyRouter = ReturnType<typeof useRouter>;
const parsed = new WeakMap<object, ReturnType<AnyRouter["parseLocation"]>>();

/**
 * The router's current location, parsed once per navigation. History swaps its `location` object
 * on every change, so the object is the cache key; every route-activity check and Page restore
 * reads through here instead of re-parsing (and re-decoding every search key) per subscriber.
 */
export function currentLocation(router: AnyRouter) {
  const at = router.history.location;
  let hit = parsed.get(at);
  if (!hit) parsed.set(at, (hit = router.parseLocation(at)));
  return hit;
}

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
const routeUrlPages = new Map<RouteKey, UrlPage<never>>();

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
  const contract = routeAddress(route);
  const defaults: Record<string, unknown> = contract.defaults;
  // The casts below cross from the address's page to the manifest's P: a manifest names its
  // `address` as any `RouteKey`, untied from P, so only the key check above proves P holds them.
  const keys = contract.keys as readonly (keyof P & string)[];
  for (const name of keys) {
    if (!shape[name]) throw Error(`${key}: address key ${name} is not a page field`);
    const initial = shape[name]!.parse(undefined);
    // The address writes a value at its contract default as nothing; any other default would show.
    const same =
      initial === undefined
        ? defaults[name] === undefined
        : contract.write({ [name]: initial })[name] === undefined;
    if (!same) throw Error(`${key}: page default for ${name} differs from its contract field's`);
  }
  // One adapter per route: `useUrlPage` re-subscribes when it changes, and a re-subscribe restores
  // the address over any move still pending. A manifest that refreshes its action facts (Family,
  // when a capture lands) must not rebuild it.
  const cached = routeUrlPages.get(route);
  if (cached) return cached as unknown as UrlPage<P>;
  const read = (search: Record<string, unknown>) => contract.read(search).page as Partial<P>;
  const write = (value: Partial<P>): Record<string, string | undefined> =>
    contract.write(value as never);
  // Every way into the address (a navigate, a Link) writes the URL keys as their codec does.
  const encode: SearchMiddleware<Record<string, unknown>> = ({ search, next }) => {
    const out = { ...next(search) };
    // A navigation can supply typed Page values or values already written by the codec.
    // Read first so an object codec cannot JSON-stringify its own encoded string twice.
    const normalized = read(out);
    for (const [name, text] of Object.entries(write(normalized))) {
      if (!(name in out)) continue;
      if (text === undefined) delete out[name];
      else {
        const value = (normalized as Record<string, unknown>)[name];
        // TanStack serializes objects itself; other codecs (orbit poses, comma lists) keep text.
        out[name] =
          value !== null && typeof value === "object" && JSON.stringify(value) === text
            ? value
            : text;
      }
    }
    return out;
  };
  const url: UrlPage<P> = {
    keys,
    read,
    write,
    history: (before, after, override) =>
      contract.history(before as never, after as never, override),
    middlewares: [encode],
  };
  routeUrlPages.set(route, url as unknown as UrlPage<never>);
  return url;
}

/** A contract route's URL page with no manifest: the address schema is the Page (`useAddressPage`). */
export function routeUrlPage<R extends RouteKey>(route: R): UrlPage<RoutePage<R>> {
  return addressPage(route, route, routeAddress(route).schema as never) as unknown as UrlPage<
    RoutePage<R>
  >;
}

/**
 * The router is an adapter to the external Page owner. History notifications restore synchronously,
 * before a pending write can flush. A restore never produces a navigation or runs a route action.
 */
export function useUrlPage<P>(url: UrlPage<P> | null, owner: ViewOwner<P>) {
  const router = useRouter({ warn: false });
  const activity = useRouteActivity();
  const initialLocation = useRef(router?.history.location);
  useEffect(() => {
    if (!router || !url) return;
    const ownsUrl = () => !activity || activity.current();
    const token = crypto.randomUUID();
    const marker = "__pePageMove";
    let generation = 0;
    let active = true;
    let queued = false;
    let writing = false;
    let pending: History | null = null;
    let previous = owner.read();
    const location = () => currentLocation(router);
    const pathname = location().pathname;
    const stamp = (state: object) =>
      (state as Record<string, unknown>)[marker] as
        | { token: string; generation: number }
        | undefined;
    const restore = (remember = false) => {
      generation += 1;
      pending = null;
      const next = location();
      if (ownsUrl() && next.pathname === pathname)
        owner.move(
          url.read(
            restorePageSearch(remember ? url.write(owner.read().page) : undefined, next.search)!,
          ),
          {},
          "url",
        );
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
      restore(action.type === "PUSH" || action.type === "REPLACE");
    });
    const schedule = () => {
      if (queued || writing || !pending || !active) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!active || !ownsUrl() || !pending || location().pathname !== pathname) return;
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
            // A same-page filter, selection or view change preserves the list's own reveal.
            resetScroll: false,
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
        !ownsUrl() || next.origin === "url"
          ? null
          : url.history(previous.page, next.page, next.history);
      previous = next;
      if (!history) return;
      pending = history === "push" || pending === "push" ? "push" : history;
      schedule();
    });
    // Catch navigation between initialization and subscription without rewriting a bare URL.
    if (
      router.history.location !== initialLocation.current &&
      url.history(url.read(location().search), previous.page)
    )
      restore();
    return () => {
      active = false;
      generation += 1;
      pending = null;
      unpage();
      unhistory();
    };
  }, [router, url, owner, activity]);
}

/** First render: the page the address names, before any effect runs. */
export function useInitialUrlPage<P>(url: UrlPage<P> | null): Partial<P> {
  const router = useRouter({ warn: false });
  const activity = useRouteActivity();
  return useState(() =>
    url
      ? url.read(
          restorePageSearch(
            activity?.search ??
              tabPageSearch(
                router?.state.location.pathname ??
                  (typeof location === "undefined" ? "" : location.pathname),
              ),
            !activity || activity.current() ? router?.state.location.search : undefined,
          ) ??
            (typeof location === "undefined"
              ? {}
              : Object.fromEntries(new URLSearchParams(location.search))),
        )
      : {},
  )[0];
}

/** Tab memory as `workbench/tabs.ts` writes it: the window's Places, decoded (ADR 0029 rule 7). */
const PlacesMemory = Schema.fromJsonString(
  fromStandardSchema(threadTabSchema.array().max(THREAD_TABS_MAX), "Places"),
);

/** Defaults are applied by UrlPage.read after merging tab memory and explicit deep-link keys. */
export function tabPageSearch(pathname: string): Record<string, unknown> | undefined {
  try {
    // React caller until phase 5: memory from another build that does not decode restores nothing.
    const memory = Schema.decodeUnknownExit(PlacesMemory)(
      sessionStorage.getItem("pe.places") ?? "[]",
    );
    if (Exit.isFailure(memory)) {
      console.warn(
        "ts/apps/web/src/route/url.ts: tab memory does not decode",
        Cause.pretty(memory.cause),
      );
      return undefined;
    }
    const tabs = memory.value;
    const focused = sessionStorage.getItem("pe.place.focus");
    const matches = tabs.filter(
      (tab) => new URL(tab.link, "http://tab.invalid").pathname === pathname,
    );
    const tab = matches.find((tab) => tab.id === focused) ?? matches.at(-1);
    return tab
      ? Object.fromEntries(new URL(tab.link, "http://tab.invalid").searchParams)
      : undefined;
  } catch (error) {
    console.warn("ts/apps/web/src/route/url.ts: fallback after failure", error);
    return undefined;
  }
}

export function restorePageSearch(memory?: Record<string, unknown>, url?: Record<string, unknown>) {
  return memory || url
    ? {
        ...memory,
        ...Object.fromEntries(Object.entries(url ?? {}).filter(([, value]) => value !== undefined)),
      }
    : undefined;
}

/** Restore before device admission, so a bare fixture Place never falls into the host lane. */
export function useRestoreTabPage() {
  const router = useRouter();
  const at = useRouterState({ select: (state) => state.location });
  const explicit = new Set(new URLSearchParams(at.searchStr).keys());
  const memory =
    "__pePageMove" in at.state || "__peRouteTab" in at.state ? undefined : tabPageSearch(at.pathname);
  const search =
    restorePageSearch(
      // Memory is codec text; navigate takes parsed values, so it crosses the router's own parser.
      // Raw text here would be JSON-stringified again (`{..}` -> `"{..}"`) and refused by its codec.
      memory &&
        router.options.parseSearch(`?${new URLSearchParams(memory as Record<string, string>)}`),
      Object.fromEntries(Object.entries(at.search).filter(([key]) => explicit.has(key))),
    ) ?? {};
  const restoring = Object.keys(search).some((key) => !(key in at.search));
  useEffect(() => {
    if (restoring)
      void router.navigate({
        to: at.pathname,
        search,
        replace: true,
        ignoreBlocker: true,
      } as never);
  }, [restoring, at.href]);
}
