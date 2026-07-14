/**
 * The server-side route registry — the ONE place a new collaborative route is
 * wired (spec + command handlers). The host composition root registers
 * every entry; nothing else enumerates routes.
 */
import type { z } from "zod";
import type { RouteStateCommandHandlers, RouteStateSpec } from "@pe/agent-contracts";
import {
  familyTypesRouteState,
  parameterLinksRouteState,
  scheduleGridRouteState,
  settingsRouteState,
} from "@pe/agent-contracts";

import {
  createFamilyTypesCommandHandlers,
  createParameterLinksCommandHandlers,
} from "./route-state-commands.ts";
import { createScheduleGridCommandHandlers } from "./schedule-grid-commands.ts";
import { createSettingsCommandHandlers } from "./settings-commands.ts";

export interface RouteRegistration {
  spec: RouteStateSpec<z.ZodType>;
  // biome-ignore lint/suspicious/noExplicitAny: doc type erased at the registry list;
  // the `entry` helper type-checked the spec/handler pairing where it was built.
  handlers: RouteStateCommandHandlers<any>;
}

/** Type-checks the spec↔handlers pairing, then erases for the homogeneous list. */
function entry<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
  handlers: RouteStateCommandHandlers<z.infer<TSchema>>,
): RouteRegistration {
  return { spec: spec as unknown as RouteStateSpec<z.ZodType>, handlers };
}

export function createRouteRegistrations(
  options: { hostBaseUrl?: string } = {},
): RouteRegistration[] {
  return [
    entry(familyTypesRouteState, createFamilyTypesCommandHandlers(options)),
    entry(parameterLinksRouteState, createParameterLinksCommandHandlers(options)),
    entry(settingsRouteState, createSettingsCommandHandlers(options)),
    entry(scheduleGridRouteState, createScheduleGridCommandHandlers(options)),
  ];
}
