/**
 * The server-side route registry — the ONE place a new collaborative route is
 * wired. The host composition root registers
 * every entry; nothing else enumerates routes.
 */
import { admittedBuiltinKeys } from "../../../agent-contracts/src/admitted-builtin-keys.ts";
import type { HostWorkRegistration } from "../../../agent-contracts/src/host-route-admission.ts";
import { tools } from "@pe/agent-contracts";

import {
  familiesAdmission,
  hostLoadedFamilies,
  type LoadedFamilies,
} from "./families-admission.ts";

export interface RouteRegistration extends HostWorkRegistration {}

export function createRouteRegistrations(
  options: {
    hostBaseUrl?: string;
    loadedFamilies?: LoadedFamilies;
    admittedKeys?: readonly string[];
  } = {},
): RouteRegistration[] {
  return Object.values(tools)
    .filter(
      (tool) =>
        "work" in tool && !(options.admittedKeys ?? admittedBuiltinKeys).includes(tool.work.route),
    )
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
