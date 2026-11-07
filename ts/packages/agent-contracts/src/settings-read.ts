import { z } from "zod";
import type { DiscoveryMachine } from "./discovery-machine.ts";
export const settingsArgs = z.object({});
// TODO: the Machine owner has no canonical wire decoder yet; preserve its typed value here.
export const settingsValue = z.object({ machine: z.custom<DiscoveryMachine>() });
