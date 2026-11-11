import { z } from "zod";
import { INVALID, type Codec } from "./page-keys.ts";

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
 * A field with neither is Page state the route declares but never projects. Each route declares its
 * fields in its address table row (`routes/table.generated.ts`, or a hand file it imports); every projection (`route-address.ts`) is derived from them; nothing here keeps a second schema of the same key. Contracts are
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
  cardinality?: "one" | "many";
  schema: S;
  codec: Codec<z.output<S>>;
}

/** Presence survives decoding: an explicit empty/default value must override Place memory. */
export function decodePageField(
  field: Pick<RouteField, "schema" | "codec">,
  search: Record<string, unknown>,
  id: string,
) {
  const present = Object.hasOwn(search, id) && search[id] !== undefined;
  const raw = search[id];
  let decoded = field.schema.safeParse(raw);
  if (!decoded.success && ["string", "number", "boolean"].includes(typeof raw)) {
    try {
      decoded = field.schema.safeParse(field.codec.decode(String(raw)));
    } catch (error) {
      console.warn("ts/packages/agent-contracts/src/route-field.ts: fallback after failure", error);
      // The original failed schema result is the refusal, never an empty selection.
    }
  }
  return { present, decoded };
}

const WRAPPERS = new Set(["default", "optional", "nullable", "readonly", "catch", "prefault"]);
export const bare = (schema: z.ZodType): z.ZodType =>
  WRAPPERS.has(schema.def.type)
    ? bare((schema.def as unknown as { innerType: z.ZodType }).innerType)
    : schema;

export const textCodec: Codec<string> = { encode: (value) => value, decode: (text) => text };
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

};

/** Top-level collection values require a collection constructor. Objects may contain arrays. */
export type ScalarSchema<S extends z.ZodType> =
  Extract<z.output<S>, readonly unknown[]> extends never ? S : never;
type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** Primitive assignability also preserves schemas whose enum keys are still generic. */
export function field<S extends z.ZodType<Primitive>, const A extends Access>(
  schema: S,
  access: A,
  codec?: Codec<z.output<S>>,
): RouteField<S> & A;
/** Structured scalar values bring a codec; top-level collections use their own constructors. */
export function field<S extends z.ZodType, const A extends Access>(
  schema: ScalarSchema<S>,
  access: A,
  codec?: Codec<z.output<S>>,
): RouteField<S> & A;
export function field<S extends z.ZodType, const A extends Access>(
  schema: S,
  access: A,
  codec?: Codec<z.output<S>>,
): RouteField<S> & A {
  const found = codec ?? (CODECS[bare(schema).def.type] as Codec<z.output<S>> | undefined);
  if (!found) throw Error(`a ${bare(schema).def.type} field needs a codec`);
  return {
    schema,
    codec: found,
    ...access,

  };
}

export type Resolve = (
  input: Record<string, unknown>,
  facts: Record<string, unknown>,
) => { ok: true; patch: Record<string, string> } | { ok: false; error: string };

export type Fields = Record<string, RouteField>;

export interface RouteDeclaration<F extends Fields = Fields> {
  /** The link target; the web file route of the same path owns it. */
  path: `/${string}`;
  title: string;
  fields: F;
  /** The web folder of the builtin declared at this key; absent for a route no builtin owns. */
  module?: string;
  /**
   * A rule between fields: the key that breaks it and why, or null. `transition` (a person's move
   * and Pea's alike) refuses a named key that breaks it and resets an unnamed one to its default;
   * `read` (a forgiving URL read) resets either.
   */
  conflict?: (page: Record<string, unknown>) => { key: string; error: string } | null;
  /** Present when the route leases a mounted view to Pea; its `agent` fields are the lease. */
  agent?: {
    /** What the person sees, and the rule Pea follows when it sets a key. */
    policy: string;
    /** Search words Pea finds the view by, beside its title. */
    finds?: readonly string[];
    /** Input words beside the keys that `resolve` turns into keys. */
    words?: z.ZodObject<Record<string, z.ZodString>>;
    /** Turns the patch Pea wrote into one the lease can take, or refuses it by name. */
    resolve?: Resolve;
  };
}

