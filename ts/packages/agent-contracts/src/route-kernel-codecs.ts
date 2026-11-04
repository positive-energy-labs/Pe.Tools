import { z } from "zod";
import type { DecodeResult, IdentityCodec, IdentityCodecs, IdentityId, IdentityKind, IdentityParts } from "./route-kernel-page.ts";

/** JSON transport decodes against the field schema once at the address boundary. */
export function jsonCodec<S extends z.ZodType>(schema: S) {
  return {
    encode: (value: z.output<S>): string => JSON.stringify(value),
    decode(text: string): DecodeResult<z.output<S>> {
      try {
        const parsed = schema.safeParse(JSON.parse(text));
        return parsed.success
          ? { ok: true, value: parsed.data }
          : { ok: false, reason: "Invalid route value" };
      } catch {
        return { ok: false, reason: "Malformed route value" };
      }
    },
  };
}

export const identityPartSchema = z.string().refine((s) => s.trim().length > 0, "Empty identity part");
const uniqueId = identityPartSchema.refine((s) => !/^[+-]?\d+$/.test(s.trim()), "ElementId is not UniqueId");
const linkTuple = z.tuple([identityPartSchema, uniqueId, identityPartSchema]);
const elementTuple = z
  .tuple([identityPartSchema, linkTuple.nullable(), uniqueId])
  .refine(
    ([document, link]) => link === null || document === link[0],
    "Link and element must name the same containing document",
  );
export const decodeFailure = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

function identityCodec<K extends IdentityKind, T>(
  kind: K,
  tuple: z.ZodType<T>,
  partsSchema: z.ZodType<IdentityParts[K]>,
  pack: (parts: IdentityParts[K]) => T,
  unpack: (tuple: T) => IdentityParts[K],
): IdentityCodec<K> {
  const schema = z.custom<IdentityId<K>>((value: unknown) => {
    if (typeof value !== "string") return false;
    try {
      const parsed = tuple.safeParse(JSON.parse(value));
      return parsed.success && JSON.stringify(parsed.data) === value;
    } catch {
      return false;
    }
  });
  const decode = (text: string): DecodeResult<IdentityId<K>> => {
    const parsed = schema.safeParse(text);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : decodeFailure(`Invalid canonical ${kind} identity`);
  };
  return Object.freeze({
    kind,
    decode,
    encode(parts: IdentityParts[K]): DecodeResult<IdentityId<K>> {
      const parsed = partsSchema.safeParse(parts);
      return parsed.success
        ? decode(JSON.stringify(pack(parsed.data)))
        : decodeFailure(`Invalid ${kind} parts`);
    },
    parts(id: IdentityId<K>): IdentityParts[K] {
      return unpack(tuple.parse(JSON.parse(schema.parse(id))));
    },
  });
}
const linkParts = z.strictObject({
  document: identityPartSchema,
  linkUniqueId: uniqueId,
  linkedDocument: identityPartSchema,
});
const packLink = (p: IdentityParts["link"]): z.output<typeof linkTuple> => [
  p.document,
  p.linkUniqueId,
  p.linkedDocument,
];
const unpackLink = ([document, linkUniqueId, linkedDocument]: z.output<
  typeof linkTuple
>): IdentityParts["link"] => ({ document, linkUniqueId, linkedDocument });

export const identityCodecs: IdentityCodecs = Object.freeze({
  document: identityCodec(
    "document",
    z.tuple([identityPartSchema]),
    z.strictObject({ document: identityPartSchema }),
    (p) => [p.document],
    ([document]) => ({ document }),
  ),
  link: identityCodec("link", linkTuple, linkParts, packLink, unpackLink),
  element: identityCodec<"element", z.output<typeof elementTuple>>(
    "element",
    elementTuple,
    z.strictObject({ document: identityPartSchema, link: linkParts.nullable(), uniqueId }),
    (p) => [p.document, p.link === null ? null : packLink(p.link), p.uniqueId],
    ([document, link, uniqueId]) => ({
      document,
      link: link === null ? null : unpackLink(link),
      uniqueId,
    }),
  ),
  local: identityCodec(
    "local",
    z.tuple([identityPartSchema, identityPartSchema]),
    z.strictObject({ namespace: identityPartSchema, subject: identityPartSchema }),
    (p) => [p.namespace, p.subject],
    ([namespace, subject]) => ({ namespace, subject }),
  ),
});
