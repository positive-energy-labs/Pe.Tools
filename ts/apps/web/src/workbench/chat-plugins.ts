/**
 * The routes Chat hosts in its plugin pane, by their manifests, and the one transcript record a
 * Pea call that wrote their Work leaves. Views live in `route-panes.tsx`.
 */
import {
  actionControls,
  parseContributionKey,
  routeCallOf,
  semanticActions,
} from "@pe/agent-contracts";

import { publicRoutes } from "#/route/builtin-routes";

export type ChatPluginRoute = string;
export const chatPluginRoutes = () => publicRoutes.keys();
export const chatPluginTitle = (route: ChatPluginRoute) => {
  const manifest = publicRoutes.get(route)?.manifest;
  return manifest ? (manifest.work?.title ?? manifest.name) : `Unavailable route: ${route}`;
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
  const route = chatPluginRoutes().find((name) => name === call?.route);
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
 * A `pe_do` of a semantic action, an action control, an `op:` operation or a package script, with the
 * receipt ID its result (or its input, for a control) names. Its state is the receipt's, read live.
 */
export function actionCall(toolName: string, args: unknown, result: unknown): ActionCall | null {
  if (toolName !== "pe_do" || !isRecord(args) || typeof args.key !== "string") return null;
  const key = args.key.replace(/^(op|workflow):/, "");
  const known =
    Object.hasOwn(semanticActions, key) ||
    Object.hasOwn(actionControls, key) ||
    args.key.startsWith("op:") ||
    parseContributionKey(args.key)?.kind === "script";
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

/**
 * The pane a host action opens in: the plugin route whose manifest declares a verb that `does`
 * it, or `runs` it from its views. A key no manifest declares (or two declare) has no pane; its
 * record keeps the receipt link.
 */
export const actionRoute = (key: string): ChatPluginRoute | null => publicRoutes.actionRoute(key);

/** `takeoffs.sync` → `sync`, `schedule.grid.push` → `grid push`. */
export const actionWord = (key: string) => key.split(".").slice(1).join(" ") || key;
