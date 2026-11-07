import { z } from "zod";
import { harnessThreadSummarySchema } from "./harness-thread.ts";
// Machine and SDK recents have interface-only contracts; the producer retains their decode authority.
export const openData = z.object({
  machine: z.unknown(),
  recents: z.unknown(),
  threads: z.array(harnessThreadSummarySchema),
});
