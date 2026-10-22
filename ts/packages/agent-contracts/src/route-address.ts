import { z } from "zod";
import {
  INVALID,
  fitViewportCodec,
  layersKey,
  modeKey,
  orbitLooks,
  orbitViewportSchema,
  planeViewportSchema,
  subjectKey,
  viewportCodec,
  viewportKey,
  viewportSchema,
  type Codec,
  type OrbitLook,
  type OrbitViewport,
  type PlaneViewport,
  type Viewport,
} from "./page-keys.ts";
import { emptySpaceCut, spaceCutsSchema, spaceSceneSchema } from "./space-view.ts";

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
    decode: (text) => (text.trim() && Number.isFinite(Number(text)) ? Number(text) : INVALID),
  },
  boolean: {
    encode: (value) => (value ? "1" : "0"),
    decode: (text) =>
      text === "1" || text === "true" ? true : text === "0" || text === "false" ? false : INVALID,
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
  /**
   * A rule between fields: the key that breaks it and why, or null. `transition` (a person's move
   * and Pea's alike) refuses a named key that breaks it and resets an unnamed one to its default;
   * `settlePage` (a forgiving URL read) resets either.
   */
  conflict?: (page: Record<string, unknown>) => { key: string; error: string } | null;
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

/** A plan picture's pan and zoom; null = fit. A drag replaces; Pea may set it. */
const planViewport = field(
  viewportKey(planeViewportSchema),
  { url: "replace", agent: "set" },
  fitViewportCodec<PlaneViewport>(),
);

/** The layer keys the Ducts spatial picture draws. */
export const DUCTS_LAYERS = ["meshes", "context", "centrelines", "labels", "findings"] as const;

const ductsFields = {
  /** The subject: a Revit system name, read across every group it is in; empty = the whole document. */
  system: field(subjectKey(), { url: "push", agent: "set" }),
  /** A level id; empty = every level. */
  level: field(text(), { url: "push", agent: "set" }),
  /** The selected element id; empty = none. */
  selected: field(text(), { url: "push", agent: "set" }),
  /** The picture's encoding, a key of the web's `ENCODINGS`. */
  encoding: field(z.string().max(200).default("health"), { url: "push", agent: "set" }),
  /** The layer keys the picture draws; empty = none. */
  layers: field(layersKey(DUCTS_LAYERS, ["meshes", "labels", "findings"]), {
    url: "push",
    agent: "set",
  }),
  /** What the picture pane draws: the `model` in space, or the `schematic` one-line. */
  picture: field(modeKey(["model", "schematic"], "model"), { url: "push", agent: "set" }),
  /** Where the model picture looks from; null = fit the subject. A drag replaces, a preset pushes. */
  viewport: field(
    viewportKey(viewportSchema),
    { url: "replace", agent: "set" },
    fitViewportCodec<Viewport>(),
  ),
  /** The selected issue id (it may name no element); empty = none. Pea's, never the URL's. */
  issue: field(text(), { agent: "set" }),
  /** The Diagnostics kind picked in its key; empty = none. Pea reads it; only the person sets it. */
  diagnostic: field(text(), { agent: "read" }),
};

type DuctsFacts = {
  systems?: { name: string }[];
  levels?: { id: string; name: string }[];
  /** The orbit pose the picture shows, fitted or not, as `viewportCodec` writes it. */
  pose?: string;
};

const ductsWords = z.object({
  /** A direction the person names: plan, iso, north, south, east or west. */
  look: z.string().max(40),
});

/**
 * `system` is the page's subject, a Revit system name: the person's word resolves to the one
 * system the lease's facts name exactly (any case), else the one whose name holds it. A system
 * spans every duct network it is in; the page shows them all.
 */
function resolveDucts(input: Record<string, unknown>, facts: Record<string, unknown>) {
  const patch = { ...input } as Record<string, string>;
  const { systems = [], levels = [], pose } = facts as DuctsFacts;
  const keys = [...setKeys(ductsFields), ...Object.keys(ductsWords.shape)];
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
  if (patch.layers) {
    const known: readonly string[] = DUCTS_LAYERS;
    const unknown = patch.layers.split(",").filter((name) => !known.includes(name.trim()));
    if (unknown.length)
      return {
        ok: false as const,
        error: `unknown layers ${unknown.join(", ")}; the picture draws ${known.join(", ")}`,
      };
  }
  if (patch.look !== undefined) {
    const word = patch.look.trim().toLowerCase();
    const look = Object.hasOwn(orbitLooks, word) ? orbitLooks[word as OrbitLook] : null;
    if (!look)
      return {
        ok: false as const,
        error: `no look '${patch.look}'; say ${Object.keys(orbitLooks).join(", ")}`,
      };
    if ("viewport" in patch)
      return { ok: false as const, error: "name a look or a viewport, not both" };
    // A look turns the shown pose about its pivot; a fit has no pivot until the drawing publishes one.
    const shown = pose ? viewportCodec.decode(pose) : null;
    if (shown?.kind !== "orbit")
      return {
        ok: false as const,
        error:
          "the Ducts picture has published no orbit pose, so a look has no pivot to turn about; set viewport as orbit:yaw,elev,zoom@x,y,z, or empty to fit",
      };
    delete patch.look;
    patch.viewport = viewportCodec.encode({ ...shown, ...look });
  }
  return Object.keys(patch).length
    ? { ok: true as const, patch }
    : { ok: false as const, error: "name a system, level, selected element, look or viewport" };
}

/** Lossless JSON in the address: what `schema` parses (its key order), stringified; no rounding. */
const jsonCodec = <S extends z.ZodType>(schema: S): Codec<z.output<S>> => ({
  encode: (value) => {
    const parsed = schema.safeParse(value);
    return JSON.stringify(parsed.success ? parsed.data : value);
  },
  decode: (text) => {
    try {
      return JSON.parse(text) as z.output<S>;
    } catch {
      return INVALID;
    }
  },
});

/**
 * A Space element key: `JSON.stringify([documentKey, linkInstanceId ?? null, uniqueId])`, as the
 * scene's element handle names it. Structure only: whether the key's document is the scene's, and
 * whether the scene holds it, needs the loaded scene (runtime context, not this contract).
 */
export const spaceElementKey = (handle: {
  documentKey: string;
  linkInstanceId?: number | null;
  uniqueId: string;
}) => JSON.stringify([handle.documentKey, handle.linkInstanceId ?? null, handle.uniqueId]);

const isSpaceElementKey = (key: string) => {
  try {
    const value: unknown = JSON.parse(key);
    return (
      Array.isArray(value) &&
      value.length === 3 &&
      typeof value[0] === "string" &&
      value[0] !== "" &&
      (value[1] === null || Number.isSafeInteger(value[1])) &&
      typeof value[2] === "string" &&
      value[2] !== "" &&
      spaceElementKey({ documentKey: value[0], linkInstanceId: value[1], uniqueId: value[2] }) ===
        key
    );
  } catch {
    return false;
  }
};
const spaceElementKeySchema = z
  .string()
  .max(4096)
  .refine(isSpaceElementKey, "an element key is JSON [documentKey, linkInstanceId|null, uniqueId]");
const spaceElementKeys = z.array(spaceElementKeySchema).max(50000);

/** The saved view's own definitions (`space-view.ts`, version 2): the scene hash and the cuts. */
const spaceCuts = spaceCutsSchema.default({
  top: emptySpaceCut,
  north: emptySpaceCut,
  east: emptySpaceCut,
});

/** 3D orbits; an axis editor draws its plane. */
const SPACE_MODES = ["3d", "top", "north", "east"] as const;
const spaceViewport = z.discriminatedUnion("kind", [orbitViewportSchema, planeViewportSchema]);

/** Host element ids, comma joined; any non-integer part makes the whole list unreadable. */
const idsCodec: Codec<number[]> = {
  encode: (ids) => ids.join(","),
  decode: (text) => {
    const parts = text === "" ? [] : text.split(",");
    return parts.every((part) => /^-?\d+$/.test(part)) ? parts.map(Number) : INVALID;
  },
};

/** `""` is none (null); any other text is the key itself. */
const nullableText: Codec<string | null> = {
  encode: (value) => value ?? "",
  decode: (text) => (text === "" ? null : text),
};

const spaceFields = {
  /** The captured scene's hash; absent = none open. Only the capture verb writes a new one. */
  scene: field(spaceSceneSchema.optional(), { url: "push", agent: "read" }),
  /** Host element ids whose surrounding context a capture includes; a URL read never captures. */
  ids: field(z.array(z.number().int()).default([]), { url: "push", agent: "set" }, idsCodec),
  mode: field(modeKey(SPACE_MODES, "3d"), { url: "push", agent: "set" }),
  /** null = fit. `3d` holds an orbit, an axis a plane (`conflict`). A drag replaces. */
  viewport: field(
    viewportKey(spaceViewport),
    { url: "replace", agent: "set" },
    fitViewportCodec<OrbitViewport | PlaneViewport>(),
  ),
  /** One cut per axis (`space-view.ts`); an empty polyline clips nothing. */
  cuts: field(spaceCuts, { url: "replace", agent: "set" }, jsonCodec(spaceCuts)),
  selected: field(
    spaceElementKeySchema.nullable().default(null),
    { url: "push", agent: "set" },
    nullableText,
  ),
  hidden: field(
    spaceElementKeys.default([]),
    { url: "push", agent: "set" },
    jsonCodec(spaceElementKeys),
  ),
  /** null = every element shown; `[]` = nothing shown. */
  isolated: field(
    spaceElementKeys.nullable().default(null),
    { url: "push", agent: "set" },
    jsonCodec(spaceElementKeys.nullable()),
  ),
};

/** The viewport kind the mode draws: a wrong one is no pose for this mode. */
const spaceConflict = (page: Record<string, unknown>) => {
  const viewport = page.viewport as Viewport | null | undefined;
  const want = page.mode === "3d" ? "orbit" : "plane";
  return viewport && viewport.kind !== want
    ? {
        key: "viewport",
        error: `mode ${String(page.mode)} needs ${want === "orbit" ? "an orbit" : "a plane"} or fit viewport, not ${viewport.kind}`,
      }
    : null;
};

/** The Space picture's layers, in strip order; `meshes`, `context` and `cuts` are the scene's own. */
export const SPACE_LAYERS = [
  "meshes",
  "context",
  "cuts",
  "boxes",
  "levels",
  "tree",
  "slice",
  "probe",
  "sweep",
] as const;

/** The solver layers the Rooms plan draws, in strip order. */
export const ROOMS_LAYERS = ["rails", "openings", "network", "faces"] as const;

/** The Families query a page opens with: its filter clauses that default on (web `FAMILIES_FILTERS`). */
export const FAMILIES_DEFAULT_QUERY = "!empty !absent";

/** The Settings sections a link may open, in page order. */
export const SETTINGS_SECTIONS = [
  "revit",
  "update",
  "share",
  "pea",
  "host",
  "notices",
  "appearance",
] as const;

/** Galvanized steel's absolute roughness in feet: the duct-loss default and its material row. */
export const GALVANIZED_STEEL_ROUGHNESS = 0.0003;

/* ── Routes ──────────────────────────────────────────────────────────────────── */

export const routeAddresses = {
  ducts: {
    path: "/ducts",
    title: "Ducts",
    fields: ductsFields,
    agent: {
      policy:
        "Move the Ducts page in the person's open browser. Its subject: system (a Revit system name such as SA 19, as the person said it; it resolves against the view's system names), level and selected element id; an empty string clears the key. The page shows every duct network the system is in. Set the system only when the person named it, and never pick a system they did not name. Its picture: encoding, layers (comma separated: meshes, context, centrelines, labels, findings; empty = none), picture (model or schematic), and either look (plan, iso, north, south, east or west: the shown picture turned about its pivot) or viewport (orbit:yaw,elev,zoom@x,y,z in feet; empty fits the subject). issue selects one finding by id. Each set is one step the person can go Back from. No Work or Revit read.",
      words: ductsWords,
      resolve: resolveDucts,
    },
  },
  families: {
    path: "/families",
    title: "Families",
    fields: {
      ...entityFields,
      query: field(z.string().max(4096).default(FAMILIES_DEFAULT_QUERY), {
        url: "push",
        agent: "set",
      }),
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
      demo,
    },
  },
  schedules: {
    path: "/schedules",
    title: "Schedules",
    fields: {
      ...entityFields,
      /** The open schedule's reading, so a reload reopens it; opening one replaces the place. */
      workspaceId: field(text(), { url: "replace" }),
      demo,
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
      layers: field(layersKey(ROOMS_LAYERS, []), { url: "push" }),
      /** Region labels (`R12,R3`): selected and zoomed to once drawn. */
      focus: field(text(1024), { url: "replace" }),
      viewport: planViewport,
      demo,
    },
    agent: {
      policy:
        "Change only the viewport of the visible Rooms plan. Use plane:scale,tx,ty in the displayed frame, or an empty viewport to fit. Facts name the displayed document, acquired snapshot and plan. Focus, view, stage, layers and room selection remain the person's. A view change does not partition rooms, stage Work or write Revit.",
    },
  },
  takeoffs: {
    path: "/takeoffs",
    title: "Takeoffs",
    fields: {
      level: field(text(), { url: "push" }),
      zone: field(text(), { url: "push" }),
      room: field(text(), { url: "push" }),
      viewport: planViewport,
      demo,
    },
    agent: {
      policy:
        "Change only the viewport of the visible Takeoffs plan. Use plane:scale,tx,ty in the displayed frame, or an empty viewport to fit. Facts identify the exact live, saved or fixture capture and current level scope. This does not change level, zone, room, action scope, Work or an RHVAC file, and does not read or write Revit.",
    },
  },
  space: {
    path: "/space",
    title: "Space",
    fields: {
      ...spaceFields,
      /** The layers the picture draws, in `SPACE_LAYERS` order. */
      layers: field(layersKey(SPACE_LAYERS, ["meshes", "context", "cuts"]), {
        url: "push",
        agent: "set",
      }),
      demo,
    },
    conflict: spaceConflict,
    agent: {
      policy:
        "Change the visible captured Space picture using ids, mode, viewport, cuts, selected, hidden, isolated and layers. Scene is read-only. Use exact element keys from this loaded scene, preserving document and link identity; unknown members are refused. A null isolation shows all; an empty isolation shows none. Viewport must match the mode, or be empty to fit. Cuts use the scene frame. Editing ids only prepares a later explicit capture. View changes never capture, recapture, select in Revit or write Work.",
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
    fields: {
      section: field(z.enum(SETTINGS_SECTIONS).optional(), { url: "push" }),
      session: field(text(), { url: "push" }),
    },
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
      /** The composer draft: in the address bar, never in a link. */
      prompt: field(text(), { url: "replace", share: false }),
    },
  },
  /** The home directory: its filters. */
  home: {
    path: "/",
    title: "Home",
    fields: {
      query: field(text(), { url: "replace" }),
      exposure: field(z.enum(["All", "Main", "Preview", "Archive"]).default("All"), {
        url: "push",
      }),
      sort: field(z.enum(["workflow", "name"]).default("workflow"), { url: "push" }),
    },
  },
  "duct-loss": {
    path: "/duct-loss",
    title: "Duct Loss",
    fields: {
      shape: field(z.enum(["round", "rect"]).default("round"), { url: "push" }),
      // Typed inputs: each keystroke tweaks the place, so they replace.
      a: field(z.number().default(12), { url: "replace" }),
      b: field(z.number().default(8), { url: "replace" }),
      cfm: field(z.number().default(1000), { url: "replace" }),
      length: field(z.number().default(100), { url: "replace" }),
      roughness: field(z.number().default(GALVANIZED_STEEL_ROUGHNESS), { url: "replace" }),
      density: field(z.number().default(0.075), { url: "replace" }),
      face: field(z.enum(["commercial", "residential"]).default("commercial"), { url: "push" }),
    },
  },
  "parameter-links": {
    path: "/parameter-links",
    title: "Parameter Links",
    fields: { view: field(z.enum(["links", "plan"]).default("links"), { url: "push" }), demo },
  },
  captures: {
    path: "/captures",
    title: "Captures",
    fields: { sha: field(z.string().max(64).optional(), { url: "push" }) },
  },
  /** Carry only (target, work, thread): a typed link with no route keys. */
  "data-tables": { path: "/data-tables", title: "Data Tables", fields: {} },
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
const carryKeys = ["thread", "target", "work"] as const;
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
/** Why a mounted Page refused Pea's patch: the one list, which the web Page owner's refusals use too. */
export const routeViewRefusalCodes = [
  "not-ready",
  "no-target",
  "busy",
  "stale-revision",
  "conflict",
  "partial",
  "unknown",
  "failed",
] as const;
export type RouteViewRefusalCode = (typeof routeViewRefusalCodes)[number];
const ackFence = {
  instance: z.uuid(),
  commandId: z.uuid(),
  revision: z.number().int().nonnegative(),
};
/**
 * The browser's answer to one command. `rendered`: the patched Page rendered (the page and facts it
 * shows). `refused`: the Page owner refused the patch whole; `page` is the page it still shows, as
 * its codec writes it, and proves nothing moved. A refusal carries no facts: nothing rendered.
 */
export const routeViewAckSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("rendered"),
    ...ackFence,
    page: z.record(z.string(), z.string()),
    facts: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    outcome: z.literal("refused"),
    ...ackFence,
    page: z.record(z.string(), z.string()),
    refusal: z.strictObject({
      code: z.enum(routeViewRefusalCodes),
      message: z.string().min(1).max(2000),
      detail: z.string().max(4000).optional(),
    }),
  }),
]);
export type RouteViewAck = z.infer<typeof routeViewAckSchema>;
