import { z } from "zod";
import { documentRefSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";

/** Browser-owned Families Page state. The lease identifies one mounted, visible view. */
export const familiesViewSchema = z.strictObject({
  thread: z.string().min(1),
  instance: z.uuid(),
  surface: z.enum(["chat", "route"]),
  stage: z.enum(["audit", "apply", "archived"]),
  rules: z.string().max(4096),
  ruleHelp: z
    .array(z.strictObject({ insert: z.string(), label: z.string(), hint: z.string() }))
    .max(50),
  readingId: z.string().nullable(),
  document: documentRefSchema.nullable(),
  work: workKeySchema.nullable(),
  counts: z.strictObject({
    families: z.number().int(),
    types: z.number().int(),
    parameters: z.number().int(),
  }),
});
export type FamiliesView = z.infer<typeof familiesViewSchema>;

export const familiesViewCommandSchema = z.strictObject({
  thread: z.string().min(1),
  instance: z.uuid(),
  revision: z.number().int().nonnegative(),
  rules: z.string().max(4096),
});
export const familiesViewAckSchema = z.strictObject({
  instance: z.uuid(),
  commandId: z.uuid(),
  revision: z.number().int().nonnegative(),
  rules: z.string(),
  counts: familiesViewSchema.shape.counts,
});
