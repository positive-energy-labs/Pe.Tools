/**
 * Recorded route exits retain the subject and scope of the call that wrote their Work.
 */
import {
  routeAddress,
  actionControls,
  parseContributionKey,
  routeCallOf,
  semanticActions,
  addressSchema,
  documentRefSchema,
  documentRequestSchema,
  workKeySchema,
  routeOf,
  type Carry,
  type LinkPage,
  type RouteKey,
  type WorkKey,
  type ActionReceipt,
  type DocumentRequest,
} from "@pe/agent-contracts";

import { publicRoutes } from "#/route/builtin-routes";
import { isRecord } from "#/route/route-owner";

export type ChatPluginRoute = string;
const chatPluginRoutes = () => publicRoutes.keys();
export const chatPluginTitle = (route: ChatPluginRoute) => {
  const manifest = publicRoutes.get(route)?.manifest;
  return manifest ? (manifest.work?.title ?? manifest.name) : `Unavailable route: ${route}`;
};

/** A tool result's payload: its MCP `structuredContent` when it carries one. */
const payload = (result: unknown) =>
  isRecord(result) && isRecord(result.structuredContent) ? result.structuredContent : result;

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
   * suggestion are one change. */
  changes: number;
  /** The document (or named workspace) the call recorded; null when it recorded none. */
  subject: string | null;
  place: CapturedPlace;
}

export type CapturedPlace =
  | { ok: true; route: RouteKey; page: LinkPage<RouteKey>; carry: Pick<Carry, "target" | "work"> }
  | { ok: false; refusal: string };

/** A recorded exit carries its own scope. Empty carries suppress the dock's current-target defaults. */
export function capturedPlace(
  route: string,
  scope: WorkKey | null,
  source: unknown,
  named?: DocumentRequest,
  /**
   * False for the head's read of live Work: Ducts' Work is document-owned and holds no system (the
   * system is Page state), so the head opens the route and keeps the system the person chose. A
   * recorded Pea call still names an exact system or is refused.
   */
  subject = true,
): CapturedPlace {
  const key = routeOf(route);
  if (!key) return { ok: false, refusal: `This route has no saved Place contract: ${route}` };
  if (!scope)
    return { ok: false, refusal: "This reading did not record its Work or document target." };
  const input = isRecord(source) ? source : {};
  if (subject && key === "ducts" && (typeof input.system !== "string" || !input.system.trim()))
    return {
      ok: false,
      refusal:
        "This reading did not record an exact Ducts system name; open Ducts and choose its subject.",
    };
  const target =
    scope.binding === "open"
      ? { kind: "open", ref: scope.open }
      : scope.binding === "address" && scope.from
        ? { kind: "open", ref: scope.from }
        : (named ?? null);
  const needs = (publicRoutes.get(route)?.manifest as { needs?: unknown } | undefined)?.needs;
  if (!target && (scope.binding !== "host" || needs))
    return {
      ok: false,
      refusal:
        "This reading did not record its document target; the current chat target cannot replace it.",
    };
  const carry = {
    target: target ? JSON.stringify(target) : "",
    work: scope.binding === "workspace" ? scope.work : "",
  };
  const at = routeAddress(key);
  const search = Object.fromEntries(
    at.keys.filter((name) => name in input).map((name) => [name, input[name]]),
  );
  if (key === "schedules" && scope.binding === "workspace") search.workspaceId = scope.work;
  return { ok: true, route: key, page: at.read(search).page, carry };
}

/** Action receipts retain their execution document, even when the chat head has since moved. */
export function actionPlace(route: string, receipt: ActionReceipt | undefined): CapturedPlace {
  const work = isRecord(receipt?.bases.work) ? receipt.bases.work : null;
  // A receipt's Work key is authority when it explicitly records one.
  const scope = workKeySchema.safeParse(work?.key);
  const target = receipt?.destination;
  const result = receipt && "result" in receipt && isRecord(receipt.result) ? receipt.result : null;
  const member = isRecord(result?.member) ? result.member : null;
  const source = isRecord(receipt?.request.source) ? receipt.request.source : null;
  const workspace =
    typeof receipt?.request.workspaceId === "string" ? receipt.request.workspaceId : null;
  return capturedPlace(
    route,
    scope.success
      ? scope.data
      : workspace
        ? { binding: "workspace", route, target: null, work: workspace }
        : target?.kind === "document"
          ? { binding: "open", route, target: null, open: target.ref }
          : target?.kind === "host"
            ? { binding: "host", route, target: null }
            : null,
    { ...receipt?.request, ...source, ...member },
    target?.kind === "document" ? { kind: "open", ref: target.ref } : undefined,
  );
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
  const outer = payload(result);
  if (!isRecord(outer) || outer.ok !== true) return null;
  const request = isRecord(args) ? args : {};
  const input = parsed(request.input);
  const patches = isRecord(input) && Array.isArray(input.patches) ? input.patches : [];
  // Pea's mask admits `cells/<key>/suggestion…`, `fields/<pointer>/suggestion…` and a root cell's
  // `<cell>/suggestion…` (families' `scope`, F-H6-5).
  const cells = new Set(
    patches.flatMap((patch) => {
      const path = isRecord(patch) && Array.isArray(patch.path) ? patch.path : [];
      if ((path[0] === "cells" || path[0] === "fields") && path[1] !== undefined)
        return [`${path[0]}/${String(path[1])}`];
      return path[1] === "suggestion" ? [String(path[0])] : [];
    }),
  );
  const target = isRecord(outer.target) ? outer.target : {};
  const observation = isRecord(target.nativeObservation) ? target.nativeObservation : null;
  const ref = documentRefSchema.safeParse(
    observation?.source === "native" ? observation.document : undefined,
  );
  const address = addressSchema.safeParse(target.document);
  const named = documentRequestSchema.safeParse({
    kind: "named",
    session: target.session,
    address: target.document,
  });
  const scope: WorkKey | null =
    typeof request.workspaceId === "string" && request.workspaceId.trim()
      ? { binding: "workspace", route, target: null, work: request.workspaceId }
      : ref.success && ref.data.session === target.session
        ? { binding: "open", route, target: null, open: ref.data }
        : address.success && named.success
          ? { binding: "address", route, target: address.data }
          : null;
  return {
    route,
    changes: cells.size,
    place: capturedPlace(route, scope, input, named.success ? named.data : undefined),
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
  const outer = payload(result);
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
