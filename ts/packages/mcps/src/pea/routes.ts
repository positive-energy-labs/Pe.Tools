import { instancesRouteState } from "@pe/agent-contracts";
/**
 * The server-side route registry — the ONE place a new collaborative route is
 * wired. The host composition root registers
 * every entry; nothing else enumerates routes.
 */
import type { z } from "zod";
import type { RouteStateSpec, RouteWriteAdmission } from "@pe/agent-contracts";
import {
  ductsRouteState,
  familiesRouteState,
  familyDraftRouteState,
  parameterLinksRouteState,
  roomsRouteState,
  scheduleGridRouteState,
  settingsRouteState,
  takeoffsRouteState,
} from "@pe/agent-contracts";

import {
  familiesAdmission,
  hostLoadedFamilies,
  type LoadedFamilies,
} from "./families-admission.ts";

export interface RouteRegistration {
  spec: RouteStateSpec<z.ZodType>;
  handlers: Record<string, never>;
  admit?: RouteWriteAdmission;
}

/** Route Work uses generic writes; operations and workflows own execution. */
function entry<TSchema extends z.ZodType>(spec: RouteStateSpec<TSchema>): RouteRegistration {
  return { spec: spec as unknown as RouteStateSpec<z.ZodType>, handlers: {} };
}

export function createRouteRegistrations(
  options: { hostBaseUrl?: string; loadedFamilies?: LoadedFamilies } = {},
): RouteRegistration[] {
  return [
    entry(instancesRouteState),
    // Families and Parameter Links carry no route commands: their readings are host reads and
    // their applies are semantic actions, so neither can write into authored Work.
    {
      ...entry(familiesRouteState),
      admit: familiesAdmission(options.loadedFamilies ?? hostLoadedFamilies(options.hostBaseUrl)),
    },
    entry(familyDraftRouteState),
    entry(parameterLinksRouteState),
    entry(settingsRouteState),
    entry(scheduleGridRouteState),
    entry(takeoffsRouteState),
    entry(roomsRouteState),
    entry(ductsRouteState),
  ];
}
