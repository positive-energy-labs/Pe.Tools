import { z } from "zod";

const navigationRowSchema = z.object({
  id: z.string(),
  route: z.string(),
  label: z.string(),
  context: z.string(),
  state: z.string(),
  url: z.string().startsWith("/").nullable(),
  reason: z.string().nullable(),
  revision: z.number().int().nonnegative().nullable(),
});

/** Small read-only summaries. A null URL is an explicit refusal to invent a resume address. */
export const navigationSnapshotSchema = z.object({
  observedAt: z.string(),
  works: z.array(navigationRowSchema),
  threads: z.array(navigationRowSchema),
  observations: z.array(z.string()),
  truncated: z.boolean(),
});

export type NavigationSnapshot = z.infer<typeof navigationSnapshotSchema>;
export type NavigationWork = NavigationSnapshot["works"][number];
export type NavigationThread = NavigationSnapshot["threads"][number];
