import { z } from "zod";
import { discoveryMachineSchema } from "./discovery-machine.ts";
export const settingsArgs = z.object({});
export const settingsValue = z.object({ machine: discoveryMachineSchema });
