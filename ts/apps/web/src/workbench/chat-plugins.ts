/**
 * The routes Chat hosts in its plugin pane, by their manifests, and the one transcript record a
 * Pea call that wrote their Work leaves. Views live in `route-panes.tsx`.
 */
import { actionControls, routeCallOf, semanticActions } from "@pe/agent-contracts";

import { manifest as families } from "#/families/manifest";
import { familyManifest } from "#/family/manifest";
import { openManifest } from "#/open/manifest";
import { manifest as parameterLinks } from "#/parameter-links/manifest";
import { manifest as rooms } from "#/rooms/manifest";
import { schedulesManifest } from "#/route/schedules/manifest";
import { manifest as pods } from "#/routes/pods";
import { manifest as takeoffs } from "#/takeoff/manifest";

/** Every plugin route's manifest, by its key; the order is the pane's. */
export const CHAT_PLUGINS = {
  instances: openManifest,
  takeoffs,
  family: familyManifest(),
  families,
  pods,
  "parameter-links": parameterLinks,
  schedules: schedulesManifest(),
  rooms,
} as const;

export type ChatPluginRoute = keyof typeof CHAT_PLUGINS;

export const CHAT_PLUGIN_ROUTES = Object.keys(CHAT_PLUGINS) as [
  ChatPluginRoute,
  ...ChatPluginRoute[],
];

for (const route of CHAT_PLUGIN_ROUTES)
  if (CHAT_PLUGINS[route].key !== route)
    throw new Error(`chat plugin ${route} holds the ${CHAT_PLUGINS[route].key} manifest`);

/** The Work's title where the route owns one ("Schedule Grid"), else the route's name. */
export const chatPluginTitle = (route: ChatPluginRoute) => {
  const manifest: { name: string; work?: { title: string } } = CHAT_PLUGINS[route];
  return manifest.work?.title ?? manifest.name;
};

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
  /** Distinct cells (or fields) the call proposed on, not patches: several rungs of one cell's
   * proposal are one change. */
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
  // Pea's mask admits `cells/<key>/proposal…`, `fields/<pointer>/proposal…` and a root cell's
  // `<cell>/proposal…` (families' `scope`, F-H6-5).
  const cells = new Set(
    patches.flatMap((patch) => {
      const path = isRecord(patch) && Array.isArray(patch.path) ? patch.path : [];
      if ((path[0] === "cells" || path[0] === "fields") && path[1] !== undefined)
        return [`${path[0]}/${String(path[1])}`];
      return path[1] === "proposal" ? [String(path[0])] : [];
    }),
  );
  const target = isRecord(outer.target) ? outer.target : {};
  return {
    route,
    changes: cells.size,
    subject:
      typeof target.document === "string"
        ? target.document
        : typeof request.workspaceId === "string"
          ? request.workspaceId
          : null,
  };
}

/** The receipt a Pea action call admitted: its original ID and the action key it named. */
export interface ActionCall {
  id: string;
  key: string;
}

/**
 * A `pe_do` of a semantic action, an action control or an `op:`/`pod:` operation, with the
 * receipt ID its result (or its input, for a control) names. Its state is the receipt's, read live.
 */
export function actionCall(toolName: string, args: unknown, result: unknown): ActionCall | null {
  if (toolName !== "pe_do" || !isRecord(args) || typeof args.key !== "string") return null;
  const key = args.key.replace(/^(op|workflow):/, "");
  const known =
    Object.hasOwn(semanticActions, key) ||
    Object.hasOwn(actionControls, key) ||
    /^(op|pod):/.test(args.key);
  if (!known) return null;
  const outer =
    isRecord(result) && isRecord(result.structuredContent) ? result.structuredContent : result;
  const row = isRecord(outer) && isRecord(outer.result) ? outer.result : outer;
  const input = parsed(args.input);
  const id =
    isRecord(row) && isRecord(row.action) && typeof row.action.id === "string"
      ? row.action.id
      : isRecord(row) && typeof row.id === "string"
        ? row.id
        : isRecord(input) && typeof input.actionId === "string"
          ? input.actionId
          : isRecord(input) && typeof input.id === "string"
            ? input.id
            : null;
  return id ? { id, key } : null;
}

/** An action key's first segment names its entity; a few entities live on another route. */
export function actionRoute(key: string): ChatPluginRoute | null {
  const entity = key.split(".")[0] ?? "";
  const route =
    ({ schedule: "schedules", settings: "pods", pod: "pods" } as const)[entity] ?? entity;
  return CHAT_PLUGIN_ROUTES.find((name) => name === route) ?? null;
}

/** `takeoffs.sync` → `sync`, `schedule.grid.push` → `grid push`. */
export const actionWord = (key: string) => key.split(".").slice(1).join(" ") || key;
