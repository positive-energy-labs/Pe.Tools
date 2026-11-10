import { z } from "zod";

/*
 * SubjectRef (ADR 0035 rule 2): the one identity of a subject everywhere, carried as one branded
 * codec string and decoded at every door. `source` is the element's own document and omitted
 * means the host document; `placement` is the ordered link path the subject is seen through and is
 * orthogonal to `sub`; `sub` is a port or a field, never a free string. A document mark is
 * observation basis and never part of it. No migration: stored Work in an older spelling is
 * discarded (ADR 0033 rule 5).
 *
 * Codec, segments in this order, each at most once:
 *   <kind>:<key>  [~<source>]  [@<host>/<link>[/<link>...]]  [#port:<n> | #field:<name>]
 * `~source` is this module's choice: the ruled grammar names three segments and the ruled type
 * carries `source`, so the string needs a fourth slot; the owner may fold it elsewhere.
 * Every segment text is escaped, so `%`, `:`, `~`, `@`, `#` and `/` inside a key round-trip, and
 * decode accepts only the canonical spelling (decode(code) re-encodes to exactly code).
 */
declare const subjectRefCode: unique symbol;
export type SubjectRefCode = string & { readonly [subjectRefCode]: true };
declare const uniqueId: unique symbol;
/** A Revit UniqueId; an integer-only ElementId is refused, it is session-local and never identity. */
export type UniqueId = string & { readonly [uniqueId]: true };
declare const documentKey: unique symbol;
export type DocumentKey = string & { readonly [documentKey]: true };

export const SUBJECT_KEY_KINDS = [
  "UniqueId",
  "system-name",
  "name",
  "workspace",
  "region",
  "group",
] as const;
export type SubjectKeyKind = (typeof SUBJECT_KEY_KINDS)[number];

const text = z.string().min(1);
export const uniqueIdSchema = z.custom<UniqueId>(
  (v) => typeof v === "string" && v.length > 0 && !/^[+-]?\d+$/.test(v),
  { message: "a UniqueId is a non-empty string and never an ElementId" },
);
export const documentKeySchema = z.custom<DocumentKey>(
  (v) => typeof v === "string" && v.length > 0,
  {
    message: "a document key is a non-empty string",
  },
);
const placementSchema = z.strictObject({
  host: documentKeySchema,
  links: z.array(uniqueIdSchema).min(1).readonly(),
});
const subSchema = z.union([
  z.strictObject({ port: z.int().nonnegative() }),
  z.strictObject({ field: text }),
]);
const common = {
  source: documentKeySchema.optional(),
  placement: placementSchema.optional(),
  sub: subSchema.optional(),
};
/** `key` is typed per kind: a name key is the tuple itself (a family type is `[family, type]`). */
export const subjectRefSchema = z.discriminatedUnion("keyKind", [
  z.strictObject({ ...common, keyKind: z.literal("UniqueId"), key: uniqueIdSchema }),
  z.strictObject({ ...common, keyKind: z.literal("system-name"), key: text }),
  z.strictObject({
    ...common,
    keyKind: z.literal("name"),
    key: z.array(z.string()).min(1).readonly(),
  }),
  z.strictObject({ ...common, keyKind: z.literal("workspace"), key: text }),
  z.strictObject({ ...common, keyKind: z.literal("region"), key: text }),
  z.strictObject({ ...common, keyKind: z.literal("group"), key: text }),
]);
export type SubjectRef = z.output<typeof subjectRefSchema>;
export type SubjectPlacement = z.output<typeof placementSchema>;
export type SubjectSub = z.output<typeof subSchema>;

export type SubjectRefRefusal = {
  readonly ok: false;
  readonly code:
    | "malformed"
    | "unknown-kind"
    | "bad-key"
    | "bad-escape"
    | "bad-source"
    | "bad-placement"
    | "bad-sub"
    | "document-mark";
  readonly reason: string;
};
export type SubjectRefResult<T> = { readonly ok: true; readonly value: T } | SubjectRefRefusal;
const refuse = (code: SubjectRefRefusal["code"], reason: string): SubjectRefRefusal => ({
  ok: false,
  code,
  reason,
});
const ok = <T>(value: T): SubjectRefResult<T> => ({ ok: true, value });

