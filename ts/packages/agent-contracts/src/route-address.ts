import { z } from "zod";
import { layersKey, modeKey, subjectKey, viewportCodec, viewportKey } from "./page-keys.ts";

/**
 * A route's address: one set of field definitions, each typed with its default and its string
 * codec, and each saying on its own which projections hold it (ledger
 * `docs/features/design-system/LEDGER.md`, 2026-10-21 authorization: URL and Pea are separate axes).
 *
 * - `url`: the key rides the address bar, and the value is how a change of it moves history: a
 *   step `push`es, a tweak `replace`s. A transition may override it (a gesture replaces, a named
 *   move pushes). `share: false` keeps a URL key (a draft) out of every built link.
 * - `agent`: Pea reads the key on a leased view (`read`), or reads and sets it (`set`).
 *
 * A field with neither is Page state the route declares but never projects. Every projection below
 * is derived from these fields; nothing here keeps a second schema of the same key. Contracts are
 * pure: no router, no DOM. Nothing here is Work, so no transition replays a native action.
 */

export type History = "push" | "replace";

/** A value as one string: the link and lease form. `decode` is null on malformed text. */
export interface Codec<T> {
  encode(value: T): string;
  decode(text: string): T | null;
}

interface Access {
  url?: History;
  share?: false;
  agent?: "read" | "set";
}

export interface RouteField<S extends z.ZodType = z.ZodType> extends Access {
  /** The typed value; it accepts `undefined` (its default, or absent). */
  schema: S;
  codec: Codec<z.output<S>>;
}

const WRAPPERS = new Set(["default", "optional", "nullable", "readonly", "catch", "prefault"]);
const bare = (schema: z.ZodType): z.ZodType =>
  WRAPPERS.has(schema.def.type)
    ? bare((schema.def as unknown as { innerType: z.ZodType }).innerType)
    : schema;

const textCodec: Codec<string> = { encode: (value) => value, decode: (text) => text };
const CODECS: Record<string, Codec<unknown>> = {
  string: textCodec as Codec<unknown>,
  enum: textCodec as Codec<unknown>,
  number: {
    encode: (value) => String(value),
    decode: (text) => (text.trim() && Number.isFinite(Number(text)) ? Number(text) : null),
  },
  boolean: {
    encode: (value) => (value ? "1" : "0"),
    decode: (text) =>
      text === "1" || text === "true" ? true : text === "0" || text === "false" ? false : null,
  },
  array: {
    encode: (value) => (value as unknown[]).join(","),
    decode: (text) => text.split(",").filter(Boolean),
  },
};

/** One field: a plain string, enum, number, boolean or string list needs no codec; any other value brings one. */
export function field<S extends z.ZodType, const A extends Access>(
  schema: S,
  access: A,
  codec?: Codec<z.output<S>>,
): RouteField<S> & A {
  const found = codec ?? (CODECS[bare(schema).def.type] as Codec<z.output<S>> | undefined);
  if (!found) throw Error(`a ${bare(schema).def.type} field needs a codec`);
  return { schema, codec: found, ...access };
}

type Resolve = (
  input: Record<string, unknown>,
  facts: Record<string, unknown>,
) => { ok: true; patch: Record<string, string> } | { ok: false; error: string };

type Fields = Record<string, RouteField>;

export interface RouteAddress<F extends Fields = Fields> {
  /** The link target; the web file route of the same path owns it. */
  path: `/${string}`;
  title: string;
  fields: F;
  /** Present when the route leases a mounted view to Pea; its `agent` fields are the lease. */
  agent?: {
    /** What the person sees, and the rule Pea follows when it sets a key. */
    policy: string;
    /** Input words beside the keys that `resolve` turns into keys. */
    words?: z.ZodObject<Record<string, z.ZodString>>;
    /** Turns the patch Pea wrote into one the lease can take, or refuses it by name. */
    resolve?: Resolve;
  };
}

/* ── Fields ──────────────────────────────────────────────────────────────────── */

const text = (max = 200) => z.string().max(max).default("");

