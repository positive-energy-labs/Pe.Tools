import { z } from "zod";
import type { RouteStateSpec } from "./route-state.ts";
export {
  podRouteDeclarationSchema,
  podRouteDescriptorSchema,
  type PodRouteDeclaration,
  type PodRouteDescriptor,
} from "@pe/host-contracts/pe-api";

/** The host persists JSON only; it never executes a Pod's browser reducer or imports its code. */
export const podRouteStateSchema = z.object({
  version: z.literal(1).default(1),
  state: z.record(z.string(), z.unknown()).default({}),
});
export function podRouteWorkSpec(
  route: string,
  title: string,
): RouteStateSpec<typeof podRouteStateSchema> {
  return {
    route,
    title,
    description: "Authored Pod route Work",
    schema: podRouteStateSchema,
    agentWriteMask: [],
    commands: {},
  };
}
