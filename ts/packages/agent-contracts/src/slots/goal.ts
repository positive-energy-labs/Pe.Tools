import { z } from "zod";
import { subjectRefCodeSchema, type SubjectRefCode } from "../subject-ref.ts";
import type { StateCell } from "./sheet.ts";

/*
 * The goal slot (ADR 0030 rule 3; ADR 0035 rules 1 and 8). A route's core is one host Read that
 * returns a Goal; the kernel draws the unresolved list first, on every route the same way, and
 * greys the answer until that list is empty. Pea reads the same Goal the UI fetches. The ducts
 * inbox is this list, not a notice surface. Owner: slice 7. Scaffold: types only.
 */

/** Who closes an open question: a person, Pea, or one catalog op. */
export type Resolver = "person" | "pea" | { readonly op: string };

export interface Closer {
  readonly id: string;
  readonly says: string;
  readonly resolver: Resolver;
  readonly subject?: SubjectRefCode;
}

export type GoalResult<R> =
  | { readonly kind: "complete"; readonly value: R }
  /** An incomplete answer is a greyed estimate with its sources; no author certifies it. */
  | { readonly kind: "estimate"; readonly value: R | null; readonly sources: readonly string[] };

export interface Goal<R = unknown> {
  readonly unresolved: readonly Closer[];
  readonly assumed: readonly Closer[];
  readonly next: Closer | null;
  readonly inputs: readonly StateCell[];
  readonly result: GoalResult<R>;
}

const closerSchema = z.strictObject({
  id: z.string().min(1),
  says: z.string().min(1),
  resolver: z.union([z.literal("person"), z.literal("pea"), z.strictObject({ op: z.string().min(1) })]),
  subject: subjectRefCodeSchema.optional(),
});
/** The Goal a host Read publishes; `inputs` are StateCells (`sheet.ts`), checked by the kernel at draw. */
export const goalSchema = <R extends z.ZodType>(result: R) =>
  z.strictObject({
    unresolved: z.array(closerSchema).readonly(),
    assumed: z.array(closerSchema).readonly(),
    next: closerSchema.nullable(),
    inputs: z.array(z.unknown()).readonly(),
    result: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("complete"), value: result }),
      z.strictObject({ kind: z.literal("estimate"), value: result.nullable(), sources: z.array(z.string()).readonly() }),
    ]),
  });
