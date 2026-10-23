import { z } from "zod";
import { INVALID } from "./page-keys.ts";
import {
  bare,
  keysWhere,
  setKeys,
  textCodec,
  type Fields,
  type History,
  type Resolve,
  type RouteDeclaration,
  type RouteField,
} from "./route-field.ts";
import { routeAddresses } from "./routes/index.ts";
import { threadListFields } from "./routes/shared.ts";

/**
 * A route's address, deep: `routeAddress(route)` is the one door every caller reaches a route through,
 * its typed Page, URL and link, history rule, transition and Pea's lease, all derived from the
 * fields `routes/<route>.ts` declares over the kernel in `route-field.ts`; nothing here declares a
 * key. A new capability grows as a member of `RouteAddress`, never as a loose helper beside it.
 */

/* ── Types ───────────────────────────────────────────────────────────────────── */

type Routes = typeof routeAddresses;
export type RouteKey = keyof Routes;
type FieldsOf<R extends RouteKey> = Routes[R]["fields"] & typeof threadListFields;
type SchemaOf<F> = F extends { schema: infer S extends z.ZodType } ? S : never;
type KeysWhere<F, M> = { [K in keyof F]: F[K] extends M ? K : never }[keyof F] & string;

/*
 * Each page type distributes over a union of routes: a caller that knows the route only as
 * `RouteKey` gets the union of every route's page, narrowed by `in`, never the near-empty
 * intersection of their keys; so `RouteAddress<RouteKey>` is any route's address, still typed.
 */

/** A page with no keys is closed: a bare `{}` member would let a union of pages take any object. */
type Closed<T> = [keyof T] extends [never] ? Record<string, never> : T;
type Fielded<R extends RouteKey> = {
  [K in keyof FieldsOf<R>]: z.output<SchemaOf<FieldsOf<R>[K]>>;
};
type UrlKey<R extends RouteKey> = R extends RouteKey
  ? KeysWhere<FieldsOf<R>, { url: History }>
  : never;
type ShareKey<R extends RouteKey> = Exclude<UrlKey<R>, KeysWhere<FieldsOf<R>, { share: false }>>;

/** Every declared field of a route, typed. */
export type RoutePage<R extends RouteKey> = R extends RouteKey ? Closed<Fielded<R>> : never;
/** The fields the address bar holds. */
export type UrlPage<R extends RouteKey> = R extends RouteKey
  ? Closed<Pick<Fielded<R>, UrlKey<R> & keyof Fielded<R>>>
  : never;
/** The fields a link carries: URL keys, drafts excepted. */
export type LinkPage<R extends RouteKey> = R extends RouteKey
  ? Closed<Partial<Pick<Fielded<R>, ShareKey<R> & keyof Fielded<R>>>>
  : never;

export type RouteViewRoute = {
  [R in RouteKey]: Routes[R] extends { agent: object } ? R : never;
}[RouteKey];

/** Root keys a link carries beside any route's fields; no route declares one. `shell` is never carried. */
const carryKeys = ["thread", "target", "work"] as const;
export type Carry = Partial<Record<(typeof carryKeys)[number], string>>;

type Moved<P> = { ok: true; page: P; patch: Partial<P> } | { ok: false; error: string };

/** Pea's lease of a mounted view: present on a route that declares `agent`. */
export interface RouteLease<R extends RouteKey> {
  /** What the person sees, and the rule Pea follows when it sets a key. */
  readonly policy: string;
  /** Search words Pea finds the view by, beside its title. */
  readonly finds?: readonly string[];
  /** Input words beside the keys that `resolve` turns into keys. */
  readonly words?: z.ZodObject<Record<string, z.ZodString>>;
  /** Turns the patch Pea wrote into one the lease can take, or refuses it by name. */
  readonly resolve?: Resolve;
  /** The keys Pea reads (`read` and `set`). */
  readonly keys: readonly string[];
  /** The keys Pea sets, as Pea writes them: each its lease string, no default, none extra. */
  readonly fields: z.ZodObject<Record<string, z.ZodType<string>>>;
  /** The patch Pea sends: a nonempty subset of `fields`. */
  readonly patch: z.ZodType<Record<string, string>>;
  /** Page → the lease page: every agent key, as its codec writes it. */
  write(page: Partial<RoutePage<R>>): Record<string, string>;
  /** A patch that passes `patch` → the typed Page keys it sets; throws on one that does not. */
  read(patch: Record<string, string>): Partial<RoutePage<R>>;
  /**
   * Pea's patch over the view it leased (`lease`: the lease page, as `write` wrote it), through
   * `transition`; the settled patch comes back as lease strings. The patch must already pass `patch`.
   */
  settle(
    lease: Record<string, string>,
    patch: Record<string, string>,
  ): { ok: true; patch: Record<string, string> } | { ok: false; error: string };
}

