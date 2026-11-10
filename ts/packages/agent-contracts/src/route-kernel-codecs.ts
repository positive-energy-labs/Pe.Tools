import { z } from "zod";
import type { DecodeResult } from "./route-kernel-page.ts";
import { subjectRefCodeSchema } from "./subject-ref.ts";

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

/** A route attention place (a rule, a cell, a thread): route-owned text, never a SubjectRef (ADR 0035 rule 9). */
export const focusSelectionSchema = z
  .array(z.strictObject({ kind: z.literal("focus"), id: z.string().min(1) }))
  .default([]);
/** A subject field holds SubjectRef codes; every id decodes through the one codec. */
export const subjectSchema = (max: number) =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("ids"),
      ids: z.array(subjectRefCodeSchema).max(max),
      active: subjectRefCodeSchema.optional(),
    }),
    z.strictObject({ kind: z.literal("all") }),
  ]);
