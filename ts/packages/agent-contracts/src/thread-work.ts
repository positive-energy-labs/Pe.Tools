import { z } from "zod";
import { workKeySchema } from "./route-state.ts";
import { documentRefSchema } from "./target.ts";

/** A remembered document connection is display context, never native execution authority. */
export const threadWorkSchema = z.strictObject({
  threadId: z.string().min(1),
  documents: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      availability: z.enum(["open", "closed", "unknown"]),
    }),
  ),
  works: z.array(
    z.strictObject({
      id: z.string().min(1),
      documentId: z.string().min(1).nullable(),
      route: z.string().min(1),
      intent: z.string().min(1),
      /** Unique cells with a proposal, a staged value, or both. */
      unfinished: z.number().int().nonnegative(),
    }),
  ),
});
export type ThreadWork = z.infer<typeof threadWorkSchema>;

/** One batch serves the sidebar; unavailable or bounded discovery stays explicit. */
export const threadWorkSnapshotSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  threads: z.array(threadWorkSchema),
  observations: z.array(z.string()),
  truncated: z.boolean(),
});
export type ThreadWorkSnapshot = z.infer<typeof threadWorkSnapshotSchema>;

/** A saved Work address is readable without a current native target. This grants no action. */
export const workResumeSchema = z.strictObject({
  id: z.string().min(1),
  key: workKeySchema,
  url: z.string().startsWith("/").nullable(),
  reason: z.string().nullable(),
  /** Exact lifetimes known to name this Address, without conflicting current metadata.
   * The browser matches its own Places; this evidence grants no native authority. */
  knownOpenRefs: z.array(documentRefSchema),
});
export type WorkResume = z.infer<typeof workResumeSchema>;
