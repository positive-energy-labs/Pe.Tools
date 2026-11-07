import { z } from "zod";
import { discoveryMachineSchema } from "./discovery-machine.ts";
import { capabilityCatalogSchema } from "./capability.ts";
export const chatArgs = z.object({});
export const chatValue = z.object({
  machine: discoveryMachineSchema,
  capabilities: capabilityCatalogSchema,
});
