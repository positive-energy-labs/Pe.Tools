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
 * fields in `routes/<route>.ts`; every projection (`route-address.ts`) is derived from them; nothing here keeps a second schema of the same key. Contracts are
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
  return {
    schema,
    codec: found,
    ...access,
    ...(bare(schema).def.type === "array" ? { cardinality: "many" as const } : {}),
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
  encode: (value) =>
    value == null ? "~null" : value === "all"
      ? "all"
      : (value as unknown[]).map((id) => typeof id === "string" ? (id === "all" ? "%61ll" : encodeURIComponent(id).replaceAll("~", "%7E")) : "~" + encodeURIComponent(JSON.stringify(id))).join(","),
  decode: (text) => {
    if (text === "all") return "all";
    if (text === "~null") return null as never;
    try {
      return text ? text.split(",").map((part) => part.startsWith("~") ? JSON.parse(decodeURIComponent(part.slice(1))) : decodeURIComponent(part)) : [];
    } catch {
      return INVALID;
    }
  },
};
export type StableKeyKind = "UniqueId" | "system-name" | "fan-mark" | "name";
export function manyField<const A extends Access, S extends z.ZodType = z.ZodDefault<z.ZodUnion<[z.ZodArray<z.ZodString>, z.ZodLiteral<"all">]>>>(keyKind: StableKeyKind, access: A, schema?: S) {
  if (!["UniqueId", "system-name", "fan-mark", "name"].includes(keyKind))
    throw Error("Subject keys must be stable; ElementId is refused");
  return {
    schema: (schema ?? z.union([z.array(z.string().min(1)), z.literal("all")]).default([])) as S,
    codec: manyCodec as unknown as Codec<z.output<S>>,
    cardinality: "many" as const,
    keyKind,
    ...access,
  };
}
export const resolveMany = (value: Many, roster: readonly string[]) =>
  value === "all" ? [...roster] : [...new Set(value)];