export interface RouteAddress<R extends RouteKey> {
  readonly route: R;
  /** The link target; the web file route of the same path owns it. */
  readonly path: Routes[R]["path"];
  readonly title: string;
  /** The typed Page schema of every declared field; a web page `.extend`s it with Page-only state. */
  readonly schema: R extends RouteKey
    ? z.ZodObject<{ [K in keyof FieldsOf<R> & string]: SchemaOf<FieldsOf<R>[K]> }>
    : never;
  /** Every field at its default: the bare Place. */
  readonly defaults: RoutePage<R>;
  /** The keys the address bar holds. */
  readonly keys: readonly UrlKey<R>[];
  /** Search (router-parsed or raw strings) → the URL page, typed, and the root carry. */
  read(search: Record<string, unknown>): { page: UrlPage<R>; carry: Carry };
  /**
   * Page → the address bar's search: each URL key the page names, a default as `undefined` so a
   * merge drops it. Draft keys (`share: false`) included; this is the address, not a link.
   */
  write(page: Partial<RoutePage<R>>): Record<string, string | undefined>;
  /**
   * The one link builder: a shareable path with the given keys and carry, defaults and drafts
   * dropped. A key that is not a URL key is a type error, and a thrown one for an untyped caller;
   * nothing is read from the current location, so no draft or shell leaks.
   */
  link(page?: LinkPage<R>, carry?: Carry): string;
  /**
   * A thread tab's link, canonical: `link(page, { target, work })`. The path must be the route's; a
   * draft or the browser `shell` drops; `thread` (the tab's own thread), an unknown key, or a value
   * its field cannot read is refused, never defaulted. Target and work are kept: dropping them
   * would retarget the tab.
   */
  tab(link: string): { ok: true; link: string } | { ok: false; error: string };
  /**
   * How one move lands in history: null when no URL key changed (an agent-only or Page-only move
   * makes no entry); else the override (a gesture `replace`, a named move or Pea's patch `push`);
   * else `push` if any changed key is a step, `replace` when all are tweaks.
   */
  history(
    before: Partial<RoutePage<R>>,
    after: Partial<RoutePage<R>>,
    override?: History,
  ): History | null;
  /**
   * The one transition rule, the same for a person and for Pea: `patch` (the keys the mover named)
   * over `current`. A named key that breaks the route's `conflict` rule is refused; a key it did
   * not name resets to its default (a mode alone fits its viewport). Field schemas judge one key
   * each and never this rule, so a page reaches it only through here (or `read`, which forgives).
   */
  transition<P extends Partial<RoutePage<R>>>(current: P, patch: Partial<P>): Moved<P>;
  /** A union of routes that mixes leasing and non-leasing ones may or may not hold a lease. */
  readonly agent: [R] extends [RouteViewRoute]
    ? RouteLease<R>
    : [Extract<R, RouteViewRoute>] extends [never]
      ? undefined
      : RouteLease<Extract<R, RouteViewRoute>> | undefined;
}

/* ── Field reads and writes ──────────────────────────────────────────────────── */

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

/* ── The address ─────────────────────────────────────────────────────────────── */

type Page = Record<string, unknown>;

