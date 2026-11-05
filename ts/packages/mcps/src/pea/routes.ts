/**
 * The catalog projection of every Work route (ADR 0030 rule 1): Pea's doors list every entry, admitted or not.
 * The host composition root decides which owner registers each key; nothing here filters routes out.
 */
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
  } = {},
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
