/**
 * The server-side route registry — the ONE place a new collaborative route is
 * wired. The host composition root registers
 * every entry; nothing else enumerates routes.
 */
import type { z } from "zod";
import type { RouteStateSpec, RouteWriteAdmission } from "@pe/agent-contracts";
import { tools } from "@pe/agent-contracts";

import {
  familiesAdmission,
  hostLoadedFamilies,
  type LoadedFamilies,
} from "./families-admission.ts";

export interface RouteRegistration {
  spec: RouteStateSpec<z.ZodType>;
  admit?: RouteWriteAdmission;
}

export function createRouteRegistrations(
  options: { hostBaseUrl?: string; loadedFamilies?: LoadedFamilies } = {},
): RouteRegistration[] {
  return Object.values(tools)
    .filter((tool) => "work" in tool)
    .map((tool) => ({
      spec: (tool as import("@pe/agent-contracts").Tool).work!,
      ...(tool.name === "families"
        ? {
            admit: familiesAdmission(
              options.loadedFamilies ?? hostLoadedFamilies(options.hostBaseUrl),
            ),
          }
        : {}),
    }));
}
