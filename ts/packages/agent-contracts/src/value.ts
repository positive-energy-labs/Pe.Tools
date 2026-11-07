import { z } from "zod";

/** A host read publishes one semantic Value; the envelope never varies by route. */
export const publicationRequest = <S extends z.ZodType>(args: S) => z.object({
  subscription: z.string().min(1).max(128), generation: z.number().int().nonnegative(), args,
  release: z.boolean().optional(), readSet: z.string().optional(),
});
export const publicationSchema = <S extends z.ZodType>(data: S) => z.object({
  key: z.string(), generation: z.number(), version: z.number(),
  state: z.enum(["current", "refresh-needed", "superseded"]), reason: z.string().optional(),
  value: z.object({ data, evaluation: z.string(), inputs: z.string(), trace: z.array(z.unknown()),
    coverage: z.object({ requested: z.array(z.string()), unknown: z.array(z.string()),
      covered: z.array(z.string()), refused: z.array(z.object({ keys: z.array(z.string()), reason: z.string() })) }),
    origin: z.unknown(), freshness: z.enum(["current", "refresh-needed"]),
  }).nullable(),
});
