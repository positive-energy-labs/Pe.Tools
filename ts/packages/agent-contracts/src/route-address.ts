import { z } from "zod";
import { INVALID } from "./page-keys.ts";
import {
  bare,
  keysWhere,
  setKeys,
  textCodec,
  type Fields,
  type History,
  type RouteAddress,
  type RouteField,
} from "./route-field.ts";
import { routeAddresses } from "./routes/index.ts";

/**
 * What a route's address derives: its typed Page, its URL and link projection, its history rule,
 * and Pea's lease of it. The fields themselves live in `routes/<route>.ts` over the kernel in
 * `route-field.ts`; nothing here declares a key.
 */

/* ── Types ───────────────────────────────────────────────────────────────────── */

type Routes = typeof routeAddresses;
export type RouteKey = keyof Routes;
type FieldsOf<R extends RouteKey> = Routes[R]["fields"];
type SchemaOf<F> = F extends { schema: infer S extends z.ZodType } ? S : never;
type KeysWhere<F, M> = { [K in keyof F]: F[K] extends M ? K : never }[keyof F] & string;

/** Every declared field of a route, typed. */
export type RoutePage<R extends RouteKey> = {
  [K in keyof FieldsOf<R>]: z.output<SchemaOf<FieldsOf<R>[K]>>;
};
type UrlKey<R extends RouteKey> = KeysWhere<FieldsOf<R>, { url: History }>;
type ShareKey<R extends RouteKey> = Exclude<UrlKey<R>, KeysWhere<FieldsOf<R>, { share: false }>>;
export type UrlPage<R extends RouteKey> = Pick<RoutePage<R>, UrlKey<R>>;
export type LinkPage<R extends RouteKey> = Partial<Pick<RoutePage<R>, ShareKey<R>>>;

export type RouteViewRoute = {
  [R in RouteKey]: Routes[R] extends { agent: object } ? R : never;
}[RouteKey];

/** Root keys a link carries beside any route's fields; no route declares one. `shell` is never carried. */
const carryKeys = ["thread", "target", "work"] as const;
export type Carry = Partial<Record<(typeof carryKeys)[number], string>>;

/* ── Field reads and writes ──────────────────────────────────────────────────── */

const fieldsOf = (route: RouteKey) => routeAddresses[route].fields as Fields;

/** The router JSON-parses `selected=8081605` into a number and `target={..}` into an object. */
const textOf = (raw: unknown): string | undefined =>
  raw === undefined || raw === null
    ? undefined
    : typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.join(",")
        : typeof raw === "object"
          ? JSON.stringify(raw)
          : String(raw as number | boolean);

/** One field from raw search or lease text; malformed or refused falls to the default. */
const readField = (field: RouteField, raw: unknown): unknown => {
  if (raw !== null && typeof raw === "object") {
    const typed = field.schema.safeParse(raw);
    if (typed.success) return typed.data;
  }
  const text = textOf(raw);
  const decoded = text === undefined ? undefined : field.codec.decode(text);
  // `INVALID` reads as absent (the default); a decoded `null` is a value the schema judges.
  const parsed = field.schema.safeParse(decoded === INVALID ? undefined : decoded);
  return parsed.success ? parsed.data : field.schema.parse(undefined);
};

/** Undefined when the value is its default (or absent), so the address stays bare. */
const writeField = (field: RouteField, value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  const initial = field.schema.parse(undefined);
  const encoded = field.codec.encode(value);
  return initial !== undefined && encoded === field.codec.encode(initial) ? undefined : encoded;
};

/** The route's typed Page schema of every declared field; a web page `.extend`s it with Page-only state. */
export const routePageSchema = <R extends RouteKey>(route: R) =>
  z.object(
    Object.fromEntries(Object.entries(fieldsOf(route)).map(([key, f]) => [key, f.schema])),
  ) as unknown as z.ZodObject<{ [K in keyof FieldsOf<R> & string]: SchemaOf<FieldsOf<R>[K]> }>;

const conflictOf = (route: RouteKey) => (routeAddresses[route] as RouteAddress).conflict;

/** `page` with each key that breaks the route's `conflict` rule reset to its default. */
function settlePage<P extends Record<string, unknown>>(route: RouteKey, page: P): P {
  const conflict = conflictOf(route);
  const fields = fieldsOf(route);
  let settled = page;
  for (let found = conflict?.(settled); found; found = conflict?.(settled)) {
    const initial = fields[found.key]!.schema.parse(undefined);
    if (settled[found.key] === initial)
      throw Error(`${route}: ${found.key}'s default breaks its own rule`);
    settled = { ...settled, [found.key]: initial };
  }
  return settled;
}

/* ── URL projection ──────────────────────────────────────────────────────────── */

/** The keys the address bar holds. */
export const urlKeys = (route: RouteKey) => keysWhere(fieldsOf(route), (field) => !!field.url);