/** Entity routes: stage, pod and path are the address, so `/pods` deep-links a spec. */
const entityFields = {
  stage: field(z.enum(["audit", "apply", "archived"]).default("audit"), { url: "push" }),
  pod: field(text(), { url: "push" }),
  path: field(text(1024), { url: "push" }),
};
/** `?demo=<action>` mounts one seed in an isolated owner: a link's word, never Pea's. */
const demo = field(text(), { url: "replace" });

const ductsFields = {
  /** The subject: a Revit system name, read across every group it is in; empty = the whole document. */
  system: field(subjectKey(), { url: "push", agent: "set" }),
  /** A level id; empty = every level. */
  level: field(text(), { url: "push", agent: "set" }),
  /** The selected element id; empty = none. */
  selected: field(text(), { url: "push", agent: "set" }),
  /** The picture's encoding, a key of the web's `ENCODINGS`. */
  encoding: field(z.string().max(200).default("health"), { url: "push", agent: "set" }),
  /** The layer keys the picture draws, as `ducts.snapshot` names them (no fixed list); empty = none. */
  layers: field(layersKey([], []), { url: "push", agent: "set" }),
  /** The camera the model picture looks through: the isometric globe, or `plan` (a preset on it). */
  camera: field(modeKey(["iso", "plan"], "iso"), { url: "push", agent: "set" }),
  /** What the picture pane draws: the `model` in space, or the `schematic` one-line. */
  picture: field(modeKey(["model", "schematic"], "model"), { url: "push", agent: "set" }),
  /** Where the model picture looks from; a drag replaces, a preset pushes. */
  viewport: field(
    viewportKey({ kind: "orbit", yaw: 45, elev: 30, zoom: 1, pivot: [0, 0, 0] }),
    { url: "replace", agent: "set" },
    viewportCodec,
  ),
  /** The selected issue id (it may name no element); empty = none. Pea's, never the URL's. */
  issue: field(text(), { agent: "set" }),
  /** The Diagnostics kind picked in its key; empty = none. Pea reads it; only the person sets it. */
  diagnostic: field(text(), { agent: "read" }),
};

type DuctsFacts = {
  systems?: { name: string }[];
  levels?: { id: string; name: string }[];
};

/**
 * `system` is the page's subject, a Revit system name: the person's word resolves to the one
 * system the lease's facts name exactly (any case), else the one whose name holds it. A system
 * spans every duct network it is in; the page shows them all.
 */
function resolveDucts(input: Record<string, unknown>, facts: Record<string, unknown>) {
  const patch = { ...input } as Record<string, string>;
  const { systems = [], levels = [] } = facts as DuctsFacts;
  const keys = setKeys(ductsFields);
  const stray = Object.keys(patch).filter((key) => !keys.includes(key));
  if (stray.length)
    return {
      ok: false as const,
      error: `the Ducts page takes ${keys.join(", ")}, not ${stray.join(", ")}; name the system`,
    };
  if (patch.system?.trim()) {
    const word = patch.system.trim().toLowerCase();
    const exact = systems.filter((system) => system.name.toLowerCase() === word);
    const near = systems.filter((system) => system.name.toLowerCase().includes(word));
    const found = exact.length ? exact : near;
    if (found.length !== 1)
      return {
        ok: false as const,
        error: found.length
          ? `'${patch.system}' names ${found.length} systems (${found
              .slice(0, 12)
              .map((system) => system.name)
              .join(", ")}); name one`
          : `no system named '${patch.system}' on this page; read route:ducts.view for the system names`,
      };
    patch.system = found[0]!.name;
  }
  if (patch.level && !levels.some((level) => level.id === patch.level))
    return { ok: false as const, error: `unknown level '${patch.level}'` };
  return Object.keys(patch).length
    ? { ok: true as const, patch }
    : { ok: false as const, error: "name a system, level or selected element" };
}

/* ── Routes ──────────────────────────────────────────────────────────────────── */

