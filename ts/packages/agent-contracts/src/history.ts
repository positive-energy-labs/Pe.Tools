import { z } from "zod";
import { addressSchema } from "./target.ts";
import { documentRefSchema } from "./target.ts";
import { workHandleSchema } from "./command.ts";

export const historyPoseSchema = z.object({
  instance: z.string().min(1).max(256),
  route: z.string().min(1).max(256),
  page: z.record(z.string(), z.unknown()),
  href: z
    .string()
    .max(16384)
    .refine((href) => href.startsWith("/") && !href.startsWith("//")),
});
export const historyBindingSchema = z.object({
  subscription: z.string(),
  instance: z.string(),
  read: z.string(),
  key: z.string(),
  version: z.number().int().positive(),
  evaluation: z.string(),
  inputs: z.string(),
  taking: z.string(),
  state: z.enum(["current", "refresh-needed"]),
  reason: z.string().optional(),
});
export const historyStateSchema = z.object({
  address: addressSchema,
  target: documentRefSchema,
  poses: z.array(historyPoseSchema),
  publications: z.array(historyBindingSchema).max(128),
});
export const historyPointSchema = z.object({
  id: z.uuid(),
  document: z.string(),
  at: z.number(),
  takingRange: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  reason: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("afterWrite"), receipt: z.string() }),
    z.object({ kind: z.literal("synced") }),
    z.object({ kind: z.literal("captured") }),
  ]),
  history: historyStateSchema,
});
export const recordedWorkSchema = z.object({
  handle: workHandleSchema,
  revision: z.number(),
  doc: z.unknown(),
});
export type HistoryPose = z.infer<typeof historyPoseSchema>;
export type HistoryBinding = z.infer<typeof historyBindingSchema>;
export type HistoryPoint = z.infer<typeof historyPointSchema>;