/** Search (router-parsed or raw strings) → the URL page, typed, and the root carry. */
export function readLink<R extends RouteKey>(
  route: R,
  search: Record<string, unknown>,
): { page: UrlPage<R>; carry: Carry } {
  const fields = fieldsOf(route);
  const page = settlePage(
    route,
    Object.fromEntries(urlKeys(route).map((key) => [key, readField(fields[key]!, search[key])])),
  );
  const carry = Object.fromEntries(
    carryKeys.flatMap((key) => {
      const value = textOf(search[key])?.trim();
      return value ? [[key, value]] : [];
    }),
  );
  return { page: page as UrlPage<R>, carry };
}

/**
 * Page → the address bar's search: each URL key the page names, a default as `undefined` so a merge
 * drops it. Draft keys (`share: false`) included; this is the address, not a link.
 */
export function writeSearch<R extends RouteKey>(
  route: R,
  page: Partial<RoutePage<R>>,
): Record<string, string | undefined> {
  const fields = fieldsOf(route);
  return Object.fromEntries(
    urlKeys(route)
      .filter((key) => key in page)
      .map((key) => [key, writeField(fields[key]!, (page as Record<string, unknown>)[key])]),
  );
}

/**
 * The one link builder: a shareable path for `route` with the given keys and carry, defaults
 * dropped. A key that is not a shareable URL key is a type error, and a thrown one for an untyped
 * caller; nothing is read from the current location, so no draft or shell leaks.
 */
export function linkTo<R extends RouteKey>(
  route: R,
  page: LinkPage<R> = {},
  carry: Carry = {},
): string {
  const fields = fieldsOf(route);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(page)) {
    const field = fields[key];
    if (!field?.url || field.share === false) throw Error(`${route} links carry no '${key}'`);
    const written = writeField(field, value);
    if (written !== undefined) params.set(key, written);
  }
  for (const key of carryKeys) if (carry[key]) params.set(key, carry[key]);
  const search = params.toString();
  return `${routeAddresses[route].path}${search ? `?${search}` : ""}`;
}

/**
 * A thread tab's link, canonical: `linkTo(route, page, { target, work })`. The path must be the
 * route's; a draft (`share: false`) or the browser `shell` drops; `thread` (the tab's own thread),
 * an unknown key, or a value its field cannot read is refused, never defaulted. Target and work
 * are kept: dropping them would retarget the tab.
 */
export function tabLink(
  route: string,
  link: string,
): { ok: true; route: RouteKey; link: string } | { ok: false; error: string } {
  if (!Object.hasOwn(routeAddresses, route)) return { ok: false, error: `no route '${route}'` };
  const key = route as RouteKey;
  let url: URL;
  try {
    url = new URL(link, "http://tab.invalid");
  } catch {
    return { ok: false, error: "a tab link is a path and search" };
  }
  if (url.origin !== "http://tab.invalid" || url.hash)
    return { ok: false, error: "a tab link is a path and search, no origin or hash" };
  if (url.pathname !== routeAddresses[key].path)
    return {
      ok: false,
      error: `a ${key} tab links ${routeAddresses[key].path}, not ${url.pathname}`,
    };
  const fields = fieldsOf(key);
  const page: Record<string, unknown> = {};
  const carry: Carry = {};
  for (const [name, text] of url.searchParams) {
    const field = fields[name];
    if (name === "target" || name === "work") carry[name] = text;
    else if (name === "shell" || (field?.url && field.share === false)) continue;
    else if (!field?.url) return { ok: false, error: `a ${key} tab link carries no '${name}'` };
    else {
      const decoded = field.codec.decode(text);
      const parsed = decoded === INVALID ? null : field.schema.safeParse(decoded);
      if (!parsed?.success) return { ok: false, error: `${key} '${name}' does not read: ${text}` };
      page[name] = parsed.data;
    }
  }
  // The route's rule between fields, as a move from the bare Place: a named key that breaks it is
  // refused, so a stored Place is never one `readLink` would silently fit.
  const moved = transition(key, readLink(key, {}).page as never, page as never);
  if (!moved.ok) return { ok: false, error: `${key} tab link: ${moved.error}` };
  return { ok: true, route: key, link: linkTo(key, moved.patch as never, carry) };
}

/**
 * How one transition moves history: null when no URL key changed (an agent-only or Page-only move
 * makes no entry); else the override (a gesture `replace`, a named move or Pea's patch `push`);
 * else `push` if any changed key is a step, `replace` when all are tweaks.
 */