function build(route: RouteKey) {
  const spec = routeAddresses[route] as RouteDeclaration;
  const fields: Fields = { ...threadListFields, ...spec.fields };
  const conflict = spec.conflict;
  const urlKeys = keysWhere(fields, (field) => !!field.url);
  const agentKeys = keysWhere(fields, (field) => !!field.agent);
  const initial = (key: string) => fields[key]!.schema.parse(undefined);
  const defaults = Object.fromEntries(Object.keys(fields).map((key) => [key, initial(key)]));

  /** `page` with each key that breaks the `conflict` rule reset to its default. */
  const settle = (page: Page): Page => {
    let settled = page;
    for (let found = conflict?.(settled); found; found = conflict?.(settled)) {
      if (settled[found.key] === initial(found.key))
        throw Error(`${route}: ${found.key}'s default breaks its own rule`);
      settled = { ...settled, [found.key]: initial(found.key) };
    }
    return settled;
  };

  const transition = (current: Page, patch: Page): Moved<Page> => {
    const settled: Page = { ...patch };
    for (;;) {
      const page = { ...current, ...settled };
      const found = conflict?.(page);
      if (!found) return { ok: true, page, patch: settled };
      if (found.key in patch || found.key in settled) return { ok: false, error: found.error };
      settled[found.key] = initial(found.key);
    }
  };

  const read = (search: Page) => ({
    page: settle(
      Object.fromEntries(urlKeys.map((key) => [key, readField(fields[key]!, search[key])])),
    ),
    carry: Object.fromEntries(
      carryKeys.flatMap((key) => {
        const value = textOf(search[key])?.trim();
        return value ? [[key, value]] : [];
      }),
    ) as Carry,
  });

  const link = (page: Page = {}, carry: Carry = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(page)) {
      const field = fields[key];
      if (!field?.url) throw Error(`${route} links carry no '${key}'`);
      if (field.share === false) continue;
      const written = writeField(field, value);
      if (written !== undefined) params.set(key, written);
    }
    for (const key of carryKeys) if (carry[key]) params.set(key, carry[key]);
    const search = params.toString();
    return `${spec.path}${search ? `?${search}` : ""}`;
  };

  const tab = (text: string) => {
    let url: URL;
    try {
      url = new URL(text, "http://tab.invalid");
    } catch {
      return { ok: false as const, error: "a tab link is a path and search" };
    }
    if (url.origin !== "http://tab.invalid" || url.hash)
      return { ok: false as const, error: "a tab link is a path and search, no origin or hash" };
    if (url.pathname !== spec.path)
      return {
        ok: false as const,
        error: `a ${route} tab links ${spec.path}, not ${url.pathname}`,
      };
    const page: Page = {};
    const carry: Carry = {};
    for (const [name, value] of url.searchParams) {
      const field = fields[name];
      if (name === "target" || name === "work") carry[name] = value;
      else if (name === "shell" || (field?.url && field.share === false)) continue;
      else if (!field?.url)
        return { ok: false as const, error: `a ${route} tab link carries no '${name}'` };
      else {
        const decoded = field.codec.decode(value);
        const parsed = decoded === INVALID ? null : field.schema.safeParse(decoded);
        if (!parsed?.success)
          return { ok: false as const, error: `${route} '${name}' does not read: ${value}` };
        page[name] = parsed.data;
      }
    }
    // The route's rule between fields, as a move from the bare Place: a named key that breaks it is
    // refused, so a stored Place is never one `read` would silently fit.
    const moved = transition(read({}).page, page);
    if (!moved.ok) return { ok: false as const, error: `${route} tab link: ${moved.error}` };
    return { ok: true as const, link: link(moved.patch, carry) };
  };

  const history = (before: Page, after: Page, override?: History): History | null => {
    const changed = urlKeys.filter((key) => {
      const field = fields[key]!;
      const written = (page: Page) => (key in page ? writeField(field, page[key]) : undefined);
      return key in after && written(before) !== written(after);
    });
    if (!changed.length) return null;
    return override ?? (changed.some((key) => fields[key]!.url === "push") ? "push" : "replace");
  };

  return {
    route,
    path: spec.path,
    title: spec.title,
    schema: z.object(Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.schema]))),
    defaults,
    keys: urlKeys,
    read,
    write: (page: Page) =>
      Object.fromEntries(
        urlKeys
          .filter((key) => key in page)
          .map((key) => [key, writeField(fields[key]!, page[key])]),
      ),
    link,
    tab,
    history,
    transition,
    agent: spec.agent && lease(fields, agentKeys, spec.agent, transition),
  };
}

