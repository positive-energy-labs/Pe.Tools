import { z } from "zod";
import { threadTabSchema, THREAD_TABS_MAX } from "./harness-thread.ts";

/** The machine's shared list. Focus belongs to each window. */
export const placesFileSchema = z.strictObject({
  places: z.array(threadTabSchema).max(THREAD_TABS_MAX),
});
export type PlacesFile = z.infer<typeof placesFileSchema>;
