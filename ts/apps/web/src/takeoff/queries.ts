import { z } from "zod";


/** rhvac.open extracts the Jet file; only rhvac.launch starts the RHVAC application. */
export const takeoffReads = {
  "takeoffs.snapshot": {
    input: z.strictObject({
      views: z.array(z.string()).optional(),
      zoneGuids: z.array(z.string().uuid()).optional(),
    }),
  },
  "rhvac.open": { input: z.strictObject({ path: z.string().min(1) }) },
} as const;
export type TakeoffReadKey = keyof typeof takeoffReads;
/** Zone audit and file sync never widen a chosen zone back to all of its views. */
export const takeoffReadScope = (page: { views: readonly string[]; zones: readonly string[] }) => ({
  views: page.zones.length ? [] : page.views,
  zoneGuids: page.zones,
});