export const routeAddresses = {
  ducts: {
    path: "/ducts",
    title: "Ducts",
    fields: ductsFields,
    agent: {
      policy:
        "Move the Ducts page in the person's open browser. Its subject: system (a Revit system name such as SA 19, as the person said it; it resolves against the view's system names), level and selected element id; an empty string clears the key. The page shows every duct network the system is in. Set the system only when the person named it, and never pick a system they did not name. Its picture: encoding, layers (comma separated layer keys), camera (iso or plan), picture (model or schematic) and viewport (orbit:yaw,elev,zoom@x,y,z in feet). issue selects one finding by id. Each set is one step the person can go Back from. No Work or Revit read.",
      resolve: resolveDucts,
    },
  },
  families: {
    path: "/families",
    title: "Families",
    fields: {
      ...entityFields,
      // ponytail: the web page overrides this default with its filter clauses (`DEFAULT_FAMILIES_QUERY`); move those clauses here to make this field the only default.
      query: field(text(4096), { url: "push", agent: "set" }),
      demo,
    },
    agent: {
      policy:
        "Change the query line of one mounted Families view. The browser acknowledges the rendered query and counts. No Work or Revit read.",
    },
  },
  family: {
    path: "/family",
    title: "Family",
    fields: {
      ...entityFields,
      capture: field(z.boolean().default(false), { url: "replace" }),
      demo,
    },
  },
  schedules: {
    path: "/schedules",
    title: "Schedules",
    fields: {
      ...entityFields,
      /** The open schedule's reading (`workspaceId`), so a reload reopens it. */
      schedule: field(text(), { url: "push" }),
    },
  },
  rooms: {
    path: "/rooms",
    title: "Rooms",
    fields: {
      stage: field(z.enum(["partition", "review", "history"]).default("partition"), {
        url: "push",
      }),
      /** The plan view partition runs on; empty = none chosen. */
      view: field(text(), { url: "push" }),
      /** Solver layers drawn on the plan (`rails,openings`); empty = none. */
      layers: field(layersKey([], []), { url: "push" }),
      /** Region labels (`R12,R3`): selected and zoomed to once drawn. */
      focus: field(text(1024), { url: "replace" }),
    },
  },
  takeoffs: {
    path: "/takeoffs",
    title: "Takeoffs",
    fields: {
      level: field(text(), { url: "push" }),
      zone: field(text(), { url: "push" }),
      room: field(text(), { url: "push" }),
      demo,
    },
  },
  pods: {
    path: "/pods",
    title: "Pods",
    fields: { pod: field(text(), { url: "push" }), path: field(text(1024), { url: "push" }), demo },
  },
  bind: {
    path: "/bind",
    title: "Bind",
    fields: {
      page: field(text(), { url: "push" }),
      view: field(z.boolean().default(false), { url: "push" }),
    },
  },
  settings: {
    path: "/settings",
    title: "Settings",
    fields: { section: field(text(), { url: "push" }), session: field(text(), { url: "push" }) },
  },
  ops: {
    path: "/ops",
    title: "Ops",
    fields: { op: field(text(), { url: "replace" }), actionId: field(text(), { url: "replace" }) },
  },
  pea: {
    path: "/pea",
    title: "Pea",
    fields: {
      mode: field(modeKey(["threads", "world"], "threads"), { url: "replace" }),
      /** The turn to focal-scroll on open; absent = the tail. */
      turn: field(z.number().int().positive().optional(), { url: "replace" }),
      plugin: field(text(), { url: "push" }),
      /** The group path (canonical JSON) the head's drill-in scoped the plugin to. */
      focus: field(text(4096), { url: "push" }),
      /** The composer draft: in the address bar, never in a link. */
      prompt: field(text(), { url: "replace", share: false }),
    },
  },
} satisfies Record<string, RouteAddress>;

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
export const carryKeys = ["thread", "target", "work"] as const;
export type Carry = Partial<Record<(typeof carryKeys)[number], string>>;

/* ── Field reads and writes ──────────────────────────────────────────────────── */

const fieldsOf = (route: RouteKey) => routeAddresses[route].fields as Fields;
const keysWhere = (fields: Fields, keep: (field: RouteField) => boolean) =>
  Object.keys(fields).filter((key) => keep(fields[key]!));