const RESERVED = /[%:~@#/]/g;
const esc = (s: string) => s.replace(RESERVED, (c) => `%${c.charCodeAt(0).toString(16)}`);
const CODES = /%(25|3a|7e|40|23|2f)/g;
/** null when a `%` is not one of the six escape codes; raw reserved text is caught by the canonical check. */
const unesc = (s: string): string | null =>
  s.replace(CODES, "").includes("%")
    ? null
    : s.replace(CODES, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

const keyText = (ref: SubjectRef): string =>
  ref.keyKind === "name" ? JSON.stringify(ref.key) : ref.key;
const codeOf = (ref: SubjectRef): SubjectRefCode =>
  [
    `${ref.keyKind}:${esc(keyText(ref))}`,
    ref.source === undefined ? "" : `~${esc(ref.source)}`,
    ref.placement === undefined
      ? ""
      : `@${[ref.placement.host, ...ref.placement.links].map(esc).join("/")}`,
    ref.sub === undefined
      ? ""
      : "port" in ref.sub
        ? `#port:${ref.sub.port}`
        : `#field:${esc(ref.sub.field)}`,
  ].join("") as SubjectRefCode;

const codeFor = (path: PropertyKey | undefined): SubjectRefRefusal["code"] =>
  path === "key"
    ? "bad-key"
    : path === "source"
      ? "bad-source"
      : path === "placement"
        ? "bad-placement"
        : path === "sub"
          ? "bad-sub"
          : path === "keyKind"
            ? "unknown-kind"
            : "malformed";
const admit = (raw: unknown): SubjectRefResult<SubjectRef> => {
  if (
    typeof raw === "object" &&
    raw !== null &&
    ("documentMark" in raw ||
      "mark" in raw ||
      typeof (raw as { source?: unknown }).source === "object")
  )
    return refuse("document-mark", "a document mark is observation basis, never identity");
  const parsed = subjectRefSchema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0]!;
  return refuse(codeFor(issue.path[0]), issue.message);
};

/** The one branded string for a SubjectRef; refuses anything outside the ruled shape. */
export const encode = (ref: SubjectRef): SubjectRefResult<SubjectRefCode> => {
  const admitted = admit(ref);
  return admitted.ok ? ok(codeOf(admitted.value)) : admitted;
};

const SEGMENTS = /^([^~@#]*)(?:~([^~@#]*))?(?:@([^~@#]*))?(?:#([^~@#]*))?$/;
/** Decodes at a door: a typed refusal for every malformed or non-canonical input. */
export const decode = (code: string): SubjectRefResult<SubjectRef> => {
  const colon = code.indexOf(":");
  if (colon < 0) return refuse("malformed", "a SubjectRef is `<kind>:<key>`");
  const kind = code.slice(0, colon);
  if (!(SUBJECT_KEY_KINDS as readonly string[]).includes(kind))
    return refuse("unknown-kind", `unknown key kind "${kind}"`);
  const segments = SEGMENTS.exec(code.slice(colon + 1));
  if (!segments)
    return refuse(
      "malformed",
      "segments are key, ~source, @placement, #sub, in that order, once each",
    );
  const [, keyPart = "", sourcePart, placementPart, subPart] = segments;
  const rawKey = unesc(keyPart);
  if (rawKey === null) return refuse("bad-escape", "a key escapes % : ~ @ # / as %xx");
  let key: unknown = rawKey;
  if (kind === "name") {
    try {
      key = JSON.parse(rawKey);
    } catch {
      return refuse("bad-key", "a name key is a canonical JSON tuple");
    }
  }
  const raw: Record<string, unknown> = { keyKind: kind, key };
  if (sourcePart !== undefined) raw.source = unesc(sourcePart);
  if (placementPart !== undefined) {
    const [host, ...links] = placementPart.split("/").map(unesc);
    raw.placement = { host, links };
  }
  if (subPart !== undefined) {
    const tag = subPart.indexOf(":");
    const [name, value] = tag < 0 ? [subPart, ""] : [subPart.slice(0, tag), subPart.slice(tag + 1)];
    if (name === "port" && /^\d+$/.test(value)) raw.sub = { port: Number(value) };
    else if (name === "field") raw.sub = { field: unesc(value) };
    else return refuse("bad-sub", "a sub is `port:<n>` or `field:<name>`, never a free string");
  }
  const admitted = admit(raw);
  if (!admitted.ok) return admitted;
  return codeOf(admitted.value) === code
    ? admitted
    : refuse("malformed", "not the canonical spelling");
};

/** The one Zod door for a SubjectRefCode: it admits exactly what `decode` admits. */
// The brand is type-only: a transform would make every Work schema unrepresentable in JSON Schema.
export const subjectRefCodeSchema = z
  .string()
  .refine((v) => decode(v).ok, { message: "not a canonical SubjectRef code" }) as unknown as z.ZodType<
  SubjectRefCode,
  string
>;
/** Mints a code from refs the caller built from trusted data; a refusal is a programming error. */
export const subjectCode = (ref: SubjectRef): SubjectRefCode => {
  const code = encode(ref);
  if (!code.ok) throw Error(`${code.code}: ${code.reason}`);
  return code.value;
};
/** The decoded ref of a code already admitted at a door. */
export const subjectOf = (code: SubjectRefCode): SubjectRef => {
  const ref = decode(code);
  if (!ref.ok) throw Error(`${ref.code}: ${ref.reason}`);
  return ref.value;
};

/** ADR 0035 rule 3: a `parameter` binding keys by UniqueId with no sub and no placement. */
export type ParameterSubject = Extract<SubjectRef, { keyKind: "UniqueId" }> & {
  readonly placement?: undefined;
  readonly sub?: undefined;
};
export const parameterSubject = (ref: SubjectRef): SubjectRefResult<ParameterSubject> =>
  ref.keyKind !== "UniqueId"
    ? refuse("bad-key", "a parameter binding keys by UniqueId")
    : ref.placement !== undefined
      ? refuse("bad-placement", "a parameter binding has no placement")
      : ref.sub !== undefined
        ? refuse("bad-sub", "a parameter binding has no sub")
        : ok(ref as ParameterSubject);
