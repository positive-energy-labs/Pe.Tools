import { z } from "zod";
import { effectDecoder } from "@pe/host-contracts/decoders";
import { bridgeSessionsListSchema } from "@pe/host-contracts/operation-types";
import { harnessThreadSummarySchema } from "./harness-thread.ts";
export const bindData = z.object({
  threads: z.array(harnessThreadSummarySchema),
  inventory: effectDecoder(bridgeSessionsListSchema),
  /** The bind subject's roster: every Page the capability catalog serves, by slug. */
  pages: z.array(z.object({ slug: z.string().min(1), title: z.string() })),
});
