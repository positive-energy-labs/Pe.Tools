import { z } from "zod";

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