const setKeys = (fields: Fields) => keysWhere(fields, (field) => field.agent === "set");

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
  const text = textOf(raw);
  const decoded = text === undefined ? undefined : field.codec.decode(text);
  const parsed = field.schema.safeParse(decoded ?? undefined);
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

/* ── URL projection ──────────────────────────────────────────────────────────── */

/** The keys the address bar holds. */
export const urlKeys = (route: RouteKey) => keysWhere(fieldsOf(route), (field) => !!field.url);

/** Search (router-parsed or raw strings) → the URL page, typed, and the root carry. */
export function readLink<R extends RouteKey>(
  route: R,
  search: Record<string, unknown>,
): { page: UrlPage<R>; carry: Carry } {
  const fields = fieldsOf(route);
  const page = Object.fromEntries(
    urlKeys(route).map((key) => [key, readField(fields[key]!, search[key])]),
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
export const agentKeys = (route: RouteViewRoute) =>
  keysWhere(fieldsOf(route), (field) => !!field.agent);

/** Page → the lease page: every agent key, as its codec writes it. */
export const agentPage = <R extends RouteViewRoute>(route: R, page: Partial<RoutePage<R>>) => {
  const fields = fieldsOf(route);
  return Object.fromEntries(
    agentKeys(route).map((key) => {
      const value = (page as Record<string, unknown>)[key] ?? fields[key]!.schema.parse(undefined);
      return [key, value === undefined ? "" : fields[key]!.codec.encode(value)];
    }),
  );
};

/** The keys Pea sets, as Pea writes them: each its lease string, no default, none extra. */
export const routeAddressFields = (route: RouteViewRoute) => {
  const fields = fieldsOf(route);
  return z.strictObject(
    Object.fromEntries(
      setKeys(fields).map((key) => {
        const field = fields[key]!;
        const inner = bare(field.schema);
        return [
          key,
          inner.def.type === "string" || inner.def.type === "enum"
            ? (inner as z.ZodType<string>)
            : z.string().refine((text) => {
                const decoded = field.codec.decode(text);
                return decoded !== null && field.schema.safeParse(decoded).success;
              }, `${key} does not read as its codec writes it`),
        ];
      }),
    ) as Record<string, z.ZodType<string>>,
  );
};

/** The patch Pea sends: a nonempty subset of the route's `set` keys. */
export const routeViewPatchSchema = (route: RouteViewRoute) =>
  routeAddressFields(route)
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, "a patch names at least one key");

/** A checked patch → the typed Page keys it sets. */
export const readAgentPatch = <R extends RouteViewRoute>(
  route: R,
  patch: Record<string, string>,
) => {
  const fields = fieldsOf(route);
  return Object.fromEntries(
    Object.entries(routeViewPatchSchema(route).parse(patch)).map(([key, value]) => [
      key,
      readField(fields[key]!, value),
    ]),
  ) as Partial<RoutePage<R>>;
};

/** Browser-owned Page state of one mounted, visible view. `page` holds exactly the agent keys. */
export const routeViewSchema = z.strictObject({
  route: z.enum(routeViewRoutes),
  thread: z.string().min(1),
  instance: z.uuid(),
  surface: z.enum(["chat", "route"]),
  page: z.record(z.string(), z.string()),
  /** Identity of what is shown (reading, document, Work). A command's ack fails if it moves. */
  context: z.record(z.string(), z.unknown()),
  /** What the shown page derives (counts, rule help, group ids). Read-only for Pea. */
  facts: z.record(z.string(), z.unknown()),
});
export type RouteView = z.infer<typeof routeViewSchema>;

export const routeViewSetSchema = z.strictObject({
  thread: z.string().min(1),
  instance: z.uuid(),
  revision: z.number().int().nonnegative(),
  patch: z.record(z.string(), z.string()),
});
export const routeViewAckSchema = z.strictObject({
  instance: z.uuid(),
  commandId: z.uuid(),
  revision: z.number().int().nonnegative(),
  page: z.record(z.string(), z.string()),
  facts: z.record(z.string(), z.unknown()),
});
