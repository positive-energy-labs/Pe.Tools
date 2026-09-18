/**
 * The routes Chat hosts in its plugin pane, and the one transcript record a Pea call that wrote
 * their Work leaves. Views live in `route-panes.tsx`; this stays data so the Chat URL schema can
 * import it without the route views.
 */
import {
  familiesRouteState,
  familyDraftRouteState,
  instancesRouteState,
  parameterLinksRouteState,
  routeCallOf,
  scheduleGridRouteState,
  settingsRouteState,
  takeoffsRouteState,
} from "@pe/agent-contracts";

export const CHAT_PLUGIN_ROUTES = [
  "instances",
  "takeoffs",
  "family",
  "families",
  "pods",
  "parameter-links",
  "schedules",
] as const;

export type ChatPluginRoute = (typeof CHAT_PLUGIN_ROUTES)[number];

const titles = Object.fromEntries(
  [
    instancesRouteState,
    takeoffsRouteState,
    familyDraftRouteState,
    familiesRouteState,
    settingsRouteState,
    parameterLinksRouteState,
    scheduleGridRouteState,
  ].map((spec) => [spec.route, spec.title]),
) as Record<ChatPluginRoute, string>;

export const chatPluginTitle = (route: ChatPluginRoute) => titles[route];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsed = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export interface ProposedRecord {
  route: ChatPluginRoute;
  changes: number;
  /** The document (or named workspace) the call recorded; null when it recorded none. */
  subject: string | null;
}

/**
 * `Pea proposed {n} changes in {Route} · {Subject}`: read from the call's own args and recorded
 * result, never from live Work, because a record that moves is not a record. Null for any call
 * that did not land a `route:<route>.propose` write.
 */
export function proposedRecord(
  toolName: string,
  args: unknown,
  result: unknown,
): ProposedRecord | null {
  const call = routeCallOf(toolName, args);
  const route = CHAT_PLUGIN_ROUTES.find((name) => name === call?.route);
  if (!route || call?.member !== "propose") return null;
  const outer =
    isRecord(result) && isRecord(result.structuredContent) ? result.structuredContent : result;
  if (!isRecord(outer) || outer.ok !== true) return null;
  const request = isRecord(args) ? args : {};
  const input = parsed(request.input);
  const patches = isRecord(input) && Array.isArray(input.patches) ? input.patches : [];
  const target = isRecord(outer.target) ? outer.target : {};
  return {
    route,
    changes: patches.length,
    subject:
      typeof target.document === "string"
        ? target.document
        : typeof request.workspaceId === "string"
          ? request.workspaceId
          : null,
  };
}
