import { z } from "zod";
import { workKeySchema, type WorkKey } from "./route-state.ts";

/** A host read publishes one semantic Value; the envelope never varies by route. */
export const publicationRequest = <S extends z.ZodType>(args: S) => z.object({
  subscription: z.string().min(1).max(128), generation: z.number().int().nonnegative(), args,
  release: z.boolean().optional(), readSet: z.string().optional(),
});
export const publicationSchema = <S extends z.ZodType>(data: S) => z.object({
  key: z.string(), generation: z.number(), version: z.number(),
  state: z.enum(["current", "refresh-needed", "superseded"]), reason: z.string().optional(),
  value: z.object({ data, evaluation: z.string(), inputs: z.string(), works: z.array(workKeySchema), trace: z.array(z.unknown()),
    coverage: z.object({ requested: z.array(z.string()), unknown: z.array(z.string()),
      covered: z.array(z.string()), refused: z.array(z.object({ keys: z.array(z.string()), reason: z.string() })) }),
    origin: z.unknown(), freshness: z.enum(["current", "refresh-needed"]),
  }).nullable(),
});
/** What `publicationSchema(data)` decodes to, with the data typed. */
export interface Publication<D = unknown> {
  key: string;
  generation: number;
  version: number;
  state: "current" | "refresh-needed" | "superseded";
  reason?: string;
  value: {
    data: D;
    evaluation: string;
    inputs: string;
    /** Work leaves actually reached by this host evaluation, including absent Work. */
    works: WorkKey[];
    coverage: {
      requested: string[];
      covered: string[];
      unknown: string[];
      refused: { keys: string[]; reason: string }[];
    };
    origin: unknown;
    trace: unknown[];
    freshness: "current" | "refresh-needed";
  } | null;
}
export const valueReadRequest = publicationRequest(z.unknown()).extend({read:z.string().min(1)});
export const valueReadResponse = publicationSchema(z.unknown());
