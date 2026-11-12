import { z } from "zod";
import { discoveryMachineSchema } from "./discovery-machine.ts";
import { settingTiersSchema } from "./tiered-setting.ts";
export const settingsArgs = z.object({});
export const settingsValue = z.object({
  machine: discoveryMachineSchema,
  /** Each owner's `Settings/<owner>.json` in every home tier, as the host read it: the /settings sheet's cells. */
  settings: z.record(z.string(), settingTiersSchema),
});
