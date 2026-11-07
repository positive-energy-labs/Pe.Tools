import { z } from "zod";
import { settingsValue } from "./settings-read.ts";
import { capabilityCatalogSchema } from "./capability.ts";
export const chatArgs = z.object({});
export const chatValue = settingsValue.extend({ capabilities: capabilityCatalogSchema });