function lease(
  fields: Fields,
  agentKeys: string[],
  spec: NonNullable<RouteDeclaration["agent"]>,
  transition: (current: Page, patch: Page) => Moved<Page>,
) {
  const sets = z.strictObject(
    Object.fromEntries(
      setKeys(fields).map((key) => {
        const field = fields[key]!;
        const inner = bare(field.schema);
        // A text field (its codec the identity) keeps its own schema, so an enum reads as one.
        return [
          key,
          field.codec === textCodec
            ? (inner as z.ZodType<string>)
            : z
                .string()
                .refine((text) => {
                  const decoded = field.codec.decode(text);
                  return decoded !== INVALID && field.schema.safeParse(decoded).success;
                }, `${key} does not read as its codec writes it`)
                .describe(field.schema.description ?? "Encoded page field"),
        ];
      }),
    ) as Record<string, z.ZodType<string>>,
  );
  const patch = sets
    .partial()
    .refine((value) => Object.keys(value).length > 0, "a patch names at least one key");
  const readStrings = (strings: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(strings).map(([key, value]) => [key, readField(fields[key]!, value)]),
    );
  return {
    ...spec,
    resolve:
      spec.resolve &&
      ((input: Record<string, unknown>, facts: Record<string, unknown>) => {
        const shared = Object.fromEntries(
          Object.entries(input).filter(([key]) => Object.hasOwn(threadListFields, key)),
        );
        const own = Object.fromEntries(
          Object.entries(input).filter(([key]) => !Object.hasOwn(threadListFields, key)),
        );
        const checked = Object.keys(shared).length ? patch.safeParse(shared) : undefined;
        if (checked && !checked.success)
          return { ok: false as const, error: checked.error.message };
        const resolved =
          Object.keys(own).length || !checked
            ? spec.resolve!(own, facts)
            : { ok: true as const, patch: {} };
        return resolved.ok
          ? { ok: true as const, patch: { ...resolved.patch, ...checked?.data } }
          : resolved;
      }),
    keys: agentKeys,
    fields: sets,
    patch: patch as z.ZodType<Record<string, string>>,
    write: (page: Page) =>
      Object.fromEntries(
        agentKeys.map((key) => {
          const value = page[key] ?? fields[key]!.schema.parse(undefined);
          return [key, value === undefined ? "" : fields[key]!.codec.encode(value)];
        }),
      ),
    read: (value: Record<string, string>) =>
      readStrings(patch.parse(value) as Record<string, string>),
    settle: (leased: Record<string, string>, value: Record<string, string>) => {
      const current = readStrings(
        Object.fromEntries(
          agentKeys.flatMap((key) => (key in leased ? [[key, leased[key]!]] : [])),
        ),
      );
      const moved = transition(current, readStrings(value));
      if (!moved.ok) return moved;
      return {
        ok: true as const,
        patch: Object.fromEntries(
          Object.entries(moved.patch).map(([key, settled]) => [
            key,
            key in value ? value[key]! : fields[key]!.codec.encode(settled),
          ]),
        ),
      };
    },
  };
}

const built = new Map<RouteKey, ReturnType<typeof build>>();

/**
 * The route's one deep address; the same object on every call. A route known only as `RouteKey`
 * gets any route's address: its pages are the union of every route's, narrowed by `in`.
 */
export function routeAddress<R extends RouteKey>(route: R): RouteAddress<R> {
  let found = built.get(route);
  if (!found) built.set(route, (found = build(route)));
  // `build` runs over untyped fields; the declaration in `routes/<route>.ts` is what types them.
  return found as unknown as RouteAddress<R>;
}

/* ── The registry ────────────────────────────────────────────────────────────── */

// `Object.keys` types its keys as `string`; these are exactly the registry's.
export const routeKeys = Object.keys(routeAddresses) as [RouteKey, ...RouteKey[]];

/** The route a key names, or null: the check for a route that arrives as text. */
export const routeOf = (key: string): RouteKey | null =>
  routeKeys.find((route) => route === key) ?? null;

/** The route whose path `pathname` is, or null. */
export const routeAt = (pathname: string): RouteKey | null =>
  routeKeys.find((key) => routeAddresses[key].path === pathname) ?? null;

/** The routes that lease a mounted view to Pea. */
// `filter` cannot narrow by a declaration's `agent` member; `RouteViewRoute` is the same rule, typed.
export const routeViewRoutes = routeKeys.filter((route) => "agent" in routeAddresses[route]) as [
  RouteViewRoute,
  ...RouteViewRoute[],
];