export function historyOf<R extends RouteKey>(
  route: R,
  before: Partial<RoutePage<R>>,
  after: Partial<RoutePage<R>>,
  override?: History,
): History | null {
  const fields = fieldsOf(route);
  const changed = urlKeys(route).filter((key) => {
    const field = fields[key]!;
    const read = (page: object) =>
      key in page ? writeField(field, (page as Record<string, unknown>)[key]) : undefined;
    return key in after && read(before) !== read(after);
  });
  if (!changed.length) return null;
  return override ?? (changed.some((key) => fields[key]!.url === "push") ? "push" : "replace");
}

/* ── Agent projection ────────────────────────────────────────────────────────── */

export const routeViewRoutes = (Object.keys(routeAddresses) as RouteKey[]).filter(
  (route) => "agent" in routeAddresses[route],
) as [RouteViewRoute, ...RouteViewRoute[]];

/** The keys Pea reads on a leased view (`read` and `set`). */
export const agentKeys = (route: RouteKey) => keysWhere(fieldsOf(route), (field) => !!field.agent);

/** Page → the lease page: every agent key, as its codec writes it. */
export const agentPage = <R extends RouteKey>(route: R, page: Partial<RoutePage<R>>) => {
  const fields = fieldsOf(route);
  return Object.fromEntries(
    agentKeys(route).map((key) => {
      const value = (page as Record<string, unknown>)[key] ?? fields[key]!.schema.parse(undefined);
      return [key, value === undefined ? "" : fields[key]!.codec.encode(value)];
    }),
  );
};

/** The keys Pea sets, as Pea writes them: each its lease string, no default, none extra. */
export const routeAddressFields = (route: RouteKey) => {
  const fields = fieldsOf(route);
  return z.strictObject(
    Object.fromEntries(
      setKeys(fields).map((key) => {
        const field = fields[key]!;
        const inner = bare(field.schema);
        // A text field (its codec the identity) keeps its own schema, so an enum reads as one.
        return [
          key,
          field.codec === textCodec
            ? (inner as z.ZodType<string>)
            : z.string().refine((text) => {
                const decoded = field.codec.decode(text);
                return decoded !== INVALID && field.schema.safeParse(decoded).success;
              }, `${key} does not read as its codec writes it`),
        ];
      }),
    ) as Record<string, z.ZodType<string>>,
  );
};

/** The patch Pea sends: a nonempty subset of the route's `set` keys. */
export const routeViewPatchSchema = (route: RouteKey) =>
  routeAddressFields(route)
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, "a patch names at least one key");

/** A checked patch → the typed Page keys it sets. */
export const readAgentPatch = <R extends RouteKey>(route: R, patch: Record<string, string>) => {
  const fields = fieldsOf(route);
  return Object.fromEntries(
    Object.entries(routeViewPatchSchema(route).parse(patch)).map(([key, value]) => [
      key,
      readField(fields[key]!, value),
    ]),
  ) as Partial<RoutePage<R>>;
};

/**
 * The one transition rule, the same for a person and for Pea: `patch` (the keys the mover named)
 * over `current`. A named key that breaks the route's `conflict` rule is refused; a key it did not
 * name resets to its default (a mode alone fits its viewport). Field schemas judge one key each and
 * never this rule, so a page reaches it only through here (or `settlePage`, a forgiving URL read).
 */
export function transition<R extends RouteKey, P extends Partial<RoutePage<R>>>(
  route: R,
  current: P,
  patch: Partial<P>,
): { ok: true; page: P; patch: Partial<P> } | { ok: false; error: string } {
  const conflict = conflictOf(route);
  const fields = fieldsOf(route);
  const settled: Record<string, unknown> = { ...patch };
  for (;;) {
    const page = { ...current, ...settled } as P;
    const found = conflict?.(page);
    if (!found) return { ok: true, page, patch: settled as Partial<P> };
    if (found.key in patch || found.key in settled) return { ok: false, error: found.error };
    settled[found.key] = fields[found.key]!.schema.parse(undefined);
  }
}

/**
 * Pea's patch over the view it leased (`lease`: the lease page, as `agentPage` wrote it), through
 * `transition`; the settled patch comes back as lease strings. The patch must already pass
 * `routeViewPatchSchema`.
 */
export function settleAgentPatch(
  route: RouteKey,
  lease: Record<string, string>,
  patch: Record<string, string>,
): { ok: true; patch: Record<string, string> } | { ok: false; error: string } {
  const fields = fieldsOf(route);
  const read = (strings: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(strings).map(([key, value]) => [key, readField(fields[key]!, value)]),
    );
  const current = read(
    Object.fromEntries(
      agentKeys(route).flatMap((key) => (key in lease ? [[key, lease[key]!]] : [])),
    ),
  );
  const moved = transition(route, current as never, read(patch) as never);
  if (!moved.ok) return moved;
  return {
    ok: true,
    patch: Object.fromEntries(
      Object.entries(moved.patch as Record<string, unknown>).map(([key, value]) => [
        key,
        key in patch ? patch[key]! : fields[key]!.codec.encode(value),
      ]),
    ),
  };
}
