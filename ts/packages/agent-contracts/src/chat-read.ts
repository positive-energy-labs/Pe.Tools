import { z } from "zod";
import { settingsValue } from "./settings-read.ts";
export const chatArgs = z.object({});
export const chatValue = settingsValue.extend({ capabilities: z.unknown() });