/** A text field: empty by default. */
export const text = (max = 200) => z.string().max(max).default("");

export const keysWhere = (fields: Fields, keep: (field: RouteField) => boolean) =>
  Object.keys(fields).filter((key) => keep(fields[key]!));
export const setKeys = (fields: Fields) => keysWhere(fields, (field) => field.agent === "set");

/** Exact set spelling, including ids containing commas. `all` resolves against the current roster. */
export type Many = string[] | "all";
export const manyCodec: Codec<Many> = {
  encode: value => value === "all" ? "all" : value.map(id =>
    id === "all" ? "%61ll" : encodeURIComponent(id).replaceAll("~", "%7E").replaceAll("%20", " ")
  ).join(","),
  decode: text => {
    if (text === "all") return "all";
    try { return text ? text.split(",").map(decodeURIComponent) : []; }
    catch { return INVALID; }
  },
};
export const stableKeyKinds = ["UniqueId", "system-name", "name"] as const;
export type StableKeyKind = (typeof stableKeyKinds)[number];
export function manyField<const A extends Access & { cap?: number; initial?: Many; choices?: readonly string[]; schema?: never; codec?: never; cardinality?: never; keyKind?: never }>(
  keyKind: StableKeyKind, access: A,
) {
  if (!stableKeyKinds.includes(keyKind)) throw Error("Subject keys must be stable; ElementId is refused");
  const { cap = 50000, initial = [], choices, ...projection } = access;
  return {
    ...projection,
    schema: z.union([z.array(z.string().min(1).refine(id => !choices || choices.includes(id), "Unknown key")).max(cap), z.literal("all")]).default(initial),
    codec: manyCodec,
    cardinality: "many" as const,
    keyKind,
  };
}
/** Structured scalar Page values have one JSON spelling. */
export const jsonCodec = <S extends z.ZodType>(schema: S): Codec<z.output<S>> => ({
  encode: JSON.stringify,
  decode: text => {
    try { const result = schema.safeParse(JSON.parse(text)); return result.success ? result.data : INVALID; }
    catch { return INVALID; }
  },
});
export const resolveMany = (value: Many, roster: readonly string[]) =>
  value === "all" ? [...roster] : [...new Set(value)];

/** Ordered column priorities; order and direction survive URL and agent projections. */
export function sortField<const A extends Access>(access: A) {
  const schema = z.object({ columns: z.array(z.object({
    key: z.string().min(1).max(512), dir: z.enum(["asc", "desc"]),
  }).strict()).max(8) }).strict().default({ columns: [] });
  return { ...access, schema, codec: jsonCodec(schema) };
}
/** A set of column keys: presence means hidden, with no ordered-list semantics. */
export function keyedSetField<const A extends Access>(access: A) {
  const schema = z.record(z.string().min(1).max(512), z.literal(true)).default({});
  return { ...access, schema, codec: jsonCodec(schema) };
}

/** Ordered non-subject Page data, e.g. /captures' open-picture list. Unlike Many,
 * it preserves duplicates and has no `all`. The wrapper keeps bare arrays refused.
 * /captures keeps its current ids/all behavior until U9 rules on its migration. */
export function orderedListField<S extends z.ZodType, const A extends Access>(
  itemSchema: S,
  access: A & { cap: number },
) {
  const { cap, ...projection } = access;
  if (!Number.isSafeInteger(cap) || cap < 0)
    throw Error("Ordered list cap must be a nonnegative integer");
  const schema = z.strictObject({ items: z.array(itemSchema).max(cap) }).default({ items: [] });
  return { ...projection, schema, codec: jsonCodec(schema) };
}
